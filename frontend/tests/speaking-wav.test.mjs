import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const directory = path.dirname(fileURLToPath(import.meta.url));

const source = fs.readFileSync(path.join(directory, "../src/lib/pcm-recorder.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const sandbox = { exports: {}, Blob, require: dependency => {
  if (dependency !== "./recording-silence") throw new Error(`Unexpected module: ${dependency}`);
  const child = { exports: {} };
  const detector = fs.readFileSync(path.join(directory, "../src/lib/recording-silence.ts"), "utf8");
  vm.runInNewContext(ts.transpileModule(detector, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, child);
  return child.exports;
} };
vm.runInNewContext(compiled.outputText, sandbox);
const { encodeWav } = sandbox.exports;

test("WAV encoder produces PCM16 mono with correct rate, size and clamped samples", async () => {
  const blob = encodeWav(new Float32Array([-2, -.5, 0, .5, 2]), 16000);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString(), "WAVE");
  assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
  assert.equal(bytes.readUInt16LE(20), 1);
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt32LE(24), 16000);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => bytes.readInt16LE(44 + 2 * i)), [-32768, -16384, 0, 16384, 32767]);
});

test("12-second recording stays within backend upload limit", async () => {
  const blob = encodeWav(new Float32Array(12 * 16000), 16000);
  assert.equal(blob.size, 384044);
  assert.equal(blob.type, "audio/wav");
});

test("actual model accepts WAV encoded by the frontend", { skip: !process.env.SPEAKING_LIVE_TEST_AUDIO }, async () => {
  const original = fs.readFileSync(process.env.SPEAKING_LIVE_TEST_AUDIO);
  let offset = 12; let data;
  while (offset + 8 <= original.length) {
    const size = original.readUInt32LE(offset + 4);
    if (original.subarray(offset, offset + 4).toString() === "data") { data = original.subarray(offset + 8, offset + 8 + size); break; }
    offset += 8 + size + (size % 2);
  }
  assert.ok(data);
  const samples = Float32Array.from({ length: data.length / 2 }, (_, i) => data.readInt16LE(i * 2) / 32768);
  const form = new FormData(); form.append("file", encodeWav(samples, 16000), "recording.wav"); form.append("text", "We call it bear");
  const response = await fetch("http://127.0.0.1:8001/score", { method: "POST", body: form });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.overallScore >= 0 && result.overallScore <= 100);
  assert.ok(result.words.some(word => word.phones.length > 0));
});
