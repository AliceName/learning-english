import { RecordingSilenceDetector } from "./recording-silence";

export type RecordingStopReason = "limit" | "silence";
export type RecordingOptions = { stopOnSilence?: boolean; silenceSeconds?: number; signal?: AbortSignal };

function recordingAbortError() {
  const error = new Error("Đã hủy mở microphone.");
  error.name = "AbortError";
  return error;
}

function waitForRecording<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(recordingAbortError()); };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

export class PcmRecorder {
  private chunks: Float32Array[] = [];
  private samples = 0;
  private closed = false;
  private encoding: Promise<Blob> | undefined;
  private releaseAbortListener: (() => void) | undefined;
  private constructor(private context: AudioContext, private stream: MediaStream, private node: AudioWorkletNode,
    private source: MediaStreamAudioSourceNode, private gain: GainNode) {}

  static async start(maxSeconds: number, tick: (seconds: number, level: number) => void,
    autoStop: (reason?: RecordingStopReason) => void, options: RecordingOptions = {}) {
    const signal = options.signal;
    const checkCancelled = () => { if (signal?.aborted) throw recordingAbortError(); };
    checkCancelled();
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode)
      throw new Error("Trình duyệt chưa hỗ trợ ghi âm tại đây. Hãy dùng Chrome/Edge trên localhost hoặc HTTPS, hoặc tải tệp WAV.");
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let recording: PcmRecorder | undefined;
    let streamStopped = false;
    let contextClosed = false;
    const releaseResources = () => {
      if (recording) recording.dispose();
      else {
        if (stream && !streamStopped) { streamStopped = true; stream.getTracks().forEach(track => track.stop()); }
        if (context && !contextClosed) { contextClosed = true; void context.close().catch(() => {}); }
      }
    };
    const onAbort = () => releaseResources();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const acquisition = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(value => {
        if (signal?.aborted) {
          // getUserMedia cannot be cancelled; stop a late permission result.
          value.getTracks().forEach(track => track.stop());
          throw recordingAbortError();
        }
        stream = value;
        return value;
      });
      const input = await waitForRecording(acquisition, signal);
      checkCancelled();
      context = new AudioContext();
      checkCancelled();
      await waitForRecording(context.audioWorklet.addModule("/audio/pcm-recorder.js"), signal);
      checkCancelled();
      const node = new AudioWorkletNode(context, "linguaai-pcm-recorder");
      const source = context.createMediaStreamSource(input); const gain = context.createGain(); gain.gain.value = 0;
      source.connect(node); node.connect(gain); gain.connect(context.destination);
      const active = new PcmRecorder(context, input, node, source, gain);
      recording = active;
      active.releaseAbortListener = () => signal?.removeEventListener("abort", onAbort);
      checkCancelled();
      const limit = Number.isFinite(maxSeconds) ? Math.max(.3, Math.min(12, maxSeconds)) : 12;
      const silence = new RecordingSilenceDetector({ enabled: options.stopOnSilence, silenceSeconds: options.silenceSeconds });
      const sampleRate = context.sampleRate; let lastTick = 0;
      const stop = (reason: RecordingStopReason) => {
        if (active.closed) return;
        // Release the microphone even if the caller cannot encode immediately.
        active.dispose();
        autoStop(reason);
      };
      await waitForRecording(context.resume(), signal);
      checkCancelled();
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (active.closed) return;
        const remaining = Math.floor(limit * sampleRate) - active.samples;
        const chunk = event.data.subarray(0, Math.max(0, remaining));
        if (!chunk.length) { if (remaining <= 0) stop("limit"); return; }
        active.chunks.push(chunk); active.samples += chunk.length;
        let sum = 0; for (const value of chunk) sum += value * value;
        const rms = Math.sqrt(sum / chunk.length);
        const seconds = active.samples / sampleRate;
        const endedBySilence = silence.addFrame(rms, chunk.length / sampleRate);
        if (seconds - lastTick >= .08) {
          tick(seconds, Number.isFinite(rms) ? Math.min(1, rms * 6) : 0); lastTick = seconds;
        }
        if (remaining <= event.data.length) stop("limit");
        else if (endedBySilence) stop("silence");
      };
      return active;
    } catch (error) {
      releaseResources();
      signal?.removeEventListener("abort", onAbort);
      throw error;
    }
  }

  dispose() {
    if (this.closed) return;
    this.closed = true; this.node.port.onmessage = null;
    this.releaseAbortListener?.(); this.releaseAbortListener = undefined;
    this.source.disconnect(); this.node.disconnect(); this.gain.disconnect();
    this.stream.getTracks().forEach(track => track.stop()); void this.context.close().catch(() => {});
  }

  finish(): Promise<Blob> {
    this.encoding ??= this.encodeRecording();
    return this.encoding;
  }

  private async encodeRecording(): Promise<Blob> {
    const rate = this.context.sampleRate; this.dispose();
    if (this.samples < rate * .3) throw new Error("Bản ghi quá ngắn. Hãy đọc đủ câu hoặc cụm đang chọn rồi dừng.");
    const pcm = new Float32Array(this.samples); let offset = 0;
    for (const chunk of this.chunks) { pcm.set(chunk, offset); offset += chunk.length; }
    this.chunks = [];
    const offline = new OfflineAudioContext(1, Math.ceil(pcm.length * 16000 / rate), 16000);
    const input = offline.createBuffer(1, pcm.length, rate); input.getChannelData(0).set(pcm);
    const source = offline.createBufferSource(); source.buffer = input; source.connect(offline.destination); source.start();
    const output = (await offline.startRendering()).getChannelData(0);
    return encodeWav(output, 16000);
  }
}

export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2); const view = new DataView(buffer);
  const text = (position: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(position + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const value = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); }
  return new Blob([buffer], { type: "audio/wav" });
}
