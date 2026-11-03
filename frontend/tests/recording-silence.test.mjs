import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(name, globals = {}, cache = new Map()) {
  if (cache.has(name)) return cache.get(name);
  const source = fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const sandbox = { exports: {}, Blob, Error, Float32Array, ...globals,
    require: dependency => load(dependency.replace("./", ""), globals, cache) };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, sandbox);
  cache.set(name, sandbox.exports);
  return sandbox.exports;
}
const { RecordingSilenceDetector } = load("recording-silence");
const detector = options => new RecordingSilenceDetector({ enabled: true, ...options });
function frames(value, rms, count, seconds = .1) {
  return Array.from({ length: count }, () => value.addFrame(rms, seconds));
}

test("initial silence and a brief click never become a completed answer", () => {
  const value = detector();
  assert.ok(frames(value, 0, 100).every(stopped => !stopped));
  assert.equal(value.addFrame(.08, .2), false);
  assert.ok(frames(value, 0, 30).every(stopped => !stopped));
});

test("clear sound followed by 1.5 seconds silence stops once, not on a short pause", () => {
  const value = detector();
  assert.ok(frames(value, .04, 4).every(stopped => !stopped));
  assert.ok(frames(value, 0, 14).every(stopped => !stopped));
  assert.equal(value.addFrame(0, .1), true);
  assert.equal(value.addFrame(0, .1), false);
});

test("resumed sound and an uncertain soft tail reset the silence window", () => {
  const value = detector();
  frames(value, .04, 4); frames(value, 0, 10);
  assert.equal(value.addFrame(.03, .1), false);
  assert.ok(frames(value, 0, 10).every(stopped => !stopped));
  assert.equal(value.addFrame(.01, .1), false);
  assert.ok(frames(value, 0, 14).every(stopped => !stopped));
  assert.equal(value.addFrame(0, .1), true);
});

test("worklet-sized frames accumulate consistently and malformed energy never arms a cut", () => {
  const value = detector();
  const frameSeconds = 128 / 48000;
  frames(value, .04, 113, frameSeconds);
  assert.ok(frames(value, 0, 562, frameSeconds).every(stopped => !stopped));
  assert.equal(value.addFrame(0, frameSeconds), true);
  const invalid = detector();
  for (const [rms, seconds] of [[NaN, 1], [Infinity, 1], [-1, 1], [.04, NaN], [.04, 0], [.04, -1]])
    assert.equal(invalid.addFrame(rms, seconds), false);
  assert.ok(frames(invalid, 0, 30).every(stopped => !stopped));
});

test("silence stopping is optional and invalid pause settings use the 1.5-second default", () => {
  const disabled = new RecordingSilenceDetector();
  frames(disabled, .04, 4);
  assert.ok(frames(disabled, 0, 100).every(stopped => !stopped));
  for (const silenceSeconds of [NaN, Infinity, -1, .2, 6]) {
    const value = detector({ silenceSeconds });
    frames(value, .04, 4);
    assert.ok(frames(value, 0, 14).every(stopped => !stopped));
    assert.equal(value.addFrame(0, .1), true);
  }
  const shorter = detector({ silenceSeconds: 1 });
  frames(shorter, .04, 4); frames(shorter, 0, 9);
  assert.equal(shorter.addFrame(0, .1), true);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function recorderHarness({ failResume = false, acquisitionGate, moduleGate, resumeGate } = {}) {
  const resources = { stops: 0, closes: 0, disconnects: 0, acquisitions: 0, contexts: 0, worklets: 0, node: null };
  const moduleStarted = deferred(); const resumeStarted = deferred();
  const stream = { getTracks: () => [{ stop: () => resources.stops++ }] };
  const graphNode = () => ({ connect() {}, disconnect() { resources.disconnects++; } });
  class Context {
    constructor() { resources.contexts++; }
    sampleRate = 1000;
    destination = {};
    audioWorklet = { addModule: async () => { moduleStarted.resolve(); if (moduleGate) await moduleGate.promise; } };
    createMediaStreamSource() { return graphNode(); }
    createGain() { return { ...graphNode(), gain: { value: 1 } }; }
    async resume() { resumeStarted.resolve(); if (resumeGate) await resumeGate.promise; if (failResume) throw new Error("resume failed"); }
    async close() { resources.closes++; }
  }
  class Worklet {
    port = { onmessage: null };
    constructor() { resources.node = this; resources.worklets++; }
    connect() {}
    disconnect() { resources.disconnects++; }
  }
  class Offline {
    destination = {};
    constructor(channels, length) { this.length = length; }
    createBuffer(channels, length) { const values = new Float32Array(length); return { getChannelData: () => values }; }
    createBufferSource() { return { connect() {}, start() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(this.length) }; }
  }
  const { PcmRecorder } = load("pcm-recorder", { navigator: { mediaDevices: { getUserMedia: async () => {
    resources.acquisitions++; if (acquisitionGate) await acquisitionGate.promise; return stream;
  } } },
    window: { AudioContext: Context, AudioWorkletNode: Worklet }, AudioContext: Context, AudioWorkletNode: Worklet, OfflineAudioContext: Offline });
  const emit = (rms, samples = 100) => resources.node.port.onmessage?.({ data: new Float32Array(samples).fill(rms) });
  return { PcmRecorder, resources, emit, moduleStarted: moduleStarted.promise, resumeStarted: resumeStarted.promise };
}

test("recorder silence callback releases microphone once and retains audio for encoding", async () => {
  const { PcmRecorder, resources, emit } = recorderHarness();
  const stops = [];
  const recording = await PcmRecorder.start(12, () => {}, reason => {
    assert.equal(resources.stops, 1); assert.equal(resources.closes, 1); stops.push(reason);
  }, { stopOnSilence: true });
  const lateMessage = resources.node.port.onmessage;
  for (let i = 0; i < 5; i++) emit(.04);
  for (let i = 0; i < 14; i++) emit(0);
  assert.equal(stops.length, 0); emit(0);
  assert.deepEqual(stops, ["silence"]);
  lateMessage({ data: new Float32Array(1000) });
  recording.dispose();
  assert.deepEqual(stops, ["silence"]); assert.equal(resources.stops, 1);
  const first = recording.finish();
  assert.equal(recording.finish(), first);
  const bytes = Buffer.from(await (await first).arrayBuffer());
  assert.equal(bytes.length, 44 + 2 * 16000 * 2);
});

test("initial silence still reaches the hard limit and any requested duration is capped at twelve seconds", async () => {
  const { PcmRecorder, resources, emit } = recorderHarness();
  const stops = []; const ticks = [];
  await PcmRecorder.start(30, (seconds, level) => ticks.push([seconds, level]), reason => stops.push(reason), { stopOnSilence: true });
  emit(0, 0);
  assert.deepEqual(stops, []);
  emit(0, 14000);
  assert.deepEqual(stops, ["limit"]); assert.deepEqual(ticks, [[12, 0]]);
  assert.equal(resources.stops, 1);
});

test("default recorder behavior keeps a quiet tail until the hard limit", async () => {
  const { PcmRecorder, emit } = recorderHarness(); const stops = [];
  const recording = await PcmRecorder.start(12, () => {}, reason => stops.push(reason));
  emit(.04, 500); emit(0, 4000);
  assert.deepEqual(stops, []);
  emit(0, 8000);
  assert.deepEqual(stops, ["limit"]);
  recording.dispose();
});

test("cancel and failed startup close resources without later auto-stop callbacks", async () => {
  const cancelled = recorderHarness(); const stops = [];
  const recording = await cancelled.PcmRecorder.start(12, () => {}, reason => stops.push(reason), { stopOnSilence: true });
  const lateMessage = cancelled.resources.node.port.onmessage;
  recording.dispose(); recording.dispose();
  lateMessage({ data: new Float32Array(12000) });
  assert.deepEqual(stops, []); assert.equal(cancelled.resources.stops, 1); assert.equal(cancelled.resources.closes, 1);
  const failed = recorderHarness({ failResume: true });
  await assert.rejects(failed.PcmRecorder.start(12, () => {}, () => {}), /resume failed/);
  assert.equal(failed.resources.stops, 1); assert.equal(failed.resources.closes, 1);
});

test("too-short manual recordings reject after releasing the microphone", async () => {
  const { PcmRecorder, resources, emit } = recorderHarness();
  const recording = await PcmRecorder.start(12, () => {}, () => {});
  emit(.04, 100);
  await assert.rejects(recording.finish(), /quá ngắn/);
  assert.equal(resources.stops, 1); assert.equal(resources.closes, 1);
});

test("already-cancelled startup never asks for a microphone", async () => {
  const controller = new AbortController(); controller.abort();
  const { PcmRecorder, resources } = recorderHarness();
  await assert.rejects(PcmRecorder.start(12, () => {}, () => {}, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(resources.acquisitions, 0); assert.equal(resources.contexts, 0);
});

test("abort while permission is pending rejects immediately and stops a late-acquired stream", { timeout: 2000 }, async () => {
  const acquisitionGate = deferred(); const controller = new AbortController();
  const { PcmRecorder, resources } = recorderHarness({ acquisitionGate }); const callbacks = [];
  const pending = PcmRecorder.start(12, () => {}, reason => callbacks.push(reason), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(resources.stops, 0); assert.equal(resources.contexts, 0);
  acquisitionGate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resources.stops, 1); assert.equal(resources.contexts, 0); assert.equal(resources.worklets, 0);
  assert.deepEqual(callbacks, []);
});

test("abort during a stalled worklet module releases the acquired microphone without creating a node", { timeout: 2000 }, async () => {
  const moduleGate = deferred(); const controller = new AbortController();
  const harness = recorderHarness({ moduleGate }); const callbacks = [];
  const pending = harness.PcmRecorder.start(12, () => {}, reason => callbacks.push(reason), { signal: controller.signal });
  await harness.moduleStarted;
  assert.equal(harness.resources.stops, 0); assert.equal(harness.resources.contexts, 1);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(harness.resources.stops, 1); assert.equal(harness.resources.closes, 1); assert.equal(harness.resources.worklets, 0);
  moduleGate.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.resources.worklets, 0); assert.equal(harness.resources.stops, 1);
  assert.deepEqual(callbacks, []);
});

test("abort during a stalled resume rejects promptly and does not resume recording later", { timeout: 2000 }, async () => {
  const resumeGate = deferred(); const controller = new AbortController();
  const harness = recorderHarness({ resumeGate }); const callbacks = [];
  const pending = harness.PcmRecorder.start(12, () => {}, reason => callbacks.push(reason), { signal: controller.signal });
  await harness.resumeStarted;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(harness.resources.stops, 1); assert.equal(harness.resources.closes, 1);
  resumeGate.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.resources.node.port.onmessage, null); assert.equal(harness.resources.stops, 1);
  assert.deepEqual(callbacks, []);
});

test("active abort stops capture once without invoking an auto-stop callback", async () => {
  const controller = new AbortController(); const harness = recorderHarness(); const callbacks = [];
  const recording = await harness.PcmRecorder.start(12, () => {}, reason => callbacks.push(reason), { signal: controller.signal, stopOnSilence: true });
  const lateMessage = harness.resources.node.port.onmessage;
  harness.emit(.04, 500);
  controller.abort(); recording.dispose(); controller.abort();
  lateMessage({ data: new Float32Array(12000) });
  assert.equal(harness.resources.stops, 1); assert.equal(harness.resources.closes, 1);
  assert.deepEqual(callbacks, []);
});
