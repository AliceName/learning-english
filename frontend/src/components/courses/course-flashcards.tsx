"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/site-icon";
import FlashcardsWorkspace from "@/app/flashcards/workspace";
import StudyCard from "@/app/flashcards/study-card";
import { useLessonSession } from "@/components/course-text/lesson-session";
import { courseFlashcardsApi, flashcardsRequest, type CourseFlashcardsData, type ReadingVocabularyDeck } from "@/lib/course-flashcards";
import type { Deck } from "@/lib/flashcards";
import studyStyles from "@/app/flashcards/flashcards.module.css";
import styles from "./course-flashcards.module.css";

type Filter = "all" | "reading" | "admin" | "mine";
export default function CourseFlashcards({ data, account, isAdmin, initialLessonId }: {
  data: CourseFlashcardsData; account: string; isAdmin: boolean; initialLessonId?: number;
}) {
  const { vocabulary } = data;
  const { signal, invalid } = useLessonSession();
  const [decks, setDecks] = useState(data.decks ?? []);
  const [savedUnavailable, setSavedUnavailable] = useState(data.decks === null);
  const [filter, setFilter] = useState<Filter>(initialLessonId ? "reading" : "all");
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState<{ deckId?: number; create?: boolean } | null>(null);
  const [preview, setPreview] = useState<ReadingVocabularyDeck | null>(vocabulary.readingDecks.find(deck => deck.lessonId === initialLessonId) ?? null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const flipRef = useRef<HTMLButtonElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const courseHref = isAdmin ? `/admin/courses/${vocabulary.courseId}/general` : `/courses/${vocabulary.courseId}`;
  const query = search.trim().toLocaleLowerCase("vi");
  const readingDecks = vocabulary.readingDecks.filter(deck => (filter === "all" || filter === "reading") && deck.title.toLocaleLowerCase("vi").includes(query));
  const savedDecks = decks.filter(deck => (filter === "all" || filter === "admin" && deck.isAdminDeck || filter === "mine" && deck.canEdit && !deck.isAdminDeck) && (deck.title + " " + (deck.description || "")).toLocaleLowerCase("vi").includes(query));
  const totalCards = vocabulary.readingDecks.reduce((sum, deck) => sum + deck.cards.length, 0) + decks.reduce((sum, deck) => sum + deck.cardCount, 0);
  useEffect(() => { if (preview) previewHeading.current?.focus(); }, [preview]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  async function refresh() {
    if (pending.current || signal.current?.signal.aborted) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const values = await flashcardsRequest<Deck[]>(courseFlashcardsApi(vocabulary.courseId), { signal: signal.current?.signal });
      if (!signal.current?.signal.aborted) { setDecks(values); setSavedUnavailable(false); }
    } catch (failure) { if (!signal.current?.signal.aborted) { setSavedUnavailable(true); setError(failure instanceof Error ? failure.message : "Chưa tải được bộ thẻ."); } }
    finally { pending.current = false; setBusy(false); }
  }
  async function copyReading(deck: ReadingVocabularyDeck) {
    if (pending.current || savedUnavailable || signal.current?.signal.aborted) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const saved = await flashcardsRequest<Deck>(`/api/learning/courses/${vocabulary.courseId}/vocabulary/${deck.lessonId}/copy`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentVersion: deck.contentVersion }), signal: signal.current?.signal,
      });
      if (!signal.current?.signal.aborted) {
        setDecks(current => [saved, ...current]); setPreview(null); setOpened({ deckId: saved.deckId });
      }
    } catch (failure) { if (!signal.current?.signal.aborted) setError(failure instanceof Error ? failure.message : "Chưa tạo được bộ thẻ."); }
    finally { pending.current = false; setBusy(false); }
  }
  function openPreview(deck: ReadingVocabularyDeck) { window.speechSynthesis?.cancel(); setIndex(0); setFlipped(false); setPreview(deck); }
  function nextCard(change: number) {
    if (busy || !preview) return;
    window.speechSynthesis?.cancel();
    setIndex(value => Math.max(0, Math.min(preview.cards.length - 1, value + change))); setFlipped(false);
  }
  if (invalid) return <main id="main-content" className={styles.page}><p role="alert">Phiên đăng nhập đã thay đổi. Hãy đăng nhập lại để tiếp tục.</p><Link href="/login">Đăng nhập</Link></main>;
  if (opened) return <FlashcardsWorkspace initialDecks={decks} initialDetail={null} linkedCardId={null} account={account} isAdmin={isAdmin}
    course={{ courseId: vocabulary.courseId, title: vocabulary.courseTitle }} initialDeckId={opened.deckId} createOnOpen={opened.create}
    onReturn={() => { setOpened(null); void refresh(); }} />;

  return <main id="main-content" tabIndex={-1} className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Đường dẫn"><Link href={courseHref}>{vocabulary.courseTitle}</Link><Icon name="chevron" /><span>Từ vựng & Flashcards</span></nav>
    <header className={styles.header}><div><span className={styles.eyebrow}>COURSE VOCABULARY</span><h1>Từ vựng & Flashcards</h1><p>Ghi nhớ từng từ, hiểu thêm từng bài học.</p></div><Link className={styles.back} href={courseHref}>← Về khóa học</Link></header>
    <section className={styles.intro}><span className={styles.entryIcon}><Icon name="cards" /></span><div><h2>{vocabulary.courseTitle}</h2><p>Bộ từ vựng từ Reading và các bộ thẻ do Admin biên soạn. Tạo bộ ôn riêng để lưu lịch ôn của bạn.</p><div className={styles.stats}><span><b>{vocabulary.readingDecks.length}</b> bộ từ Reading</span><span><b>{savedUnavailable ? "—" : decks.filter(deck => deck.isAdminDeck).length}</b> bộ Admin</span><span><b>{savedUnavailable ? "—" : totalCards}</b> thẻ</span></div></div></section>
    <div className={styles.controls}><label className={styles.search}><Icon name="search" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm bộ thẻ trong khóa học…" aria-label="Tìm bộ thẻ trong khóa học" /></label><div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => void refresh()}><Icon name="replay" />Tải lại</button>{isAdmin && <button type="button" className={styles.primary} disabled={busy || savedUnavailable} onClick={() => setOpened({ create: true })}><Icon name="plus" />Tạo bộ thẻ</button>}</div></div>
    <nav className={styles.tabs} aria-label="Lọc nguồn bộ thẻ">{([["all", "Tất cả"], ["reading", "Từ Reading"], ["admin", "Admin biên soạn"], ["mine", "Bộ ôn của tôi"]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</nav>
    {savedUnavailable && <p className={styles.notice} role="status">Chưa tải được các bộ thẻ đã lưu. Bạn vẫn có thể xem thẻ từ vựng Reading. Bấm “Tải lại” để kiểm tra lại phần bộ thẻ đã lưu.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {preview && <section className={`${styles.preview} ${studyStyles.page}`} aria-label="Xem trước bộ thẻ Reading">
      <div className={styles.previewHeader}><div><span className={styles.badge}>TỪ BÀI READING</span><h2 ref={previewHeading} tabIndex={-1}>{preview.title}</h2></div><button type="button" className={styles.secondary} aria-label="Đóng xem trước bộ thẻ" onClick={() => { setPreview(null); window.speechSynthesis?.cancel(); }}><Icon name="close" /></button></div>
      <StudyCard key={`${preview.lessonId}:${index}`} card={preview.cards[index]} difficultyLevel={preview.difficultyLevel} flipOnDoubleClick flipped={flipped} onFlip={setFlipped} busy={busy} flipRef={flipRef}
        onPrevious={index > 0 ? () => nextCard(-1) : undefined} onNext={index < preview.cards.length - 1 ? () => nextCard(1) : undefined} />
      <div className={styles.previewFooter}><div className={styles.actions}><button type="button" className={styles.secondary} disabled={index === 0 || busy} onClick={() => nextCard(-1)}>← Thẻ trước</button><span>{index + 1}/{preview.cards.length}</span><button type="button" className={styles.secondary} disabled={index === preview.cards.length - 1 || busy} onClick={() => nextCard(1)}>Thẻ tiếp →</button></div><button type="button" disabled={busy || savedUnavailable} className={styles.primary} onClick={() => void copyReading(preview)}><Icon name="plus" />{busy ? "Đang tạo bộ thẻ…" : isAdmin ? "Tạo bộ thẻ từ Reading" : "Lưu bộ thẻ để ôn"}</button></div>
      <p className={styles.hint}>Thẻ hiển thị từ vựng đã biên soạn trong bài đọc. Lưu thành bộ riêng để thêm thẻ và dùng lịch ôn.</p>
    </section>}
    <div className={styles.deckGrid}>
      {readingDecks.map(deck => <article className={styles.deck} key={`reading-${deck.lessonId}`}><div className={styles.deckTop}><span className={styles.readingIcon}><Icon name="book" /></span><span className={styles.badge}>TỪ READING</span>{deck.difficultyLevel && <small>{deck.difficultyLevel}</small>}</div><h2>{deck.title}</h2><p>{deck.cards.length} từ vựng · Đồng bộ từ bài đọc</p><div className={styles.words}>{deck.cards.slice(0, 3).map((card, index) => <span lang="en" key={index}>{card.frontText}</span>)}{deck.cards.length > 3 && <span>+{deck.cards.length - 3}</span>}</div><div className={styles.deckActions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => openPreview(deck)}><Icon name="eye" />Xem thẻ</button><button type="button" className={styles.primary} disabled={busy || savedUnavailable} onClick={() => void copyReading(deck)}><Icon name="plus" />{isAdmin ? "Tạo bộ thẻ" : "Lưu để ôn"}</button></div></article>)}
      {savedDecks.map(deck => <article className={styles.deck} key={deck.deckId}><div className={styles.deckTop}><span className={styles.savedIcon}><Icon name="cards" /></span><span className={styles.badge}>{deck.isAdminDeck ? "ADMIN BIÊN SOẠN" : "BỘ ÔN CỦA TÔI"}</span>{!deck.canEdit && <small>Chỉ đọc</small>}</div><h2>{deck.title}</h2><p className={styles.deckDescription}>{deck.description || (deck.isAdminDeck ? "Bộ thẻ từ vựng dành cho khóa học." : "Bộ thẻ và lịch ôn riêng của bạn.")}</p><div className={styles.deckCount}><span><Icon name="cards" />{deck.cardCount} thẻ</span>{deck.canEdit && <span><Icon name="clock" />{deck.dueCount} thẻ đến lịch</span>}</div><button type="button" className={styles.secondary} disabled={busy} onClick={() => setOpened({ deckId: deck.deckId })}>{deck.canEdit ? "Mở bộ thẻ & ôn tập" : "Xem bộ thẻ"}<Icon name="arrow" /></button></article>)}
    </div>
    {!savedUnavailable && !readingDecks.length && !savedDecks.length && <section className={styles.empty}><Icon name="cards" /><h2>{search || filter !== "all" ? "Chưa có bộ thẻ phù hợp" : "Khóa học chưa có bộ thẻ từ vựng"}</h2><p>{isAdmin ? "Tạo bộ thẻ riêng hoặc thêm từ vựng vào bài Reading để bắt đầu." : "Bộ thẻ sẽ xuất hiện khi Admin thêm từ vựng Reading hoặc biên soạn bộ thẻ cho khóa học."}</p>{isAdmin && <Link className={styles.secondary} href={`/admin/courses/${vocabulary.courseId}/lessons/reading`}>Biên soạn từ vựng Reading<Icon name="arrow" /></Link>}</section>}
    <p className={styles.hint}><Icon name="shield" />Bộ gốc được dùng chung. Mỗi học viên lưu bản sao và lịch ôn riêng.</p>
  </main>;
}
