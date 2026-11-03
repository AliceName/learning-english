"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Deck, DeckDetail, Flashcard } from "@/lib/flashcards";
import styles from "./flashcards.module.css";

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/flashcards/${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000), cache: "no-store" });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const details = data?.errors ? Object.values(data.errors).flat().join(" ") : "";
    throw new Error(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : details || data?.title || "Chưa xử lý được yêu cầu. Vui lòng thử lại.");
  }
  return data as T;
}
const dateLabel = (date: string | null) => date ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(date)) : "Thẻ mới";
const emptyCard = { frontText: "", backText: "", exampleSentence: "" };

export default function FlashcardsWorkspace({ initialDecks, isAdmin }: { initialDecks: Deck[] | null; isAdmin: boolean }) {
  const [decks, setDecks] = useState(initialDecks);
  const [detail, setDetail] = useState<DeckDetail | null>(null);
  const [deckTitle, setDeckTitle] = useState(""); const [deckDescription, setDeckDescription] = useState("");
  const [editDeck, setEditDeck] = useState(false);
  const [cardForm, setCardForm] = useState(emptyCard); const [editingCard, setEditingCard] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [study, setStudy] = useState<Flashcard[] | null>(null); const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0); const [total, setTotal] = useState(0);
  const current = study?.[0];
  function copyForStudy() {
    if (!detail || detail.deck.canEdit) return;
    void perform(async () => {
      const copy = await api<Deck>(`decks/${detail.deck.deckId}/copy`, "POST", {});
      await refresh(copy.deckId); setStudy(null); setEditDeck(false); setEditingCard(null); setCardForm(emptyCard);
      setNotice("Đã tạo bản sao riêng để ôn. Bản gốc của admin không thay đổi; bản sao không tự đồng bộ khi admin sửa.");
    });
  }
  async function perform(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (e) { setError(e instanceof Error && e.name === "TimeoutError" ? "Máy chủ phản hồi quá lâu. Hãy tải lại để kiểm tra trước khi thử lại." : e instanceof Error ? e.message : "Kết nối bị gián đoạn."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function refresh(id?: number) {
    const list = await api<Deck[]>("decks"); setDecks(list);
    if (id) setDetail(await api<DeckDetail>(`decks/${id}`));
  }
  function open(id: number) { void perform(async () => {
    const data = await api<DeckDetail>(`decks/${id}`); setDetail(data); setStudy(null); setEditDeck(false); setCardForm(emptyCard); setEditingCard(null);
  }); }
  function saveDeck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      if (!deckTitle.trim()) throw new Error("Nhập tên bộ thẻ.");
      const deck = await api<Deck>(editDeck && detail ? `decks/${detail.deck.deckId}` : "decks", editDeck ? "PUT" : "POST", { title: deckTitle, description: deckDescription || null });
      await refresh(deck.deckId); setDeckTitle(""); setDeckDescription(""); setEditDeck(false); setStudy(null); setCardForm(emptyCard); setEditingCard(null); setNotice("Đã lưu bộ thẻ.");
    });
  }
  function saveCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail?.deck.canEdit) return;
    void perform(async () => {
      if (!cardForm.frontText.trim() || !cardForm.backText.trim()) throw new Error("Nhập đủ từ và nghĩa.");
      await api(editingCard ? `cards/${editingCard}` : `decks/${detail.deck.deckId}/cards`, editingCard ? "PUT" : "POST", cardForm);
      await refresh(detail.deck.deckId); setEditingCard(null); setCardForm(emptyCard); setNotice("Đã lưu thẻ. Thẻ mới hoặc vừa sửa sẵn sàng để ôn.");
    });
  }
  function startStudy() {
    if (!detail?.deck.canEdit) return;
    // Refresh due status from the server; cards can become due while this page stays open.
    void perform(async () => {
      const fresh = await api<DeckDetail>(`decks/${detail.deck.deckId}`); setDetail(fresh);
      const queue = fresh.cards.filter(c => c.isDue).sort((a, b) => (a.nextReviewAt ?? "").localeCompare(b.nextReviewAt ?? "") || a.cardId - b.cardId);
      setStudy(queue); setTotal(queue.length); setReviewed(0); setFlipped(false);
    });
  }
  function rate(rating: number) {
    if (!current || !detail || !flipped) return;
    void perform(async () => {
      await api(`cards/${current.cardId}/review`, "POST", { rating, expectedUpdatedAt: current.updatedAt });
      // Remove only after the server acknowledges the review, preventing fake completion on failure.
      setStudy(old => old?.slice(1) ?? null); setFlipped(false); setReviewed(old => old + 1);
      await refresh(detail.deck.deckId);
    });
  }

  return <main id="main-content" tabIndex={-1} className={styles.page}>
    <header className={styles.heading}><span>TỪ VỰNG CỦA BẠN</span><h1>Học mỗi ngày với <em>Flashcards</em></h1><p>Tạo bộ từ vựng, lật thẻ để nhớ nghĩa và tự đánh giá sau mỗi lượt ôn.</p></header>
    <div className={styles.stats}><span><b>{decks?.length ?? "—"}</b> bộ thẻ</span><span><b>{decks?.reduce((n, d) => n + d.cardCount, 0) ?? "—"}</b> từ vựng</span><span><b>{decks?.reduce((n, d) => n + d.dueCount, 0) ?? "—"}</b> thẻ đến lịch</span></div>
    <div aria-live="polite">{error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}</div>
    <div className={styles.layout}><aside className={styles.sidebar}>
      <section className={styles.panel}><h2>{editDeck ? "Đổi thông tin bộ thẻ" : "Tạo bộ thẻ mới"}</h2>{isAdmin && <p>Bộ thẻ bạn tạo với vai trò admin sẽ được chia sẻ cho mọi người dùng. Chỉ bạn được chỉnh sửa bản gốc.</p>}<form onSubmit={saveDeck}><fieldset disabled={busy} className={styles.form}>
        <label htmlFor="deck-title">Tên bộ thẻ<input id="deck-title" value={deckTitle} onChange={e => setDeckTitle(e.target.value)} maxLength={255} required placeholder="Ví dụ: Từ vựng giao tiếp" /></label>
        <label htmlFor="deck-description">Mô tả <small>(không bắt buộc)</small><textarea id="deck-description" value={deckDescription} onChange={e => setDeckDescription(e.target.value)} maxLength={500} rows={2} /></label>
        <button className={styles.primary} type="submit">{editDeck ? "Lưu bộ thẻ" : "+ Tạo bộ thẻ"}</button>{editDeck && <button type="button" onClick={() => { setEditDeck(false); setDeckTitle(""); setDeckDescription(""); }}>Hủy sửa</button>}
      </fieldset></form></section>
      <section className={styles.panel}><div className={styles.top}><h2>Thư viện bộ thẻ</h2><button disabled={busy} onClick={() => void perform(async () => { await refresh(detail?.deck.deckId); })}>↻ Tải lại</button></div>
        {decks === null ? <p>Chưa tải được bộ thẻ. Bấm Tải lại để thử lại.</p> : decks.length === 0 ? <p>Chưa có bộ thẻ. Hãy tạo bộ đầu tiên của bạn.</p> : <ul className={styles.deckList}>{decks.map(deck => <li key={deck.deckId}><button disabled={busy} aria-current={detail?.deck.deckId === deck.deckId ? "true" : undefined} onClick={() => open(deck.deckId)}><strong>{deck.title}</strong><span>{deck.isAdminDeck ? "ADMIN · " : "CỦA BẠN · "}{!deck.canEdit ? "CHỈ ĐỌC · " : ""}{deck.cardCount} thẻ{deck.canEdit ? ` · ${deck.dueCount} đến lịch` : ""}</span></button></li>)}</ul>}
      </section>
    </aside><section className={styles.content} aria-label="Nội dung bộ thẻ">
      {!detail ? <div className={`${styles.panel} ${styles.empty}`}><span aria-hidden="true">▤</span><h2>Bắt đầu bộ sưu tập từ của bạn</h2><p>Chọn một bộ thẻ hoặc tạo bộ mới ở bên trái. Mỗi thẻ có từ, nghĩa và câu ví dụ tùy chọn.</p></div> : <>
        <section className={styles.panel}><div className={styles.top}><div><h2>{detail.deck.title}</h2><p>{detail.deck.description || "Bộ từ vựng"}</p><span className={styles.sourceBadge}>{detail.deck.isAdminDeck ? "Bộ thẻ admin" : "Bộ thẻ của bạn"}{!detail.deck.canEdit ? " · Chỉ đọc" : ""}</span></div>{detail.deck.canEdit && <div className={styles.actions}>
          <button disabled={busy} onClick={() => { setEditDeck(true); setDeckTitle(detail.deck.title); setDeckDescription(detail.deck.description ?? ""); }}>Sửa bộ</button>
          <button className={styles.danger} disabled={busy} onClick={() => { if (window.confirm(`Xóa bộ “${detail.deck.title}” và toàn bộ ${detail.deck.cardCount} thẻ? Không thể hoàn tác.`)) void perform(async () => { await api(`decks/${detail.deck.deckId}`, "DELETE"); setDetail(null); setStudy(null); setEditDeck(false); setDeckTitle(""); setDeckDescription(""); await refresh(); setNotice("Đã xóa bộ thẻ."); }); }}>Xóa bộ</button>
        </div>}</div>{!detail.deck.canEdit && <p>Bản gốc do admin quản lý, bạn không thể thêm, sửa hoặc xóa thẻ. Tạo bản sao riêng để lưu lịch ôn của bạn. Bản sao không tự cập nhật theo bản gốc.</p>}<div className={styles.actions}>{detail.deck.canEdit ? <button className={styles.primary} disabled={busy || detail.cards.length === 0} onClick={startStudy}>▷ Ôn thẻ đến lịch</button> : <button className={styles.primary} disabled={busy || detail.cards.length === 0} onClick={copyForStudy}>+ Tạo bản sao để ôn</button>}<button disabled={busy} onClick={() => setStudy(null)}>{detail.deck.canEdit ? "Quản lý thẻ" : "Xem các thẻ"}</button><span>{detail.deck.cardCount} thẻ{detail.deck.canEdit ? ` · ${detail.deck.dueCount} đến lịch` : ""}</span></div></section>
        {study !== null ? <section className={styles.panel} aria-label="Ôn tập thẻ">
          <div className={styles.top}><h2>Phiên ôn tập</h2><span>{reviewed} / {total} thẻ</span></div><progress className={styles.progress} value={reviewed} max={Math.max(total, 1)} aria-label="Tiến độ phiên ôn" />
          {current ? <><button className={styles.flipCard} disabled={busy} onClick={() => setFlipped(old => !old)} aria-label={flipped ? "Đang xem nghĩa. Bấm để xem từ." : "Bấm để lật thẻ và xem nghĩa."} aria-pressed={flipped}>
            <small>{flipped ? "MẶT SAU · NGHĨA" : "MẶT TRƯỚC · TỪ VỰNG"}</small><strong lang={flipped ? "vi" : "en"}>{flipped ? current.backText : current.frontText}</strong>{flipped && current.exampleSentence && <span lang="en">{current.exampleSentence}</span>}<small>Bấm hoặc nhấn Enter để lật thẻ</small>
          </button>{flipped ? <div className={styles.ratings} aria-label="Tự đánh giá mức ghi nhớ">{["Quên", "Khó", "Nhớ", "Dễ"].map((label, rating) => <button key={label} disabled={busy} onClick={() => rate(rating)}><strong>{label}</strong><small>{rating === 0 ? "Ôn lại sau 5 phút" : "Lên lịch lần tới"}</small></button>)}</div> : <p className={styles.help}>Hãy tự nhớ nghĩa trước khi lật. Lật thẻ để chọn mức độ ghi nhớ.</p>}</> : <div className={styles.complete}><h3>{total ? "Bạn đã hoàn thành phiên ôn!" : "Chưa có thẻ đến lịch"}</h3><p>{total ? `Đã lưu đánh giá cho ${reviewed} thẻ. Thẻ chọn Quên sẽ đến lịch sau 5 phút.` : "Bạn có thể thêm thẻ mới hoặc quay lại khi đến lịch ôn."}</p><button disabled={busy} onClick={startStudy}>Kiểm tra lịch mới</button><button disabled={busy} onClick={() => setStudy(null)}>Về quản lý thẻ</button></div>}
          <p className={styles.help}>Mức ghi nhớ do bạn tự đánh giá. Lịch ôn được lưu theo từng tài khoản.</p>
        </section> : <>
          {detail.deck.canEdit && <section className={styles.panel}><h2>{editingCard ? "Chỉnh sửa thẻ" : "Thêm từ mới"}</h2><form onSubmit={saveCard}><fieldset className={styles.form} disabled={busy}>
            <label htmlFor="card-front">Từ tiếng Anh / mặt trước<input id="card-front" value={cardForm.frontText} onChange={e => setCardForm(old => ({ ...old, frontText: e.target.value }))} maxLength={500} required placeholder="Ví dụ: confident" /></label>
            <label htmlFor="card-back">Nghĩa / mặt sau<textarea id="card-back" value={cardForm.backText} onChange={e => setCardForm(old => ({ ...old, backText: e.target.value }))} maxLength={1000} rows={2} required placeholder="Tự tin" /></label>
            <label htmlFor="card-example">Câu ví dụ <small>(không bắt buộc)</small><textarea id="card-example" value={cardForm.exampleSentence} onChange={e => setCardForm(old => ({ ...old, exampleSentence: e.target.value }))} maxLength={1000} rows={2} placeholder="I feel confident when I speak English." /></label>
            {editingCard && <small>Sửa thẻ sẽ đặt lại lịch ghi nhớ của thẻ này.</small>}<div className={styles.actions}><button className={styles.primary} type="submit">{editingCard ? "Lưu thẻ" : "+ Thêm thẻ"}</button>{editingCard && <button type="button" onClick={() => { setEditingCard(null); setCardForm(emptyCard); }}>Hủy sửa</button>}</div>
          </fieldset></form></section>}
          <section className={styles.panel}><h2>Danh sách từ ({detail.cards.length})</h2>{detail.cards.length === 0 ? <p>{detail.deck.canEdit ? "Chưa có từ nào. Thêm thẻ đầu tiên ở trên để bắt đầu ôn." : "Admin chưa thêm từ vào bộ thẻ này."}</p> : <ul className={styles.cardList}>{detail.cards.map(card => <li key={card.cardId}><div><strong lang="en">{card.frontText}</strong><p>{card.backText}</p>{card.exampleSentence && <blockquote lang="en">{card.exampleSentence}</blockquote>}{detail.deck.canEdit && <small>{card.isDue ? "Đến lịch ôn" : `Ôn tiếp: ${dateLabel(card.nextReviewAt)}`} · {card.repetition} lần nhớ liên tiếp</small>}</div>{detail.deck.canEdit && <div className={styles.actions}><button disabled={busy} onClick={() => { setEditingCard(card.cardId); setCardForm({ frontText: card.frontText, backText: card.backText, exampleSentence: card.exampleSentence ?? "" }); document.getElementById("card-front")?.focus(); }}>Sửa</button><button className={styles.danger} disabled={busy} onClick={() => { if (window.confirm(`Xóa thẻ “${card.frontText}”?`)) void perform(async () => { await api(`cards/${card.cardId}`, "DELETE"); if (editingCard === card.cardId) { setEditingCard(null); setCardForm(emptyCard); } await refresh(detail.deck.deckId); setNotice("Đã xóa thẻ."); }); }}>Xóa</button></div>}</li>)}</ul>}</section>
        </>}
      </>}
    </section></div>
  </main>;
}
