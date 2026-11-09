"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { safeDictionaryUrl, type DictionaryPhonetic, type VocabularyResponse } from "@/lib/vocabulary";
import styles from "./dictionary.module.css";

const maxFileBytes = 5 * 1024 * 1024;
const maxMemoryBytes = 24 * 1024 * 1024;
const maxTracks = 16;

export type AudioAttribution = { provider: string; sourceUrl: string | null; fileUrl: string; author: string | null; licenseName: string | null; licenseUrl: string | null; locale: string | null };
export type PreparedAudioAsset = { status: "preparing" | "loaded" | "error"; url?: string; attribution?: AudioAttribution; error?: string; retryable?: boolean };
type Selection = { key: string; entry: number; phonetic: number };

export function dictionaryAudioKey(phonetic: DictionaryPhonetic) {
  const source = safeDictionaryUrl(phonetic.sourceUrl);
  if (source) {
    const uri = new URL(source);
    if (uri.hostname === "commons.wikimedia.org") {
      const id = uri.searchParams.get("curid");
      if (uri.pathname === "/w/index.php" && id && /^[1-9]\d*$/.test(id)) return `commons:page:${id}`;
      if (uri.pathname.toLowerCase().startsWith("/wiki/file:")) {
        try { return `commons:title:${decodeURIComponent(uri.pathname.slice(6)).replaceAll("_", " ").normalize()}`; } catch { /* Fall back to a valid audio URL. */ }
      }
    }
  }
  return safeDictionaryUrl(phonetic.audio);
}

async function problem(response: Response) {
  const body = await response.json().catch(() => null);
  return new Error(typeof body?.title === "string" ? body.title : "Chưa chuẩn bị được âm thanh. Vui lòng thử lại.");
}

export async function audioBlob(response: Response, expectedBytes: number, token: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Chưa đọc được bản thu.");
  const chunks: ArrayBuffer[] = []; let total = 0;
  try {
    while (true) {
      token.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxFileBytes || total > expectedBytes) throw new Error("Bản thu vượt quá kích thước cho phép.");
      chunks.push(value.slice().buffer as ArrayBuffer);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (total !== expectedBytes || total < 32) throw new Error("Bản thu chưa tải đủ. Vui lòng thử lại.");
  return new Blob(chunks, { type: response.headers.get("content-type")?.split(";")[0] });
}

export function usePreparedDictionaryAudio(result: VocabularyResponse, onUnauthorized: () => void) {
  const [assets, setAssets] = useState<Record<string, PreparedAudioAsset>>({});
  const retryRef = useRef<(key: string) => void>(() => {});

  useEffect(() => {
    if (result.direction && result.direction !== "en-en") return;
    const selections = new Map<string, Selection>();
    result.entries.forEach((entry, entryIndex) => entry.phonetics.forEach((phonetic, phoneticIndex) => {
      const key = dictionaryAudioKey(phonetic);
      if (key && !selections.has(key)) selections.set(key, { key, entry: entryIndex, phonetic: phoneticIndex });
    }));
    const controller = new AbortController();
    const urls = new Map<string, { url: string; size: number }>();
    const queue = [...selections.values()].slice(0, maxTracks);
    const queued = new Set(queue.map(selection => selection.key));
    let disposed = false, running = 0, bytesInMemory = 0;
    const release = (key: string) => {
      const file = urls.get(key);
      if (file) { URL.revokeObjectURL(file.url); bytesInMemory -= file.size; urls.delete(key); }
    };
    const prepare = async (selection: Selection) => {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(165_000)]);
      const response = await fetch("/api/vocabulary/audio/prepare", { method: "POST", cache: "no-store", signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ word: result.word, entry: selection.entry, phonetic: selection.phonetic }) });
      signal.throwIfAborted();
      if (response.status === 401) onUnauthorized();
      if (!response.ok) throw await problem(response);
      const ready = await response.json();
      signal.throwIfAborted();
      if (ready.status !== "ready" || typeof ready.playbackUrl !== "string" || !Number.isInteger(ready.sizeBytes) || ready.sizeBytes < 32 || ready.sizeBytes > maxFileBytes)
        throw new Error("Bản thu chưa sẵn sàng để tải.");
      const target = new URL(ready.playbackUrl, window.location.origin);
      if (target.origin !== window.location.origin || target.pathname !== "/api/vocabulary/audio") throw new Error("Đường dẫn phát âm chưa hợp lệ.");
      const file = await fetch(target, { cache: "no-store", signal });
      signal.throwIfAborted();
      if (file.status === 401) onUnauthorized();
      if (!file.ok) throw await problem(file);
      const type = file.headers.get("content-type")?.split(";")[0];
      if (!["audio/ogg", "audio/mpeg", "audio/wav"].includes(type ?? "") || type !== ready.contentType)
        throw new Error("Nguồn chưa trả tệp âm thanh hợp lệ.");
      const blob = await audioBlob(file, ready.sizeBytes, signal);
      if (disposed) return;
      if (bytesInMemory + blob.size > maxMemoryBytes) throw new Error("Đã đạt giới hạn bộ nhớ âm thanh của kết quả này.");
      release(selection.key);
      const url = URL.createObjectURL(blob); bytesInMemory += blob.size; urls.set(selection.key, { url, size: blob.size });
      setAssets(values => ({ ...values, [selection.key]: { status: "loaded", url, attribution: ready.attribution } }));
    };
    const pump = () => {
      while (!disposed && running < 2 && queue.length) {
        const selection = queue.shift()!; running++;
        void (async () => {
          try { await prepare(selection); }
          catch (error) {
            if (!disposed) setAssets(values => ({ ...values, [selection.key]: { status: "error", error: error instanceof Error && error.name === "Error" ? error.message : error instanceof Error && error.name === "TimeoutError" ? "Chuẩn bị âm thanh quá thời gian chờ. Hãy thử lại." : "Chưa tải được âm thanh. Vui lòng thử lại." } }));
          } finally { running--; queued.delete(selection.key); pump(); }
        })();
      }
    };
    retryRef.current = key => {
      const selection = selections.get(key);
      if (!selection || [...selections.keys()].indexOf(key) >= maxTracks || queued.has(key) || disposed) return;
      release(key); setAssets(values => ({ ...values, [key]: { status: "preparing" } }));
      queued.add(key); queue.push(selection); pump();
    };
    // Let a Strict Mode setup/cleanup cycle finish before starting network work.
    queueMicrotask(pump);
    return () => {
      disposed = true; controller.abort(); retryRef.current = () => {};
      for (const file of urls.values()) URL.revokeObjectURL(file.url);
      urls.clear();
    };
  }, [result, onUnauthorized]);

  const retry = useCallback((key: string) => retryRef.current(key), []);
  const fail = useCallback((key: string) => setAssets(values => ({ ...values, [key]: { status: "error", error: "Trình duyệt chưa phát được bản thu này. Vui lòng thử lại." } })), []);
  const keys = [...new Set(result.entries.flatMap(entry => entry.phonetics.map(dictionaryAudioKey).filter((key): key is string => !!key)))];
  const get = (key: string): PreparedAudioAsset => keys.indexOf(key) >= maxTracks
    ? { status: "error", retryable: false, error: "Kết quả này có nhiều bản thu. Hãy tra cụ thể hơn để chuẩn bị âm thanh." }
    : assets[key] ?? { status: "preparing" };
  return { get, retry, fail };
}

export function PreparedDictionaryAudio({ asset, label, onRetry, onFailure }: { asset: PreparedAudioAsset; label: string; onRetry: () => void; onFailure: () => void }) {
  if (asset.status === "error") return <div className={styles.audioError}><p role="status">{asset.error}</p>{asset.retryable !== false && <button type="button" onClick={onRetry}>Thử lại âm thanh</button>}</div>;
  if (!asset.url) return <div className={styles.audioLoading} role="status"><span className={styles.audioSpinner} aria-hidden="true" /><button type="button" disabled aria-label={`Đang chuẩn bị ${label}`}>Đang chuẩn bị âm thanh…</button></div>;
  return <ReadyPlayer key={asset.url} url={asset.url} label={label} onFailure={onFailure} />;
}

function ReadyPlayer({ url, label, onFailure }: { url: string; label: string; onFailure: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [ready, setReady] = useState(false), [playing, setPlaying] = useState(false);
  useEffect(() => { const node = audio.current; return () => { node?.pause(); }; }, []);
  return <div className={styles.audioPlayer}>
    <audio ref={audio} src={url} preload="auto" aria-hidden="true" onCanPlay={() => setReady(true)} onError={onFailure}
      onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} onPlay={event => {
        event.currentTarget.closest("[data-dictionary-results]")?.querySelectorAll("audio").forEach(other => { if (other !== event.currentTarget) other.pause(); });
        setPlaying(true);
      }} />
    <button type="button" disabled={!ready} aria-label={ready ? `${playing ? "Dừng" : "Nghe"} ${label}` : `Đang chuẩn bị ${label}`} aria-pressed={playing}
      onClick={() => { const node = audio.current; if (!node || !ready) return; if (playing) { node.pause(); node.currentTime = 0; } else { node.currentTime = 0; void node.play().catch(onFailure); } }}>
      <span aria-hidden="true">{playing ? "■" : "▶"}</span>{ready ? `${playing ? "Dừng" : "Nghe"} ${label}` : "Đang chuẩn bị âm thanh…"}
    </button>
  </div>;
}
