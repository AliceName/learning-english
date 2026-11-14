"use client";

import { useEffect, useRef, useState } from "react";
import type { DictionaryDefinition, VocabularyResponse } from "@/lib/vocabulary";
import { audioBlob } from "./dictionary-audio";
import styles from "./dictionary.module.css";

export function useDefinitionAudio(result: VocabularyResponse, onUnauthorized: () => void) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const tracks = useRef(new Map<string, { url: string; bytes: number }>());
  const retryTimes = useRef(new Map<string, number>());
  const [state, setState] = useState<{ id: string; status: "loading" | "playing" | "idle" | "error"; message?: string }>({ id: "", status: "idle" });

  useEffect(() => {
    const node = new Audio();
    node.preload = "none";
    audio.current = node;
    node.onended = () => setState(previous => ({ ...previous, status: "idle" }));
    node.onerror = () => setState(previous => ({ ...previous, status: "error", message: "Trình duyệt chưa phát được giọng đọc. Hãy thử lại." }));
    const cached = tracks.current;
    const retries = retryTimes.current;
    const requests = generation;
    const controller = pending;
    return () => {
      requests.current++; controller.current?.abort(); node?.pause();
      node.onended = null; node.onerror = null; node.removeAttribute("src");
      audio.current = null;
      for (const track of cached.values()) URL.revokeObjectURL(track.url);
      cached.clear(); retries.clear();
    };
  }, [result]);

  async function play(definition: DictionaryDefinition) {
    const id = definition.definitionId;
    const node = audio.current;
    if (!id || !definition.definitionAudio?.canPrepare || !node) return;
    if (state.id === id && state.status === "playing") { node.pause(); setState({ id, status: "idle" }); return; }
    const attempt = ++generation.current;
    pending.current?.abort(); node.pause();
    const controller = new AbortController(); pending.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(100_000)]);
    setState({ id, status: "loading" });
    try {
      if ((retryTimes.current.get(id) ?? 0) > Date.now()) throw new Error("Hãy chờ một lát trước khi thử lại giọng đọc.");
      let track = tracks.current.get(id);
      if (!track) {
        const readyResponse = await fetch("/api/vocabulary/definition-audio/prepare", {
          method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, signal,
          body: JSON.stringify({ word: result.word, direction: result.direction, definitionId: id }),
        });
        if (readyResponse.status === 401) { onUnauthorized(); return; }
        const ready = await readyResponse.json().catch(() => null);
        signal.throwIfAborted();
        const retryAfter = readyResponse.headers.get("retry-after");
        if (retryAfter) {
          const seconds = Number(retryAfter);
          const retryAt = Number.isFinite(seconds) ? Date.now() + Math.min(Math.max(seconds, 0), 3600) * 1000 : Date.parse(retryAfter);
          if (Number.isFinite(retryAt)) retryTimes.current.set(id, retryAt);
        }
        if (!readyResponse.ok) throw new Error(ready?.title ?? "Chưa chuẩn bị được giọng đọc. Hãy thử lại.");
        if (ready?.status !== "ready" || ready.definitionId !== id || ready.contentType !== "audio/mpeg" ||
          !Number.isInteger(ready.sizeBytes) || ready.sizeBytes < 32 || ready.sizeBytes > 5 * 1024 * 1024 || typeof ready.playbackUrl !== "string")
          throw new Error("Dữ liệu giọng đọc chưa hợp lệ.");
        const target = new URL(ready.playbackUrl, window.location.origin);
        if (target.origin !== window.location.origin || target.pathname !== "/api/vocabulary/definition-audio") throw new Error("Đường dẫn giọng đọc chưa hợp lệ.");
        const response = await fetch(target, { cache: "no-store", signal });
        if (response.status === 401) { onUnauthorized(); return; }
        if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "audio/mpeg") throw new Error("Chưa tải được giọng đọc. Hãy thử lại.");
        const blob = await audioBlob(response, ready.sizeBytes, signal);
        signal.throwIfAborted();
        if (generation.current !== attempt) return;
        let total = [...tracks.current.values()].reduce((sum, item) => sum + item.bytes, 0);
        while (tracks.current.size && (tracks.current.size >= 16 || total + blob.size > 24 * 1024 * 1024)) {
          const oldest = tracks.current.keys().next().value!;
          const previous = tracks.current.get(oldest)!;
          URL.revokeObjectURL(previous.url); total -= previous.bytes; tracks.current.delete(oldest);
        }
        track = { url: URL.createObjectURL(blob), bytes: blob.size }; tracks.current.set(id, track);
      }
      if (generation.current !== attempt) return;
      node.src = track.url; node.currentTime = 0;
      await node.play();
      if (generation.current === attempt) setState({ id, status: "playing" });
    } catch (error) {
      if (!controller.signal.aborted && generation.current === attempt)
        setState({ id, status: "error", message: error instanceof Error && error.name === "Error" ? error.message : "Chưa phát được giọng đọc. Bấm để thử lại." });
    }
  }

  return { state, play };
}

export function DefinitionAudioButton({ definition, player }: { definition: DictionaryDefinition; player: ReturnType<typeof useDefinitionAudio> }) {
  if (!definition.definitionId || !definition.definitionAudio?.canPrepare) return null;
  const selected = player.state.id === definition.definitionId;
  const loading = selected && player.state.status === "loading";
  const playing = selected && player.state.status === "playing";
  return <div className={styles.definitionAudio}>
    <button type="button" disabled={loading} aria-pressed={playing} aria-label={`${playing ? "Dừng" : "Nghe"} nghĩa ${definition.definition}`}
      onClick={() => void player.play(definition)}>{loading ? "Đang tạo giọng đọc…" : playing ? "■ Dừng" : "▶ Nghe nghĩa"}</button>
    <small>Giọng tổng hợp tiếng Việt</small>
    {selected && player.state.status === "error" && <p role="status">{player.state.message}</p>}
  </div>;
}
