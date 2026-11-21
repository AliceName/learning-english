"use client";

import { useEffect, useRef, useState } from "react";
import BookmarkButton from "@/components/bookmarks/bookmark-button";
import Icon from "@/components/site-icon";
import type { DueFlashcard, Flashcard } from "@/lib/flashcards";
import StudyCard, { type StudyDirection } from "./study-card";
import styles from "./flashcards.module.css";

export type ReviewSession = {
  id: number;
  mode: "today" | "deck" | "preview" | "practice";
  cards: DueFlashcard[];
  currentIndex: number;
  ratings: Partial<Record<number, number>>;
};

const ratingLabels = ["Quên", "Khó", "Nhớ", "Dễ"];

function ReviewTurn({ account, card, direction, typing, scheduled, rating, busy, onRate, onPrevious, onNext }: {
  account?: string; card: Flashcard; direction: StudyDirection; typing: boolean;
  scheduled: boolean; rating?: number; busy: boolean; onRate: (rating: number) => void;
  onPrevious?: () => void; onNext?: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [answer, setAnswer] = useState("");
  const flipRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => (inputRef.current ?? flipRef.current)?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  return <>
    <StudyCard account={account} card={card} direction={direction} flipped={flipped} busy={busy} flipRef={flipRef} onFlip={setFlipped}
      onPrevious={onPrevious} onNext={onNext} />
    {typing && (!flipped ? <form className={styles.reviewAnswer} onSubmit={event => {
      event.preventDefault();
      if (busy) return;
      setFlipped(true);
      flipRef.current?.focus({ preventScroll: true });
    }}>
      <label>Câu trả lời của bạn
        <input ref={inputRef} value={answer} disabled={busy} onChange={event => setAnswer(event.target.value)} maxLength={1000}
          lang={direction === "en-vi" ? "vi" : "en"} spellCheck={false} autoComplete="off" />
      </label>
      <button type="submit" disabled={busy}>Xem đáp án</button>
    </form> : answer.trim() && <div className={styles.submittedAnswer}>
      <strong>Câu trả lời của bạn</strong>
      <p lang={direction === "en-vi" ? "vi" : "en"}>{answer.trim()}</p>
    </div>)}
    {rating !== undefined ? <p className={styles.studyHelp}><Icon name="check" /> Bạn đã chọn {ratingLabels[rating]}.</p>
      : flipped ? <div className={styles.ratings} role="group" aria-label="Tự đánh giá mức ghi nhớ">
      {ratingLabels.map((label, rating) => <button type="button" key={label} disabled={busy} onClick={() => onRate(rating)}>
        <strong>{label}</strong>{scheduled && <small>{rating === 0 ? "Ôn lại sau 5 phút" : "Lên lịch lần tới"}</small>}
      </button>)}
    </div> : <p className={styles.studyHelp}><Icon name="bulb" />
      {typing ? "Nhập đáp án hoặc lật thẻ để kiểm tra." : "Tự nhớ đáp án, rồi lật thẻ để kiểm tra."}
    </p>}
  </>;
}

export default function FlashcardReview({ session, account, busy, error, onRate, onMove, onClose, onRestart, onOpenAll }: {
  session: ReviewSession; account?: string; busy: boolean; error: string;
  onRate: (rating: number) => void; onMove: (step: -1 | 1) => void;
  onClose: () => void; onRestart: () => void; onOpenAll?: () => void;
}) {
  const [direction, setDirection] = useState<StudyDirection>("en-vi");
  const [typing, setTyping] = useState(false);
  const { cards, currentIndex } = session;
  const current = cards[currentIndex];
  const total = cards.length;
  const ratings = Object.values(session.ratings);
  const reviewed = ratings.length;
  const rating = current && session.ratings[current.card.cardId];
  const preview = session.mode === "preview";
  const today = session.mode === "today";
  const scheduled = today || session.mode === "deck";
  const summaryRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!current) summaryRef.current?.focus({ preventScroll: true });
  }, [current]);

  return <section className={`${styles.panel} ${styles.studyPanel}`} aria-label="Ôn tập thẻ">
    <div className={styles.top}>
      <h2>{scheduled ? "Phiên ôn tập" : preview ? "Phiên ôn thử" : "Ôn tất cả thẻ"}</h2>
      <div className={styles.reviewNavigation}>
        <span aria-live="polite">Đã đánh giá {reviewed} / {total} thẻ</span>
        <button type="button" disabled={busy} onClick={onClose}>{today ? "Về thư viện" : "Về bộ thẻ"}</button>
      </div>
    </div>
    <progress className={styles.progress} value={reviewed} max={Math.max(total, 1)} aria-label="Tiến độ phiên ôn" />
    {!scheduled && <p>Kết quả tự đánh giá chỉ được giữ trong phiên này.</p>}
    {busy && <p role="status">Đang cập nhật phiên ôn…</p>}
    {current ? <>
      <div className={styles.reviewOptions}>
        <div className={styles.tabs} role="group" aria-label="Chiều ôn">
          <button type="button" disabled={busy} aria-pressed={direction === "en-vi"} onClick={() => setDirection("en-vi")}>Anh → Việt</button>
          <button type="button" disabled={busy} aria-pressed={direction === "vi-en"} onClick={() => setDirection("vi-en")}>Việt → Anh</button>
        </div>
        <div className={styles.reviewUtilities}>
          <label><input type="checkbox" checked={typing} disabled={busy} onChange={event => setTyping(event.target.checked)} /> Gõ đáp án trước khi lật</label>
          <BookmarkButton key={current.card.cardId} targetType="flashcard" targetId={current.card.cardId} title="thẻ đang ôn" disabled={busy} />
        </div>
      </div>
      <p className={styles.reviewSource} aria-live="polite"><strong>Thẻ {currentIndex + 1} / {total}</strong>
        {today && <> · Bộ thẻ <strong>{current.deckTitle}</strong></>}</p>
      {total === 1 && <div className={styles.reviewSingle}>
        <p>{scheduled ? "Phiên này có 1 thẻ đến hạn." : "Phiên này có 1 thẻ."}</p>
        {onOpenAll && <button type="button" disabled={busy} onClick={onOpenAll}>Ôn tất cả thẻ</button>}
      </div>}
      <ReviewTurn key={`${session.id}:${current.card.cardId}:${direction}`} account={account} card={current.card}
        direction={direction} typing={typing && rating === undefined} scheduled={scheduled} rating={rating} busy={busy} onRate={onRate}
        onPrevious={currentIndex > 0 ? () => onMove(-1) : undefined} onNext={currentIndex < total - 1 ? () => onMove(1) : undefined} />
    </> : <div className={styles.complete}>
      <h3 ref={summaryRef} tabIndex={-1}>{total ? "Bạn đã hoàn thành phiên ôn!" : scheduled ? "Chưa có thẻ đến hạn" : "Bộ thẻ chưa có từ"}</h3>
      {total ? scheduled ? <p>Đã lưu đánh giá cho {reviewed} thẻ.</p> : <ul className={styles.previewResults} aria-label="Kết quả tự đánh giá">
        {ratingLabels.map((label, rating) => <li key={label}><span>{label}</span><strong>{ratings.filter(value => value === rating).length}</strong></li>)}
      </ul> : scheduled && <p>Bạn có thể thêm thẻ mới hoặc quay lại khi đến lịch ôn.</p>}
      <button type="button" disabled={busy} onClick={onRestart}>
        {scheduled ? today && total ? "Ôn tiếp" : "Kiểm tra lịch mới" : preview ? "Ôn thử lại" : "Ôn lại"}
      </button>
      {onOpenAll && <button type="button" disabled={busy} onClick={onOpenAll}>Ôn tất cả thẻ</button>}
    </div>}
    {error && <div className={styles.reviewError} role="alert">
      <p className={styles.error}>{error}</p>
      {current && <button type="button" disabled={busy} onClick={onRestart}>Tải lại phiên ôn</button>}
    </div>}
  </section>;
}
