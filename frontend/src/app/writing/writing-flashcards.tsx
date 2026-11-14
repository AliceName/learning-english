import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/site-icon";
import type { Deck } from "@/lib/flashcards";
import styles from "./writing.module.css";

type Candidate = { term: string; context: string; source: "correction" | "original"; reason: string; similarCardId: number | null };
type DraftCard = Candidate & {
  selected: boolean; frontText: string; backText: string; exampleSentence: string;
  saved?: string; error?: string;
};

async function request<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
  const response = await fetch(`/api/flashcards/${path}`, {
    signal, cache: "no-store",
    ...(body && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new Error(problem?.detail || problem?.title || "Chưa kết nối được bộ thẻ.");
  }
  return response.json();
}

export default function WritingFlashcards({ submissionId, versionNumber, targetCefr }: {
  submissionId: number; versionNumber?: number | null; targetCefr?: string | null;
}) {
  const [cards, setCards] = useState<DraftCard[] | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckId, setDeckId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const selected = cards?.filter(card => card.selected && !card.saved) ?? [];
  const ready = selected.length > 0 && selected.every(card => card.frontText.trim() && card.backText.trim());

  function update(term: string, patch: Partial<DraftCard>) {
    setCards(current => current?.map(card => card.term === term ? { ...card, ...patch } : card) ?? null);
  }

  async function load() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(""); setMessage("");
    try {
      const [suggestions, available] = await Promise.all([
        request<{ submissionId: number; items: Candidate[] }>(`writing/${submissionId}`, controller.signal),
        request<Deck[]>("decks", controller.signal),
      ]);
      if (suggestions.submissionId !== submissionId) throw new Error("Chưa xác minh được phiên bản nguồn.");
      const owned = available.filter(deck => deck.canEdit);
      setDecks(owned); setDeckId(owned[0]?.deckId ?? null);
      setCards(suggestions.items.map(item => ({
        ...item, selected: false, frontText: item.term, backText: "", exampleSentence: item.source === "original" ? item.context : "",
      })));
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "Chưa tải được gợi ý.");
    } finally { active.current = null; if (!controller.signal.aborted) setBusy(false); }
  }

  async function save() {
    if (active.current || deckId === null || !ready) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setMessage("");
    let saved = 0, existing = 0, failed = 0;
    try {
      for (const card of selected) {
        try {
          const result = await request<{ alreadySaved: boolean }>(`decks/${deckId}/writing/${submissionId}`, controller.signal, {
            sourceTerm: card.term, frontText: card.frontText, backText: card.backText, exampleSentence: card.exampleSentence,
          });
          if (result.alreadySaved) existing++; else saved++;
          update(card.term, { selected: false, saved: result.alreadySaved ? "Đã có thẻ trùng nội dung" : "Đã lưu", error: undefined });
        } catch (problem) {
          if (controller.signal.aborted) return;
          failed++;
          update(card.term, { error: problem instanceof Error ? problem.message : "Chưa lưu được thẻ." });
        }
      }
      setMessage(`Đã thêm ${saved} thẻ · ${existing} thẻ đã có · ${failed} thẻ chưa lưu.`);
    } finally { active.current = null; if (!controller.signal.aborted) setBusy(false); }
  }

  return <section className={`${styles.feedback} ${styles.writingCards}`} aria-labelledby="writing-cards-heading" aria-busy={busy}>
    <div className={styles.toolbar}>
      <div className={styles.sectionHeading}><span className={styles.icon}><Icon name="cards" /></span>
        <h2 id="writing-cards-heading">Từ vựng đáng học từ bài viết</h2></div>
      <Link href="/flashcards" prefetch={false}>Mở Flashcards</Link>
    </div>
    <p className={styles.hint}>{versionNumber ? `Phiên bản ${versionNumber}` : `Bài #${submissionId}`}
      {targetCefr ? ` · CEFR mục tiêu ${targetCefr}` : ""}. Chọn từ muốn ôn và tự điền nghĩa phù hợp với ngữ cảnh.</p>
    {cards === null && <button type="button" disabled={busy} onClick={() => void load()}>{busy ? "Đang tìm…" : "Tìm gợi ý từ bài đã lưu"}</button>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {cards?.length === 0 && <p role="status">Chưa tìm được từ hoặc cụm từ phù hợp trong bài này.</p>}
    {!!cards?.length && <>
      <div className={styles.writingCardGrid}>
        {cards.map(card => <article className={styles.change} key={card.term}>
          <div className={styles.toolbar}><h3 lang="en">{card.term}</h3>
            <span className={styles.pill}>{card.saved ?? (card.similarCardId ? "Có thẻ tương tự" : "Chưa lưu")}</span></div>
          <p className={styles.hint}>{card.reason}</p>
          <p className={styles.hint}>Câu trong bài đã nộp</p>
          <blockquote lang="en">{card.context}</blockquote>
          {!card.saved && <>
            <label className={styles.checkbox}><input type="checkbox" disabled={busy} checked={card.selected}
              onChange={event => update(card.term, { selected: event.target.checked })} /> Chọn lưu {card.term}</label>
            <details><summary>Xem và sửa nội dung thẻ</summary>
              <div className={styles.writingCardFields}>
                <label>Mặt trước<input lang="en" maxLength={500} disabled={busy} value={card.frontText}
                  onChange={event => update(card.term, { frontText: event.target.value })} /></label>
                <label>Nghĩa hoặc mặt sau<textarea rows={2} maxLength={1000} disabled={busy} value={card.backText}
                  onChange={event => update(card.term, { backText: event.target.value })} /></label>
                <label>Câu ví dụ<textarea lang="en" rows={2} maxLength={1000} disabled={busy} value={card.exampleSentence}
                  onChange={event => update(card.term, { exampleSentence: event.target.value })} /></label>
              </div>
            </details>
          </>}
          {card.error && <p className={styles.error} role="alert">{card.error}</p>}
        </article>)}
      </div>
      {!decks.length ? <p className={styles.hint}>Tạo một bộ thẻ riêng trong Flashcards rồi quay lại để lưu.</p> : <div className={styles.editActions}>
        <label>Bộ thẻ <select className={styles.targetSelect} value={deckId ?? ""} disabled={busy}
          onChange={event => setDeckId(Number(event.target.value))}>
          {decks.map(deck => <option value={deck.deckId} key={deck.deckId}>{deck.title}{deck.isAdminDeck ? " (bộ chia sẻ)" : ""}</option>)}
        </select></label>
        <button className={styles.submit} type="button" disabled={busy || !ready} onClick={() => void save()}>
          {busy ? "Đang lưu…" : `Lưu thẻ đã chọn (${selected.length})`}
        </button>
      </div>}
      {decks.some(deck => deck.deckId === deckId && deck.isAdminDeck)
        && <p className={styles.hint}>Nội dung và câu ví dụ lưu vào bộ chia sẻ có thể được người học khác xem.</p>}
      {message && <p className={styles.hint} role="status">{message}</p>}
    </>}
  </section>;
}
