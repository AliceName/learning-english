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

export type StudyDirection = "en-vi" | "vi-en";

export default function StudyCard({ account, card, direction = "en-vi", flipped, busy, flipRef, onFlip, onPrevious, onNext,
  difficultyLevel, flipOnDoubleClick = false }: {
  account?: string; card: Pick<Flashcard, "frontText" | "backText" | "exampleSentence"> & Partial<Pick<Flashcard, "cardId" | "deckId">>;
  direction?: StudyDirection; flipped: boolean; busy: boolean; difficultyLevel?: string | null; flipOnDoubleClick?: boolean;
  flipRef: RefObject<HTMLButtonElement | null>; onFlip: (flipped: boolean) => void;
  onPrevious?: () => void; onNext?: () => void;
}) {
  const [preferences, setPreferences] = useState<CardPreferences | null>(null);
  const [issue, setIssue] = useState("");
  const reverse = direction === "vi-en";
  const showWord = flipped === reverse;
  const phonetic = useFlashcardPhonetic(showWord && (!account || preferences) ? card.frontText : "", preferences?.phonetic);
  const level = levels.find(level => level === (preferences?.level || difficultyLevel)) ?? "Chưa chọn";
  const [meaning, ...description] = card.backText.split(/\r?\n/);

  useEffect(() => {
    let active = true;
    if (account && card.deckId !== undefined && card.cardId !== undefined) void readPreference<CardPreferences>(deckPreferencePrefix(account, card.deckId) + card.cardId)
      .catch(() => undefined).then(value => { if (active) setPreferences(value ?? emptyPreferences); });
    return () => { active = false; window.speechSynthesis?.cancel(); };
  }, [account, card.deckId, card.cardId]);

  useEffect(() => () => window.speechSynthesis?.cancel(), [flipped]);

  const front = reverse ? "Nghĩa tiếng Việt" : "Từ vựng";
  const back = reverse ? "Từ vựng & Ví dụ" : "Nghĩa & Ví dụ";
  const flipInstruction = flipOnDoubleClick ? "Nhấn đúp" : "Bấm";
  const flipLabel = reverse
    ? flipped ? `Đang xem từ tiếng Anh. ${flipInstruction} để xem nghĩa.` : `${flipInstruction} để lật thẻ và xem từ tiếng Anh.`
    : flipped ? `Đang xem nghĩa. ${flipInstruction} để xem từ.` : `${flipInstruction} để lật thẻ và xem nghĩa.`;

  return <>
    <div className={styles.studyScene}>
      <Image src="/illustrations/speaking-reading-books.webp" alt="" width={320} height={320} className={styles.studyBooks} />
      <button className={styles.cardArrow} type="button" aria-label="Thẻ trước" title="Thẻ trước" disabled={busy || !onPrevious} onClick={onPrevious}><Icon name="chevron" /></button>
      <div className={styles.studyStack}>
        <span className={styles.binderRings} aria-hidden="true"><i /><i /></span>
        <div className={styles.studyPaper} data-flipped={flipped}>
          <button ref={flipRef} type="button" className={styles.flipCard} disabled={busy}
            onClick={event => { if (!flipOnDoubleClick || event.detail === 0) onFlip(!flipped); }}
            onDoubleClick={flipOnDoubleClick ? () => onFlip(!flipped) : undefined}
            aria-label={flipLabel} aria-pressed={flipped} />
          <div className={styles.studyContent}>
            <span className={styles.studyRibbon}>{flipped ? `Mặt sau · ${back}` : `Mặt trước · ${front}`}</span>
            <span className={styles.studyStar} aria-hidden="true"><Icon name="star" /></span>
            {showWord ? <>
              <div className={styles.studyWord}>
                <strong lang="en">{card.frontText}</strong>
                <button className={styles.sound} type="button" disabled={busy} aria-label="Nghe từ vựng" onClick={() => pronounceFlashcard(card.frontText, "en-US", setIssue)}><Icon name="volume" /></button>
              </div>
              {phonetic && <span className={styles.studyPhonetic} lang="en-fonipa">{phonetic}</span>}
              {!flipped && <Image src={preferences?.image || "/illustrations/speaking-reading-cat.webp"} width={640} height={440}
                alt={preferences?.image ? "Ảnh minh họa từ vựng" : ""} className={preferences?.image ? styles.studyCustomImage : styles.studyCat} unoptimized={!!preferences?.image} />}
            </> : <div className={styles.studyMeaning}>
              <Icon name="book" /><div lang="vi"><strong>{meaning}</strong>{description.length > 0 && <p>{description.join("\n")}</p>}</div>
              {flipped && preferences?.image && <Image src={preferences.image} width={180} height={120} alt="Ảnh minh họa từ vựng" unoptimized />}
            </div>}
            {!flipped ? <span className={styles.studyFlipHint}>{flipInstruction} hoặc nhấn Enter để lật thẻ</span> : <>
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
      <button className={styles.cardArrow} type="button" aria-label="Thẻ tiếp" title="Thẻ tiếp" disabled={busy || !onNext} onClick={onNext}><Icon name="chevron" /></button>
      <Image src="/illustrations/speaking-reading-books.webp" alt="" width={320} height={320} className={`${styles.studyBooks} ${styles.studyBooksRight}`} />
    </div>
    <div className={styles.studyFaces} role="group" aria-label="Mặt thẻ đang xem">
      <button type="button" aria-label="Xem mặt trước" aria-pressed={!flipped} disabled={busy} onClick={() => onFlip(false)}>Mặt trước</button>
      <button type="button" aria-label="Xem mặt sau" aria-pressed={flipped} disabled={busy} onClick={() => onFlip(true)}>Mặt sau</button>
    </div>
    {issue && <p className={styles.error} role="status">{issue}</p>}
  </>;
}
