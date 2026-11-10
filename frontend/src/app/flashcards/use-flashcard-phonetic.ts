"use client";

import { useEffect, useState } from "react";
import type { VocabularyResponse } from "@/lib/vocabulary";

const headword = /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F]+(?:['-][A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F]+)*$/;

export function useFlashcardPhonetic(text: string, saved?: string, delay = 0) {
  const [result, setResult] = useState<{ word: string; ipa: string } | null>(null);
  const word = text.trim().normalize("NFC").replaceAll("’", "'").toLowerCase();
  const stored = saved?.trim();

  useEffect(() => {
    if (stored || word.length > 100 || !headword.test(word)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/vocabulary?" + new URLSearchParams({ word }), { signal: controller.signal });
        if (!response.ok) return;
        const data: VocabularyResponse = await response.json();
        for (const entry of data.entries) {
          const ipa = entry.phonetic?.trim() || entry.phonetics.find(item => item.text?.trim())?.text?.trim();
          if (ipa) {
            if (!controller.signal.aborted) setResult({ word, ipa });
            break;
          }
        }
      } catch { /* A failed lookup should never interrupt editing or review. */ }
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [word, stored, delay]);

  return stored || (result?.word === word ? result.ipa : undefined);
}
