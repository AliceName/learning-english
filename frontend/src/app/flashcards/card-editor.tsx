"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Icon from "@/components/site-icon";
import { levels } from "@/lib/course-catalog";
import { pronounceFlashcard, type Deck, type DeckDetail, type Flashcard } from "@/lib/flashcards";
import { FlashcardHeading } from "./library";
import { emptyPreferences, type CardPreferences } from "./preferences";
import { useFlashcardPhonetic } from "./use-flashcard-phonetic";
import styles from "./flashcards.module.css";

export type CardFields = { frontText: string; backText: string; exampleSentence: string };
const emptyCard: CardFields = { frontText: "", backText: "", exampleSentence: "" };

async function prepareImage(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 6 * 1024 * 1024) {
    throw new Error("Chọn ảnh JPG, PNG hoặc WebP tối đa 6 MB.");
  }
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 760 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Trình duyệt chưa xử lý được ảnh này.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", .82);
  } finally { image.close(); }
}

export default function FlashcardEditor({ detail, decks, card, initialPreferences, busy, onLibrary, onClose, onChooseDeck, onSave }: {
  detail: DeckDetail; decks: Deck[]; card?: Flashcard; initialPreferences: CardPreferences; busy: boolean;
  onLibrary: () => void; onClose: () => void; onChooseDeck: (id: number) => void;
  onSave: (fields: CardFields, preferences: CardPreferences, keepOpen: boolean) => Promise<boolean>;
}) {
  const [fields, setFields] = useState<CardFields>(card ? {
    frontText: card.frontText, backText: card.backText, exampleSentence: card.exampleSentence ?? "",
  } : emptyCard);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [back, setBack] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [issue, setIssue] = useState("");
  const wordField = useRef<HTMLInputElement>(null);
  const recent = detail.cards.slice(-3).reverse();
  const disabled = busy || preparing;
  const preview = back ? fields.backText : fields.frontText;
  const phonetic = useFlashcardPhonetic(fields.frontText,
    fields.frontText.trim() === card?.frontText.trim() ? initialPreferences.phonetic : undefined, 500);

  useEffect(() => {
    wordField.current?.focus({ preventScroll: true });
    return () => window.speechSynthesis?.cancel();
  }, []);

  function pronounce(text: string, language = "en-US") {
    pronounceFlashcard(text, language, setIssue);
  }

  async function chooseImage(file: File | undefined) {
    if (!file) return;
    setIssue(""); setPreparing(true);
    try {
      const image = await prepareImage(file);
      setPreferences(previous => ({ ...previous, image }));
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "Chưa mở được ảnh. Hãy thử tệp khác.");
    } finally { setPreparing(false); }
  }

  function clear() {
    setFields(emptyCard); setPreferences(emptyPreferences); setBack(false); setIssue("");
    wordField.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    if (!fields.frontText.trim() || !fields.backText.trim()) {
      setIssue("Nhập đủ từ vựng và nghĩa.");
      return;
    }
    setIssue("");
    const keepOpen = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "add";
    if (await onSave(fields, { ...preferences, phonetic }, keepOpen) && keepOpen) clear();
  }

  return <div className={styles.editorLayout}>
    <div>
      <FlashcardHeading title={card ? "Chỉnh sửa Flashcard" : "Tạo Flashcard"} icon={card ? "writing" : "plus"}
        description={card ? "Cập nhật từ vựng trong bộ thẻ của bạn." : "Thêm từ vựng mới vào bộ thẻ của bạn."}
        crumb={card ? "Sửa thẻ" : "Tạo thẻ mới"} onBack={onLibrary} />
      <section className={styles.panel} aria-label="Thông tin thẻ từ vựng">
        <form onSubmit={event => void submit(event)}>
          <fieldset disabled={disabled} className={styles.form}>
            <div className={styles.formRow}>
              <label><span><Icon name="cards" /> Bộ thẻ</span>
                <select value={detail.deck.deckId} disabled={!!card} onChange={event => onChooseDeck(Number(event.target.value))}>
                  {decks.filter(deck => deck.canEdit).map(deck => <option key={deck.deckId} value={deck.deckId}>{deck.title}</option>)}
                </select>
              </label>
              <label><span><Icon name="trend" /> CEFR</span>
                <select value={preferences.level} onChange={event => setPreferences(old => ({ ...old, level: event.target.value }))}>
                  <option value="">Chưa chọn</option>{levels.map(level => <option key={level}>{level}</option>)}
                </select>
              </label>
            </div>
            <label><span><Icon name="cards" /> Từ vựng <b aria-hidden="true">*</b></span>
              <input ref={wordField} lang="en" value={fields.frontText} required maxLength={500} placeholder="Ví dụ: opportunity"
                onChange={event => setFields(old => ({ ...old, frontText: event.target.value }))} />
            </label>
            <label><span><Icon name="book" /> Nghĩa <b aria-hidden="true">*</b></span>
              <textarea value={fields.backText} required rows={2} maxLength={1000} placeholder="Ví dụ: cơ hội"
                onChange={event => setFields(old => ({ ...old, backText: event.target.value }))} />
            </label>
            <label><span><Icon name="writing" /> Câu ví dụ <small>(không bắt buộc)</small></span>
              <textarea lang="en" value={fields.exampleSentence} rows={2} maxLength={1000} placeholder="This is a great opportunity to learn."
                onChange={event => setFields(old => ({ ...old, exampleSentence: event.target.value }))} />
            </label>
            <div className={styles.imageField}>
              <strong><Icon name="eye" /> Hình ảnh</strong>
              <div className={styles.imageOptions}>
                {preferences.image && <div className={styles.imageThumb}>
                  <Image src={preferences.image} alt="Ảnh minh họa đã chọn" fill sizes="160px" unoptimized />
                  <button type="button" aria-label="Bỏ ảnh" onClick={() => setPreferences(old => ({ ...old, image: "" }))}><Icon name="close" /></button>
                </div>}
                <label className={styles.imageUpload}>
                  <Icon name="upload" /> {preparing ? "Đang xử lý ảnh…" : preferences.image ? "Đổi ảnh" : "Chọn ảnh"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
                    void chooseImage(event.target.files?.[0]); event.currentTarget.value = "";
                  }} />
                </label>
              </div>
              <small>Ảnh, phiên âm và cấp độ CEFR được lưu trên trình duyệt này.</small>
            </div>
            {card && <small>Sửa nội dung thẻ sẽ đặt lại lịch ghi nhớ của thẻ này.</small>}
            <div className={styles.editorActions}>
              <button type="button" onClick={card ? onClose : clear}>{card ? <Icon name="close" /> : <Icon name="trash" />} {card ? "Hủy sửa" : "Xóa nội dung"}</button>
              <div className={styles.actions}>
                {!card && <button type="submit" value="add"><Icon name="plus" /> Lưu &amp; thêm</button>}
                <button type="submit" className={styles.primary}><Icon name="check" /> Lưu</button>
              </div>
            </div>
          </fieldset>
        </form>
        {issue && <p className={styles.error} role="alert">{issue}</p>}
      </section>
    </div>

    <aside className={styles.editorAside} aria-label="Xem trước và thẻ gần đây">
      <section className={`${styles.panel} ${styles.previewPanel}`}>
        <h2><Icon name="eye" /> Xem trước</h2>
        <div className={styles.previewTabs} aria-label="Mặt thẻ đang xem">
          <button type="button" aria-pressed={!back} onClick={() => setBack(false)}>Trước</button>
          <button type="button" aria-pressed={back} onClick={() => setBack(true)}>Sau</button>
        </div>
        <div className={styles.previewCard}>
          {preferences.level && <span className={styles.previewLevel}>{preferences.level}</span>}
          <strong lang={back ? "vi" : "en"}>{preview.trim() || (back ? "Nghĩa của từ" : "Từ vựng")}</strong>
          {!back && fields.frontText.trim() && phonetic && <span className={styles.phonetic} lang="en-fonipa">{phonetic}</span>}
          <button type="button" className={styles.sound} disabled={!preview.trim()} aria-label={back ? "Nghe nghĩa" : "Nghe từ vựng"}
            onClick={() => pronounce(preview, back ? "vi-VN" : "en-US")}><Icon name="volume" /></button>
          {back && fields.exampleSentence.trim() && <p><strong>Ví dụ:</strong> <span lang="en">{fields.exampleSentence}</span></p>}
          {preferences.image && <Image className={styles.previewImage} src={preferences.image} alt="Ảnh minh họa trên thẻ"
            width={300} height={142} unoptimized />}
        </div>
        <div className={styles.previewDots} aria-hidden="true"><i data-current={!back} /><i data-current={back} /></div>
      </section>
      <section className={`${styles.panel} ${styles.recentPanel}`}>
        <div className={styles.top}><h2><Icon name="clock" /> Đã tạo gần đây</h2>
          <button type="button" disabled={busy} onClick={onClose}>Xem tất cả <Icon name="arrow" /></button>
        </div>
        {recent.length ? <ul className={styles.recentList}>{recent.map(item => <li key={item.cardId}>
          <span><Icon name="cards" /></span>
          <div><strong lang="en">{item.frontText}</strong><p>{item.backText}</p></div>
          <button type="button" className={styles.sound} aria-label={`Nghe ${item.frontText}`} onClick={() => pronounce(item.frontText)}><Icon name="volume" /></button>
        </li>)}</ul> : <p>Bộ này chưa có từ nào.</p>}
      </section>
    </aside>
  </div>;
}
