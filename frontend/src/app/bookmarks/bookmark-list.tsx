"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Icon, { type SiteIconName } from "@/components/site-icon";
import BookmarkButton from "@/components/bookmarks/bookmark-button";
import actionStyles from "@/components/bookmarks/bookmark-button.module.css";
import { useBookmarks } from "@/components/bookmarks/bookmark-provider";
import { bookmarkHref, bookmarkKey, bookmarkTypeLabel, type Bookmark, type BookmarkKey, type BookmarkType } from "@/lib/bookmarks";
import { changeSentenceBookmark, loadSentences, practiceSentenceHref, type PracticeSentence } from "@/lib/free-speaking-history";
import styles from "./bookmarks.module.css";

const icons: Record<BookmarkType, SiteIconName> = {
  course: "book", lesson: "play", writing: "writing", flashcard: "cards", vocabulary: "book",
};
const actions: Record<BookmarkType, string> = {
  course: "Mở khóa học", lesson: "Mở bài học", writing: "Xem bài viết", flashcard: "Mở thẻ", vocabulary: "Mở từ vựng",
};
const filters = [
  ["all", "Tất cả"], ["speaking", "Luyện nói"], ["listening", "Nghe"], ["writing", "Viết"],
  ["flashcard", "Flashcards"], ["course", "Khóa học"], ["other", "Khác"],
] as const;
type Filter = typeof filters[number][0];
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeZone: "Asia/Bangkok" });

type SavedSentence = Pick<PracticeSentence, "id" | "text" | "updatedAt" | "bookmarkNote">;
type LocalChange = Parameters<typeof changeSentenceBookmark>[2];
type ListItem = {
  key: string;
  title: string;
  icon: SiteIconName;
  type: string;
  filter: Exclude<Filter, "all">;
  action: string;
  note: string | null;
  timestamp: number;
  parentTitle?: string | null;
} & ({ href: string | null; bookmark: BookmarkKey } | { href: string; sentence: SavedSentence });

function categorize({ targetType, target }: Bookmark): ListItem["filter"] {
  if (targetType === "lesson") {
    const skill = target?.skillType;
    return skill === "speaking" || skill === "listening" || skill === "writing" ? skill : "other";
  }
  return targetType === "vocabulary" ? "other" : targetType;
}

function searchable(text: string) {
  return text.toLocaleLowerCase("vi").normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");
}

function BookmarkNote({ note, title, busy, onSave }: {
  note: string | null; title: string; busy: boolean; onSave: (note: string | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft === null || busy) return;
    setError("");
    try {
      await onSave(draft.trim() || null);
      setDraft(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chưa lưu được ghi chú. Vui lòng thử lại.");
    }
  }

  return <div className={styles.note}>
    {draft === null ? <>
      {note && <p className={styles.noteText}>{note}</p>}
      <button type="button" className={styles.noteToggle} aria-label={`${note ? "Sửa" : "Thêm"} ghi chú cho ${title}`}
        disabled={busy} onClick={() => { setDraft(note ?? ""); setError(""); }}>
        <Icon name="writing" /> {note ? "Sửa ghi chú" : "Thêm ghi chú"}
      </button>
    </> : <form className={styles.noteForm} onSubmit={event => void save(event)}>
      <label><span>Ghi chú cá nhân <small aria-hidden="true">{draft.length}/500</small></span>
        <textarea autoFocus rows={2} maxLength={500} disabled={busy} value={draft} onChange={event => setDraft(event.target.value)} />
      </label>
      {error && <p className={styles.inlineError} role="alert">{error}</p>}
      <div>
        <button type="submit" disabled={busy}>{busy ? "Đang lưu…" : "Lưu ghi chú"}</button>
        <button type="button" disabled={busy} onClick={() => setDraft(null)}>Hủy</button>
      </div>
    </form>}
  </div>;
}

export default function BookmarkList({ account }: { account?: string }) {
  const store = useBookmarks();
  const [speaking, setSpeaking] = useState<{ items: SavedSentence[]; failed?: true } | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const [localPending, setLocalPending] = useState<string | null>(null);
  const writingLocal = useRef(false);
  const [removeError, setRemoveError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!account) return;
    let active = true;
    loadSentences(account).then(data => {
      if (!active) return;
      const items = data.filter(item => item.saved).map(({ id, text, updatedAt, bookmarkNote }) => ({ id, text, updatedAt, bookmarkNote }));
      setSpeaking({ items });
    }, () => {
      if (active) setSpeaking({ items: [], failed: true });
    });
    function restore(event: PageTransitionEvent) {
      if (event.persisted) setReadAttempt(value => value + 1);
    }
    window.addEventListener("pageshow", restore);
    return () => {
      active = false;
      window.removeEventListener("pageshow", restore);
    };
  }, [account, readAttempt]);

  async function updateSentence(id: string, change: LocalChange) {
    if (!account || writingLocal.current) throw new Error("Đang cập nhật câu luyện nói. Vui lòng thử lại.");
    writingLocal.current = true;
    setLocalPending(id);
    setRemoveError("");
    try {
      const updated = await changeSentenceBookmark(account, id, change);
      if (!updated) throw new Error("Không tìm thấy câu đã lưu trên trình duyệt này.");
      const { text, updatedAt, bookmarkNote } = updated;
      setSpeaking(previous => ({
        items: [
          ...(updated.saved ? [{ id, text, updatedAt, bookmarkNote }] : []),
          ...(previous?.items ?? []).filter(item => item.id !== id),
        ],
      }));
    } finally {
      writingLocal.current = false;
      setLocalPending(null);
    }
  }

  async function removeSentence(sentence: SavedSentence) {
    try {
      await updateSentence(sentence.id, { saved: false, bookmarkNote: null });
      store?.offerUndo("sentence/" + sentence.id, sentence.text,
        () => updateSentence(sentence.id, { saved: true, bookmarkNote: sentence.bookmarkNote ?? null }));
    } catch {
      setRemoveError("Chưa bỏ được dấu trang của câu luyện nói. Vui lòng thử lại.");
    }
  }

  if (!store) return <div className={styles.state}>
    <p role="alert">Chưa tải được dấu trang.</p>
    <a href="/bookmarks">Thử tải lại</a>
  </div>;

  const loading = !store.result || Boolean(account && !speaking);
  const loadError = store.result?.error;
  const items: ListItem[] = [
    ...(store.result?.items ?? []).map(item => {
      const filter = categorize(item);
      const type = filter === "speaking" ? "Bài luyện nói" : filter === "listening" ? "Bài nghe" : bookmarkTypeLabel[item.targetType];
      return {
        filter, type, key: bookmarkKey(item),
        title: item.target?.title.trim() || type + " #" + item.targetId,
        href: bookmarkHref(item),
        icon: filter === "speaking" ? "mic" as const : filter === "listening" ? "headphones" as const : icons[item.targetType],
        action: filter === "speaking" || filter === "listening" ? "Luyện lại" : actions[item.targetType],
        note: item.note ?? null,
        timestamp: Date.parse(item.createdAt),
        parentTitle: item.target?.parentTitle,
        bookmark: { targetType: item.targetType, targetId: item.targetId },
      };
    }),
    ...(speaking?.items ?? []).map(sentence => ({
      key: "sentence/" + sentence.id,
      title: sentence.text,
      href: practiceSentenceHref(sentence.id),
      icon: "mic" as const,
      type: "Câu luyện nói",
      filter: "speaking" as const,
      action: "Luyện lại",
      note: sentence.bookmarkNote ?? null,
      timestamp: sentence.updatedAt,
      sentence,
    })),
  ];
  items.sort((a, b) => b.timestamp - a.timestamp);
  const words = searchable(query).trim().split(/\s+/).filter(Boolean);
  const visible = items.filter(item => {
    if (filter !== "all" && item.filter !== filter) return false;
    if (words.length === 0) return true;
    const text = searchable([item.title, item.parentTitle, item.note].join(" "));
    return words.every(word => text.includes(word));
  });
  const filtering = filter !== "all" || words.length > 0;

  return <section aria-labelledby="saved-heading" className={styles.collection}>
    <div className={styles.collectionHeader}>
      <h2 id="saved-heading">Nội dung đã lưu</h2>
      {(items.length > 0 || !loading && !loadError && !speaking?.failed) && <span role="status">
        {filtering ? `${visible.length} / ${items.length}` : items.length} dấu trang
      </span>}
    </div>
    {(items.length > 0 || filtering) && <div className={styles.tools}>
      <label className={styles.search}><Icon name="search" />
        <input type="search" aria-label="Tìm dấu trang" placeholder="Tìm tên bài, bộ thẻ hoặc ghi chú…"
          value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <div className={styles.filters} role="group" aria-label="Lọc theo nội dung">
        {filters.map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
      </div>
    </div>}
    {loading && <div className={styles.state}><p role="status">Đang tải dấu trang…</p></div>}
    {loadError && <div className={styles.state}>
      <p role="alert">{loadError}</p>
      <button type="button" onClick={store.reload}>Thử tải lại</button>
    </div>}
    {speaking?.failed && <div className={styles.state}>
      <p role="alert">Chưa tải được câu luyện nói đã đánh dấu trên trình duyệt này.</p>
      <button type="button" onClick={() => { setSpeaking(null); setReadAttempt(value => value + 1); }}>Tải lại câu luyện nói</button>
    </div>}
    {removeError && <div className={styles.state}><p role="alert">{removeError}</p></div>}
    {visible.length === 0 && !loading && !loadError && !speaking?.failed && <div className={styles.state}>
      {filtering ? <>
        <p>Chưa tìm thấy dấu trang phù hợp.</p>
        <button type="button" onClick={() => { setQuery(""); setFilter("all"); }}>Xóa bộ lọc</button>
      </> : <>
        <p>Chưa có dấu trang. Chọn <strong>Đánh dấu</strong> ở nội dung bạn muốn lưu.</p>
        <div className={styles.stateLinks}>
          <Link href="/speaking">Mở Luyện nói <Icon name="mic" /></Link>
          <Link href="/courses">Xem khóa học <Icon name="arrow" /></Link>
        </div>
      </>}
    </div>}
    {visible.length > 0 && <ul className={styles.list}>
      {visible.map(item => {
        const date = new Date(item.timestamp);
        const local = "sentence" in item;
        const ContentLink = local ? "a" : Link;
        const busy = local ? localPending !== null : store.pending.has(item.key);
        return <li key={item.key} className={styles.item}>
          <span className={styles.itemIcon}><Icon name={item.icon} /></span>
          <div className={styles.content}>
            <div className={styles.details}><span>{item.type}</span>
              {local && <span className={styles.device} title="Lưu trên trình duyệt này">Trên thiết bị này</span>}
              {Number.isFinite(item.timestamp) && <time dateTime={date.toISOString()} title={local ? "Cập nhật câu luyện nói lần cuối" : undefined}>
                {dateFormat.format(date)}
              </time>}
            </div>
            {item.href ? <ContentLink href={item.href} className={styles.title} lang={local ? "en" : undefined}>{item.title}</ContentLink>
              : <strong className={styles.title}>{item.title}</strong>}
            {item.parentTitle && <p>{item.parentTitle}</p>}
            {!item.href && <p>Nội dung không còn mở được.</p>}
            <BookmarkNote title={item.title} note={item.note} busy={busy} onSave={note => local
              ? updateSentence(item.sentence.id, { bookmarkNote: note }) : store.saveNote(item.bookmark, note)} />
          </div>
          <div className={styles.actions}>
            {item.href && <ContentLink href={item.href} className={styles.openAction} aria-label={item.action + " " + item.title}>
              {item.action} <Icon name="arrow" />
            </ContentLink>}
            {local ? <span className={actionStyles.control}>
              <button type="button" className={actionStyles.button} data-remove disabled={busy}
                aria-busy={localPending === item.sentence.id || undefined} aria-label={"Bỏ lưu " + item.title}
                onClick={() => void removeSentence(item.sentence)}>
                <Icon name="trash" /> {localPending === item.sentence.id ? "Đang xử lý…" : "Bỏ lưu"}
              </button>
            </span> : <BookmarkButton {...item.bookmark} title={item.title} remove />}
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}
