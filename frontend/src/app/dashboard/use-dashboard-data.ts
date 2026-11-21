"use client";

import { useCallback, useEffect, useState } from "react";
import type { Deck } from "@/lib/flashcards";
import { LEARNING_ACTIVITY_CHANGED, type LearningCalendar } from "@/lib/learning-activity";
import { isWritingResult, type WritingResult } from "@/lib/writing";
import { isWritingPractices, type WritingPractices } from "@/lib/writing-capabilities";

export type Load<T> = { state: "loading" } | { state: "error" } | { state: "ready"; value: T };
export type WritingRound = WritingPractices["items"][number];
/** `firstVersion` is the round's first submission (the same object as `latest` when it was never revised). */
export type WritingData = { rounds: WritingRound[]; latest: WritingResult | null; firstVersion: WritingResult | null };

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

/** Loads one source; each source keeps its own loading, error and retry so one failure never blanks the page. */
function useSource<T>(load: (signal: AbortSignal) => Promise<T>, refreshEvent?: string) {
  const [result, setResult] = useState<Load<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let controller = new AbortController();
    function run() {
      controller.abort();
      controller = new AbortController();
      const { signal } = controller;
      load(signal).then(value => { if (!signal.aborted) setResult({ state: "ready", value }); })
        .catch(() => { if (!signal.aborted) setResult({ state: "error" }); });
    }
    run();
    if (refreshEvent) window.addEventListener(refreshEvent, run);
    return () => { controller.abort(); if (refreshEvent) window.removeEventListener(refreshEvent, run); };
  }, [load, refreshEvent, attempt]);
  const retry = useCallback(() => { setResult({ state: "loading" }); setAttempt(value => value + 1); }, []);
  return [result, retry] as const;
}

const loadCalendar = async (signal: AbortSignal) => await getJson("/api/learning-activity", signal) as LearningCalendar;
const loadDecks = async (signal: AbortSignal) => {
  const value = await getJson("/api/flashcards/decks", signal);
  if (!Array.isArray(value)) throw new Error("decks");
  return value as Deck[];
};
const loadWriting = async (signal: AbortSignal): Promise<WritingData> => {
  const value = await getJson("/api/writing/practices?limit=10", signal);
  if (!isWritingPractices(value)) throw new Error("practices");
  const round = value.items[0];
  if (!round) return { rounds: [], latest: null, firstVersion: null };
  // The round's first version (its root) is only fetched when the learner has revised the essay.
  const [saved, root] = await Promise.all([
    getJson(`/api/writing/submissions/${round.latestSubmissionId}`, signal).catch(() => null),
    round.latestSubmissionId !== round.practiceRootId
      ? getJson(`/api/writing/submissions/${round.practiceRootId}`, signal).catch(() => null) : null,
  ]);
  const latest = isWritingResult(saved) ? saved : null;
  return { rounds: value.items, latest, firstVersion: isWritingResult(root) ? root : latest };
};

export function useDashboardData() {
  const [calendar, retryCalendar] = useSource(loadCalendar, LEARNING_ACTIVITY_CHANGED);
  const [decks, retryDecks] = useSource(loadDecks);
  const [writing, retryWriting] = useSource(loadWriting);
  return { calendar, decks, writing, retryCalendar, retryDecks, retryWriting };
}
