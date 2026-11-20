"use client";

import { useEffect, useRef, useState } from "react";
import { SESSION_CHANGED } from "@/lib/session-events";

export function useLessonSession() {
  const signal = useRef<AbortController | null>(null);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    signal.current = abort;
    const invalidate = () => { abort.abort(); setInvalid(true); };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SESSION_CHANGED);
    if (channel) channel.onmessage = invalidate;
    window.addEventListener(SESSION_CHANGED, invalidate);
    return () => { abort.abort(); channel?.close(); window.removeEventListener(SESSION_CHANGED, invalidate); };
  }, []);
  return { signal, invalid };
}
