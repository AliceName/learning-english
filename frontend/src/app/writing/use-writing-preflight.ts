"use client";

import { useEffect, useState } from "react";
import { isWritingPreflight, type WritingPreflight } from "@/lib/writing-capabilities";

export type PreflightSnapshot = { text: string; corrections: boolean; value: WritingPreflight | null; error: string };

export async function checkWritingPreflight(text: string, corrections: boolean, signal?: AbortSignal): Promise<WritingPreflight> {
  const response = await fetch("/api/writing/preflight", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ originalText: text, corrections }), cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = value && typeof value === "object" ? value as Record<string, unknown> : {};
    throw new Error(typeof error.detail === "string" ? error.detail
      : typeof error.title === "string" ? error.title : "Chưa kiểm tra được giới hạn xử lý. Bản nháp vẫn được giữ.");
  }
  if (!isWritingPreflight(value, text, corrections)) throw new Error("Kết quả kiểm tra giới hạn chưa hợp lệ. Hãy thử lại.");
  return value;
}

export function useWritingPreflight(text: string, corrections: boolean, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<PreflightSnapshot | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !text.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const value = await checkWritingPreflight(text, corrections, controller.signal);
        if (!controller.signal.aborted) setSnapshot({ text, corrections, value, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setSnapshot({ text, corrections, value: null,
          error: error instanceof Error ? error.message : "Chưa kiểm tra được giới hạn xử lý." });
      }
    }, 650);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [text, corrections, enabled, retry]);
  const current = snapshot?.text === text && snapshot.corrections === corrections ? snapshot : null;
  return { current, retry: () => setRetry(value => value + 1), remember: setSnapshot };
}
