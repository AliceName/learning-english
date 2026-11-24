"use client";

import { useEffect, useRef, useState } from "react";
import { appendPracticeResult, loadSentences, practiceSentenceKey, savePracticeResult, saveSentence, type PracticeContext, type PracticeResult, type PracticeSentence } from "@/lib/free-speaking-history";
import type { SpeakingReviewPlan } from "@/lib/free-speaking-practice";
import FreeSpeakingDialog from "./free-speaking-dialog";

export default function SpeakingReviewDialog({ account, plan, onClose }: {
  account: string; plan: SpeakingReviewPlan; onClose: () => void;
}) {
  const [initial, setInitial] = useState<PracticeSentence | null>(null);
  const [storageNotice, setStorageNotice] = useState("");
  const session = useRef(new Map<string, PracticeSentence>());

  useEffect(() => {
    let active = true;
    const { text, context } = plan.steps[0];
    const id = practiceSentenceKey(text, context);
    loadSentences(account).then(sentences => {
      if (!active) return;
      session.current = new Map(sentences.map(sentence => [sentence.id, sentence]));
      setInitial(session.current.get(id) ?? { account, id, text, saved: false, updatedAt: Date.now(), context });
    }, () => {
      if (!active) return;
      setInitial({ account, id, text, saved: false, updatedAt: Date.now(), context });
      setStorageNotice("Chưa mở được lịch sử trên trình duyệt. Bạn vẫn có thể luyện trong phiên này.");
    });
    return () => { active = false; };
  }, [account, plan]);

  async function create(text: string, context?: PracticeContext) {
    const id = practiceSentenceKey(text, context);
    const existing = session.current.get(id);
    if (existing) return existing;
    const sentence = { account, id, text, saved: false, updatedAt: Date.now(), context };
    try {
      const saved = await saveSentence(sentence);
      session.current.set(id, saved);
      return saved;
    } catch {
      setStorageNotice("Chưa lưu được vào trình duyệt. Phần luyện này chỉ có trong phiên hiện tại.");
      session.current.set(id, sentence);
      return sentence;
    }
  }

  async function score(sentence: PracticeSentence, result: PracticeResult) {
    let saved: PracticeSentence;
    try { saved = await savePracticeResult(sentence, result); }
    catch {
      saved = appendPracticeResult(session.current.get(sentence.id) ?? sentence, result);
      setStorageNotice("Chưa lưu được vào trình duyệt. Lần chấm này chỉ có trong phiên hiện tại.");
    }
    session.current.set(saved.id, saved);
    return saved;
  }

  return initial ? <FreeSpeakingDialog initialSentence={initial} initialReview={plan} storageNotice={storageNotice}
    onCreate={create} onScore={score} onClose={onClose} /> : <p role="status">Đang mở phần luyện từ…</p>;
}
