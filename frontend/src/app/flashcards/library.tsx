"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import Icon, { type SiteIconName } from "@/components/site-icon";
import type { Deck } from "@/lib/flashcards";
import styles from "./flashcards.module.css";

const pageSize = 8;
const tabs = [
  ["all", "Tất cả"], ["learning", "Đang học"], ["complete", "Đã hoàn thành"], ["favorites", "Yêu thích"],
] as const;
type Filter = typeof tabs[number][0];
type Sort = "recent" | "title" | "count";

const topics: { words: RegExp; icon: SiteIconName; tone: string }[] = [
  { words: /du lich|giao tiep|travel|communication/, icon: "globe", tone: "blue" },
  { words: /cong viec|van phong|work|business|office/, icon: "briefcase", tone: "pink" },
  { words: /moi truong|nature|environment/, icon: "sparkles", tone: "green" },
  { words: /suc khoe|the thao|health|sport|fitness/, icon: "bolt", tone: "purple" },
  { words: /giao duc|education|school/, icon: "book", tone: "blue" },
  { words: /giai tri|so thich|hobby|music/, icon: "headphones", tone: "pink" },
  { words: /xa hoi|con nguoi|people|society/, icon: "users", tone: "purple" },
  { words: /mua sam|shopping/, icon: "cards", tone: "blue" },
];

function deckArt(deck: Deck) {
  const title = deck.title.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");
  return topics.find(topic => topic.words.test(title)) ?? topics[deck.deckId % topics.length];
}

export function FlashcardHeading({ title, description, icon, crumb, onBack }: {
  title: string; description: string; icon: SiteIconName; crumb?: string; onBack?: () => void;
}) {
  return <header className={styles.heading}>
    <nav className={styles.breadcrumb} aria-label="Đường dẫn trang">
      <Link href="/" aria-label="Trang chủ"><Icon name="home" /></Link><Icon name="chevron" />
      {onBack ? <button type="button" onClick={onBack}>Flashcards</button> : <span aria-current="page">Flashcards</span>}
      {crumb && <><Icon name="chevron" /><span aria-current="page">{crumb}</span></>}
    </nav>
    <div className={styles.headingText}>
      <span className={styles.headingIcon}><Icon name={icon} /></span>
      <div><h1>{title}</h1><p>{description}</p></div>
    </div>
    <Image className={styles.heroArt} src="/illustrations/flashcards-cat.svg" width={348} height={170} alt="" loading="eager" />
  </header>;
}

function Stat({ label, icon, value, tone, ratio }: {
  label: string; icon: SiteIconName; value: ReactNode; tone?: string; ratio?: number;
}) {
  return <div className={styles.stat}>
    {ratio === undefined ? <span className={styles.statIcon} data-tone={tone}><Icon name={icon} /></span> :
      <span className={styles.ring} style={{ background: `conic-gradient(#086df2 ${ratio}%, #e1eafe 0)` }} aria-hidden="true" />}
    <div><dt>{label}</dt><dd>{value}</dd></div>
  </div>;
}

export default function FlashcardLibrary({ decks, learned, favorites, favoriteReady, progressUnavailable, busy, onRefresh, onCreate, onOpen, onAdd, onFavorite, onEdit, onDelete }: {
  decks: Deck[] | null; learned: Record<number, number>; favorites: number[]; favoriteReady: boolean; progressUnavailable: boolean; busy: boolean;
  onRefresh: () => void; onCreate: () => void; onOpen: (deck: Deck) => void; onAdd: (deck: Deck) => void;
  onFavorite: (deck: Deck) => void; onEdit: (deck: Deck) => void; onDelete: (deck: Deck) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [page, setPage] = useState(1);
  const list = decks ?? [];
  const favoriteIds = new Set(favorites);
  const owned = list.filter(deck => deck.canEdit && deck.cardCount > 0);
  const complete = owned.filter(deck => learned[deck.deckId] === deck.cardCount);
  const learning = owned.filter(deck => learned[deck.deckId] !== undefined && learned[deck.deckId] < deck.cardCount);
  const favorite = list.filter(deck => favoriteIds.has(deck.deckId));
  const groups = { all: list, learning, complete, favorites: favorite };
  const totalWords = list.reduce((total, deck) => total + deck.cardCount, 0);
  const ownWords = owned.reduce((total, deck) => total + deck.cardCount, 0);
  const remembered = decks && owned.every(deck => learned[deck.deckId] !== undefined)
    ? owned.reduce((total, deck) => total + learned[deck.deckId], 0) : null;
  const ratio = remembered === null || !ownWords ? 0 : Math.round(remembered / ownWords * 100);
  const items = [...groups[filter]];
  if (sort === "title") items.sort((a, b) => a.title.localeCompare(b.title, "vi"));
  if (sort === "count") items.sort((a, b) => b.cardCount - a.cardCount);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  const visiblePages = Array.from({ length: Math.min(3, pages) }, (_, index) => Math.max(1, Math.min(current - 1, pages - 2)) + index);

  return <>
    <FlashcardHeading title="Flashcards" description="Học và ghi nhớ từ vựng hiệu quả với thẻ ghi nhớ thông minh." icon="cards" />
    <div className={styles.overview}>
      <dl className={styles.stats} aria-label="Thống kê Flashcards">
        <Stat icon="cards" value={decks ? list.length : "—"} label="Bộ thẻ" />
        <Stat icon="book" value={decks ? totalWords : "—"} label="Từ vựng" tone="purple" />
        <Stat icon="check" value={remembered ?? "—"} label="Đã ghi nhớ" tone="green" />
        <Stat icon="trend" value={remembered === null ? "—" : `${ratio}%`} label="Tỷ lệ ghi nhớ" ratio={ratio} />
      </dl>
      <div className={styles.createTile}><button type="button" className={styles.primary} disabled={busy} onClick={onCreate}><Icon name="plus" /> Tạo bộ thẻ mới</button></div>
    </div>

    <section className={styles.library} aria-label="Thư viện bộ thẻ">
      <div className={styles.toolbar}>
        <div className={styles.tabs} aria-label="Lọc bộ thẻ">{tabs.map(([id, label]) =>
          <button type="button" key={id} aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(1); }}>
            {label} ({(id === "learning" || id === "complete") && remembered === null ? "—" : groups[id].length})
          </button>)}</div>
        <div className={styles.controls}>
          <select aria-label="Sắp xếp bộ thẻ" value={sort} onChange={event => { setSort(event.target.value as Sort); setPage(1); }}>
            <option value="recent">Mới cập nhật</option><option value="title">Tên A–Z</option><option value="count">Nhiều từ nhất</option>
          </select>
          <div className={styles.layoutToggle} aria-label="Kiểu hiển thị">
            <button type="button" aria-label="Dạng lưới" title="Dạng lưới" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><Icon name="dashboard" /></button>
            <button type="button" aria-label="Dạng danh sách" title="Dạng danh sách" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><Icon name="menu" /></button>
          </div>
        </div>
      </div>

      {decks && progressUnavailable && <p className={styles.progressNotice}>Chưa tải được tiến độ của một số bộ thẻ. <button type="button" disabled={busy} onClick={onRefresh}>Tải lại</button></p>}
      {!decks ? <div className={styles.empty}>
        <Icon name="replay" /><h2>Chưa tải được bộ thẻ</h2><button type="button" disabled={busy} onClick={onRefresh}>Tải lại</button>
      </div> : !items.length ? <div className={styles.empty}>
        <Icon name={filter === "favorites" ? "star" : "cards"} />
        <h2>{(filter === "learning" || filter === "complete") && remembered === null && !progressUnavailable
          ? "Đang tải tiến độ…" : list.length ? "Chưa có bộ thẻ trong mục này" : "Tạo bộ thẻ đầu tiên"}</h2>
        <p>{list.length ? filter === "favorites" ? "Bấm ngôi sao trên bộ thẻ để lưu vào mục Yêu thích." : "Các bộ thẻ sẽ xuất hiện ở đây theo tiến độ ôn của bạn." : "Tập hợp từ vựng theo chủ đề để tiện ôn mỗi ngày."}</p>
        {list.length ? <button type="button" onClick={() => { setFilter("all"); setPage(1); }}>Xem tất cả</button> :
          <button type="button" className={styles.primary} disabled={busy} onClick={onCreate}><Icon name="plus" /> Tạo bộ thẻ mới</button>}
      </div> : <>
        <ul className={styles.decks} data-layout={layout}>{items.slice(start, start + pageSize).map(deck => {
          const art = deckArt(deck);
          const selected = favoriteIds.has(deck.deckId);
          const count = learned[deck.deckId];
          const percent = !deck.cardCount ? 0 : count === undefined ? null : Math.round(count / deck.cardCount * 100);
          return <li key={deck.deckId} className={styles.deckTile} data-tone={art.tone}>
            <button type="button" className={styles.deckOpen} disabled={busy} onClick={() => onOpen(deck)}>
              <span className={styles.deckIcon}><Icon name={art.icon} /></span>
              <strong>{deck.title}</strong>
              <span className={styles.deckMeta}><Icon name="cards" /> {deck.cardCount} từ{!deck.canEdit && " · Chỉ đọc"}</span>
              {deck.canEdit && <span className={styles.deckProgress}>
                {percent === null ? <i className={styles.meterTrack} aria-hidden="true" /> :
                  <progress max={100} value={percent} aria-label={`Tiến độ ${deck.title}`} />}
                <b>{percent === null ? "—" : `${percent}%`}</b>
              </span>}
            </button>
            <button type="button" className={styles.favorite} aria-label={`Yêu thích ${deck.title}`} title={selected ? "Bỏ yêu thích" : "Yêu thích"}
              aria-pressed={selected} disabled={busy || !favoriteReady} onClick={() => onFavorite(deck)}><Icon name="star" /></button>
            <details className={styles.deckMenu}>
              <summary aria-label={`Thao tác với ${deck.title}`} title="Thao tác">⋮</summary>
              <div onClick={event => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.parentElement?.removeAttribute("open"); }}>
                <button type="button" disabled={busy} onClick={() => onOpen(deck)}>Mở bộ thẻ</button>
                {deck.canEdit && <>
                  <button type="button" disabled={busy} onClick={() => onAdd(deck)}>Thêm thẻ</button>
                  <button type="button" disabled={busy} onClick={() => onEdit(deck)}>Sửa bộ</button>
                  <button type="button" disabled={busy} className={styles.danger} onClick={() => onDelete(deck)}>Xóa bộ</button>
                </>}
              </div>
            </details>
          </li>;
        })}</ul>
        <div className={styles.pagination}>
          <span>Hiển thị {start + 1}–{Math.min(start + pageSize, items.length)} trên tổng số <strong>{items.length} bộ thẻ</strong></span>
          {pages > 1 && <nav aria-label="Phân trang bộ thẻ">
            <button type="button" aria-label="Trang trước" disabled={current === 1} onClick={() => setPage(current - 1)}><Icon name="chevron" /></button>
            {visiblePages.map(number => <button type="button" key={number} aria-label={`Trang ${number}`} aria-current={current === number ? "page" : undefined} onClick={() => setPage(number)}>{number}</button>)}
            <button type="button" aria-label="Trang sau" disabled={current === pages} onClick={() => setPage(current + 1)}><Icon name="chevron" /></button>
          </nav>}
        </div>
      </>}
    </section>
  </>;
}
