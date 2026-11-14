"use client";

import Image from "next/image";
import { useEffect, useState, type RefObject } from "react";
import Icon from "@/components/site-icon";
import { pronounceFlashcard, type Flashcard } from "@/lib/flashcards";
import { levels } from "@/lib/course-catalog";
import { deckPreferencePrefix, emptyPreferences, readPreference, type CardPreferences } from "./preferences";
import { useFlashcardPhonetic } from "./use-flashcard-phonetic";
import styles from "./flashcards.module.css";

function Example({ sentence, word }: { sentence: string; word: string }) {
  const position = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (!word || position < 0) return <>{sentence}</>;
  return <>{sentence.slice(0, position)}<mark>{sentence.slice(position, position + word.length)}</mark>{sentence.slice(position + word.length)}</>;
}

export default function StudyCard({ account, card, flipped, busy, flipRef, onFlip }: {
  account?: string; card: Flashcard; flipped: boolean; busy: boolean;
  flipRef: RefObject<HTMLButtonElement | null>; onFlip: (flipped: boolean) => void;
}) {
  const [preferences, setPreferences] = useState<CardPreferences | null>(null);
  const [issue, setIssue] = useState("");
  const phonetic = useFlashcardPhonetic(!account || preferences ? card.frontText : "", preferences?.phonetic);
  const level = levels.find(level => level === preferences?.level) ?? "Chưa chọn";
  const [meaning, ...description] = card.backText.split(/\r?\n/);

  useEffect(() => {
    let active = true;
    if (account) void readPreference<CardPreferences>(deckPreferencePrefix(account, card.deckId) + card.cardId)
      .catch(() => undefined).then(value => { if (active) setPreferences(value ?? emptyPreferences); });
    return () => { active = false; window.speechSynthesis?.cancel(); };
  }, [account, card.deckId, card.cardId]);

  useEffect(() => () => window.speechSynthesis?.cancel(), [flipped]);

  return <>
    <div className={styles.studyScene}>
      <Image src="/illustrations/speaking-reading-books.webp" alt="" width={320} height={320} className={styles.studyBooks} />
      <button className={styles.faceArrow} type="button" aria-label="Xem mặt trước" disabled={busy || !flipped} onClick={() => onFlip(false)}><Icon name="chevron" /></button>
      <div className={styles.studyStack}>
        <span className={styles.binderRings} aria-hidden="true"><i /><i /></span>
        <div className={styles.studyPaper} data-flipped={flipped}>
          <button ref={flipRef} type="button" className={styles.flipCard} disabled={busy} onClick={() => onFlip(!flipped)}
            aria-label={flipped ? "Đang xem nghĩa. Bấm để xem từ." : "Bấm để lật thẻ và xem nghĩa."} aria-pressed={flipped} />
          <div className={styles.studyContent}>
            <span className={styles.studyRibbon}>{flipped ? "Mặt sau · Nghĩa & Ví dụ" : "Mặt trước · Từ vựng"}</span>
            <span className={styles.studyStar} aria-hidden="true"><Icon name="star" /></span>
            {!flipped ? <>
              <div className={styles.studyWord}>
                <strong lang="en">{card.frontText}</strong>
                <button className={styles.sound} type="button" disabled={busy} aria-label="Nghe từ vựng" onClick={() => pronounceFlashcard(card.frontText, "en-US", setIssue)}><Icon name="volume" /></button>
              </div>
              {phonetic && <span className={styles.studyPhonetic} lang="en-fonipa">{phonetic}</span>}
              <Image src={preferences?.image || "/illustrations/speaking-reading-cat.webp"} width={640} height={440}
                alt={preferences?.image ? "Ảnh minh họa từ vựng" : ""} className={preferences?.image ? styles.studyCustomImage : styles.studyCat} unoptimized={!!preferences?.image} />
              <span className={styles.studyFlipHint}>Bấm hoặc nhấn Enter để lật thẻ</span>
            </> : <>
              <div className={styles.studyMeaning}>
                <Icon name="book" /><div lang="vi"><strong>{meaning}</strong>{description.length > 0 && <p>{description.join("\n")}</p>}</div>
                {preferences?.image && <Image src={preferences.image} width={180} height={120} alt="Ảnh minh họa từ vựng" unoptimized />}
              </div>
              {card.exampleSentence ? <div className={styles.studyExample}>
                <span aria-hidden="true">“</span>
                <p lang="en"><Example sentence={card.exampleSentence} word={card.frontText} /></p>
                <button className={styles.sound} type="button" disabled={busy} aria-label="Nghe câu ví dụ" onClick={() => pronounceFlashcard(card.exampleSentence!, "en-US", setIssue)}><Icon name="volume" /></button>
              </div> : <p className={styles.studyNoExample}>Thẻ này chưa có câu ví dụ.</p>}
              <div className={styles.studyMetadata}><span><Icon name="trend" /> CEFR <b>{account && !preferences ? "Đang tải…" : level}</b></span></div>
            </>}
          </div>
        </div>
      </div>
      <button className={styles.faceArrow} type="button" aria-label="Xem mặt sau" disabled={busy || flipped} onClick={() => onFlip(true)}><Icon name="chevron" /></button>
      <Image src="/illustrations/speaking-reading-books.webp" alt="" width={320} height={320} className={`${styles.studyBooks} ${styles.studyBooksRight}`} />
    </div>
    <div className={styles.studyDots} aria-label="Mặt thẻ đang xem">
      <button type="button" aria-label="Mặt trước" aria-pressed={!flipped} disabled={busy} onClick={() => onFlip(false)} />
      <button type="button" aria-label="Mặt sau" aria-pressed={flipped} disabled={busy} onClick={() => onFlip(true)} />
    </div>
    {issue && <p className={styles.error} role="status">{issue}</p>}
  </>;
}
