"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Icon from "@/components/site-icon";
import type { Deck, DeckDetail, Flashcard } from "@/lib/flashcards";
import FlashcardEditor, { type CardFields } from "./card-editor";
import FlashcardLibrary, { FlashcardHeading } from "./library";
import { deckPreferencePrefix, emptyPreferences, favoritePrefix, readFavorites, readPreference, removePreferences, writePreference, type CardPreferences } from "./preferences";
import StudyCard from "./study-card";
import styles from "./flashcards.module.css";

async function api<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(120_000);
  const response = await fetch("/api/flashcards/" + path, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout, cache: "no-store",
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const details = data?.errors ? Object.values(data.errors).flat().join(" ") : "";
    throw new Error(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : details || data?.title || "Chưa xử lý được yêu cầu. Vui lòng thử lại.");
  }
  return data as T;
}

const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" });
const dateLabel = (date: string | null) => date ? dateFormat.format(new Date(date)) : "Thẻ mới";
type DeckForm = { original?: Deck; title: string; description: string };
type Editor = { card?: Flashcard; preferences: CardPreferences };

export default function FlashcardsWorkspace({ initialDecks, account, isAdmin }: {
  initialDecks: Deck[] | null; account?: string; isAdmin: boolean;
}) {
  const [decks, setDecks] = useState(initialDecks);
  const [detail, setDetail] = useState<DeckDetail | null>(null);
  const [learned, setLearned] = useState<Record<number, number>>({});
  const [progressUnavailable, setProgressUnavailable] = useState(false);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [favoriteReady, setFavoriteReady] = useState(false);
  const [deckForm, setDeckForm] = useState<DeckForm | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [study, setStudy] = useState<Flashcard[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [total, setTotal] = useState(0);
  const pending = useRef(false);
  const deckDialog = useRef<HTMLDialogElement>(null);
  const centerReview = useRef(false);
  const studyCard = useRef<HTMLButtonElement>(null);
  const studyHeading = useRef<HTMLHeadingElement>(null);
  const current = study?.[0];
  const view = editor ? "editor" : detail ? "detail" : "library";
  const deckDialogOpen = deckForm !== null;

  useEffect(() => {
    if (deckDialogOpen) deckDialog.current?.showModal();
  }, [deckDialogOpen]);

  useEffect(() => {
    if (view !== "library") window.scrollTo({ top: 0 });
  }, [view]);

  useEffect(() => {
    if (!study || !centerReview.current) return;
    centerReview.current = false;
    const target = studyCard.current ?? studyHeading.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, [study]);

  useEffect(() => {
    if (!account) return;
    let active = true;
    void readFavorites(account).then(ids => {
      if (active) setFavorites(ids);
    }, () => {}).finally(() => { if (active) setFavoriteReady(true); });
    return () => { active = false; };
  }, [account]);

  useEffect(() => {
    if (!decks || view !== "library") return;
    const controller = new AbortController();
    const owned = decks.filter(deck => deck.canEdit && deck.cardCount > 0);
    async function loadProgress() {
      const counts: Record<number, number> = {};
      for (let offset = 0; offset < owned.length && !controller.signal.aborted; offset += 5) {
        await Promise.all(owned.slice(offset, offset + 5).map(async deck => {
          try {
            const result = await api<DeckDetail>("decks/" + deck.deckId, "GET", undefined, controller.signal);
            counts[deck.deckId] = Math.min(deck.cardCount, result.cards.filter(card => card.repetition > 0).length);
          } catch { /* A failed detail request leaves this deck's progress unknown. */ }
        }));
      }
      if (!controller.signal.aborted) {
        setLearned(counts);
        setProgressUnavailable(Object.keys(counts).length !== owned.length);
      }
    }
    void loadProgress();
    return () => controller.abort();
  }, [decks, view]);

  async function perform(action: () => Promise<void>) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true); setError(""); setNotice("");
    try { await action(); return true; }
    catch (e) {
      setError(e instanceof Error && e.name === "TimeoutError"
        ? "Máy chủ phản hồi quá lâu. Hãy tải lại để kiểm tra trước khi thử lại."
        : e instanceof Error ? e.message : "Kết nối bị gián đoạn.");
      return false;
    } finally { pending.current = false; setBusy(false); }
  }

  function updateDeck(deck: Deck, promote = false) {
    setDecks(previous => {
      const list = previous ?? [];
      return promote || !list.some(item => item.deckId === deck.deckId)
        ? [deck, ...list.filter(item => item.deckId !== deck.deckId)]
        : list.map(item => item.deckId === deck.deckId ? deck : item);
    });
  }

  function applyCards(currentDetail: DeckDetail, cards: Flashcard[], promote = false) {
    const deck = { ...currentDetail.deck, cardCount: cards.length, dueCount: cards.filter(card => card.isDue).length };
    setDetail({ deck, cards });
    updateDeck(deck, promote);
    setLearned(previous => ({ ...previous, [deck.deckId]: cards.filter(card => card.repetition > 0).length }));
  }

  function openDeck(deck: Deck, add = false) {
    void perform(async () => {
      const next = await api<DeckDetail>("decks/" + deck.deckId);
      setDetail(next); setStudy(null);
      setEditor(add && next.deck.canEdit ? { preferences: emptyPreferences } : null);
    });
  }

  function showLibrary() {
    if (busy) return;
    setEditor(null); setDetail(null); setStudy(null); setError(""); setNotice("");
  }

  function closeEditor() {
    if (busy) return;
    setEditor(null); setError(""); setNotice("");
  }

  function editCard(card: Flashcard) {
    void perform(async () => {
      let preferences = emptyPreferences;
      if (account) {
        try { preferences = await readPreference<CardPreferences>(deckPreferencePrefix(account, card.deckId) + card.cardId) ?? preferences; }
        catch { setNotice("Chưa đọc được ảnh, phiên âm và CEFR từ trình duyệt."); }
      }
      setEditor({ card, preferences });
    });
  }

  function openDeckForm(deck?: Deck) {
    setError(""); setNotice("");
    setDeckForm({ original: deck, title: deck?.title ?? "", description: deck?.description ?? "" });
  }

  function saveDeck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deckForm) return;
    void perform(async () => {
      if (!deckForm.title.trim()) throw new Error("Nhập tên bộ thẻ.");
      const original = deckForm.original;
      const deck = await api<Deck>(original ? "decks/" + original.deckId : "decks", original ? "PUT" : "POST", {
        title: deckForm.title, description: deckForm.description || null,
      });
      updateDeck(deck, true);
      let message = "Đã lưu bộ thẻ.";
      if (!original) {
        setDetail({ deck, cards: [] }); setStudy(null); setEditor(null);
        // A create from the retry state may be the only deck in memory until the next list request.
        if (!decks) {
          try { setDecks(await api<Deck[]>("decks")); }
          catch { message = "Đã lưu bộ thẻ. Tải lại trang để cập nhật danh sách."; }
        }
      } else if (detail?.deck.deckId === deck.deckId) {
        setDetail({ ...detail, deck });
      }
      deckDialog.current?.close();
      setNotice(message);
    });
  }

  function toggleFavorite(deck: Deck) {
    const selected = favorites.includes(deck.deckId);
    setFavorites(previous => selected ? previous.filter(id => id !== deck.deckId) : [...previous, deck.deckId]);
    if (!account) return;
    const key = favoritePrefix(account) + deck.deckId;
    void (selected ? removePreferences(key) : writePreference(key, true))
      .catch(() => setNotice("Chưa lưu được mục yêu thích. Thay đổi chỉ có trong phiên này."));
  }

  function deleteDeck(deck: Deck) {
    if (!window.confirm("Xóa bộ “" + deck.title + "” và toàn bộ " + deck.cardCount + " thẻ? Không thể hoàn tác.")) return;
    void perform(async () => {
      await api("decks/" + deck.deckId, "DELETE");
      if (detail?.deck.deckId === deck.deckId) { setDetail(null); setStudy(null); setEditor(null); }
      setDecks(previous => previous?.filter(item => item.deckId !== deck.deckId) ?? null);
      setFavorites(previous => previous.filter(id => id !== deck.deckId));
      if (account) {
        const prefix = deckPreferencePrefix(account, deck.deckId);
        await Promise.allSettled([removePreferences(IDBKeyRange.bound(prefix, prefix + "\uffff")),
          removePreferences(favoritePrefix(account) + deck.deckId)]);
      }
      setNotice("Đã xóa bộ thẻ.");
    });
  }

  function copyForStudy() {
    if (!detail || detail.deck.canEdit) return;
    void perform(async () => {
      const copy = await api<Deck>("decks/" + detail.deck.deckId + "/copy", "POST", {});
      updateDeck(copy, true);
      setStudy(null); setEditor(null);
      try {
        setDetail(await api<DeckDetail>("decks/" + copy.deckId));
        setNotice("Đã tạo bản sao riêng để ôn.");
      } catch {
        setDetail(null);
        setNotice("Đã tạo bản sao riêng. Mở bộ thẻ mới trong thư viện để ôn.");
      }
    });
  }

  function chooseDeck(id: number) {
    void perform(async () => {
      const next = await api<DeckDetail>("decks/" + id);
      if (!next.deck.canEdit) throw new Error("Bạn chỉ có thể thêm thẻ vào bộ của mình.");
      setDetail(next);
    });
  }

  async function saveCard(fields: CardFields, preferences: CardPreferences, keepOpen: boolean) {
    if (!detail?.deck.canEdit || !editor) return false;
    const existing = editor.card;
    return perform(async () => {
      const contentChanged = !existing || fields.frontText.trim() !== existing.frontText
        || fields.backText.trim() !== existing.backText || fields.exampleSentence.trim() !== (existing.exampleSentence ?? "");
      const card = contentChanged
        ? await api<Flashcard>(existing ? "cards/" + existing.cardId : "decks/" + detail.deck.deckId + "/cards", existing ? "PUT" : "POST", fields)
        : existing;
      if (contentChanged) {
        applyCards(detail, existing ? detail.cards.map(item => item.cardId === card.cardId ? card : item) : [...detail.cards, card], !existing);
      }
      let message = contentChanged ? "Đã lưu thẻ. Thẻ sẵn sàng để ôn." : "Đã lưu thẻ.";
      const hasPreferences = preferences.level || preferences.image || preferences.phonetic;
      if (account && (existing || hasPreferences)) {
        try {
          const key = deckPreferencePrefix(account, card.deckId) + card.cardId;
          if (hasPreferences) await writePreference(key, preferences);
          else await removePreferences(key);
        } catch {
          const issue = "Chưa lưu được ảnh, phiên âm hoặc CEFR trên trình duyệt này.";
          if (!contentChanged) throw new Error(issue);
          message = "Đã lưu từ và nghĩa. " + issue;
        }
      }
      if (!keepOpen) setEditor(null);
      setNotice(message);
    });
  }

  function deleteCard(card: Flashcard) {
    if (!detail?.deck.canEdit || !window.confirm("Xóa thẻ “" + card.frontText + "”?")) return;
    void perform(async () => {
      await api("cards/" + card.cardId, "DELETE");
      applyCards(detail, detail.cards.filter(item => item.cardId !== card.cardId));
      if (account) await removePreferences(deckPreferencePrefix(account, card.deckId) + card.cardId).catch(() => {});
      setNotice("Đã xóa thẻ.");
    });
  }

  function startStudy() {
    if (!detail?.deck.canEdit) return;
    void perform(async () => {
      const fresh = await api<DeckDetail>("decks/" + detail.deck.deckId);
      if (!fresh.deck.canEdit) throw new Error("Bạn cần tạo bản sao riêng để lưu lịch ôn.");
      setDetail(fresh); updateDeck(fresh.deck);
      const queue = fresh.cards.filter(card => card.isDue).sort((a, b) =>
        (a.nextReviewAt ?? "").localeCompare(b.nextReviewAt ?? "") || a.cardId - b.cardId);
      centerReview.current = true;
      setStudy(queue); setTotal(queue.length); setReviewed(0); setFlipped(false);
    });
  }

  function rate(rating: number) {
    if (!current || !detail || !flipped) return;
    void perform(async () => {
      const result = await api<Flashcard>("cards/" + current.cardId + "/review", "POST", { rating, expectedUpdatedAt: current.updatedAt });
      setStudy(previous => previous?.slice(1) ?? null);
      setFlipped(false); setReviewed(previous => previous + 1);
      applyCards(detail, detail.cards.map(item => item.cardId === result.cardId ? result : item));
    });
  }

  return <main id="main-content" tabIndex={-1} className={styles.page}>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {error && !deckDialogOpen && <p role="alert" className={styles.error}>{error}</p>}
    {!detail ? <FlashcardLibrary decks={decks} learned={learned} favorites={favorites} favoriteReady={favoriteReady} progressUnavailable={progressUnavailable} busy={busy}
      onRefresh={() => void perform(async () => setDecks(await api<Deck[]>("decks")))}
      onCreate={() => openDeckForm()} onOpen={openDeck} onAdd={deck => openDeck(deck, true)} onFavorite={toggleFavorite}
      onEdit={openDeckForm} onDelete={deleteDeck} /> : editor ? <FlashcardEditor
      key={editor.card?.cardId ?? "create"} detail={detail} decks={decks ?? [detail.deck]} card={editor.card} initialPreferences={editor.preferences}
      busy={busy} onLibrary={showLibrary} onClose={closeEditor} onChooseDeck={chooseDeck} onSave={saveCard} /> : <>
      <FlashcardHeading title={detail.deck.title} description={detail.deck.description || "Bộ từ vựng"} icon="cards" crumb={study !== null ? "Ôn tập" : "Bộ thẻ"} onBack={showLibrary} />
      <section className={styles.panel}>
        <div className={styles.top}>
          <div><span className={styles.sourceBadge}>{detail.deck.isAdminDeck ? "Bộ thẻ admin" : "Bộ thẻ của bạn"}{!detail.deck.canEdit && " · Chỉ đọc"}</span>
            <p>{detail.deck.cardCount} từ{detail.deck.canEdit && " · " + detail.deck.dueCount + " thẻ đến lịch"}</p></div>
          {detail.deck.canEdit && <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => openDeckForm(detail.deck)}><Icon name="writing" /> Sửa bộ</button>
            <button type="button" disabled={busy} className={styles.danger} onClick={() => deleteDeck(detail.deck)}><Icon name="trash" /> Xóa bộ</button>
          </div>}
        </div>
        {!detail.deck.canEdit && <p>Bộ gốc do admin quản lý. Tạo bản sao riêng để thêm thẻ và lưu lịch ôn của bạn.</p>}
        <div className={styles.actions}>
          {detail.deck.canEdit ? <>
            <button className={styles.primary} type="button" disabled={busy} onClick={() => {
              setStudy(null); setError(""); setNotice(""); setEditor({ preferences: emptyPreferences });
            }}><Icon name="plus" /> Tạo thẻ mới</button>
            <button type="button" disabled={busy || !detail.cards.length} onClick={startStudy}><Icon name="play" /> Ôn thẻ đến lịch</button>
          </> : <button type="button" className={styles.primary} disabled={busy || !detail.cards.length} onClick={copyForStudy}><Icon name="plus" /> Tạo bản sao để ôn</button>}
          {study !== null && <button type="button" disabled={busy} onClick={() => setStudy(null)}>Quản lý thẻ</button>}
        </div>
      </section>
      {study !== null ? <section className={`${styles.panel} ${styles.studyPanel}`} aria-label="Ôn tập thẻ">
        <div className={styles.top}><h2 ref={studyHeading} tabIndex={-1}>Phiên ôn tập</h2><span>{reviewed} / {total} thẻ</span></div>
        <progress className={styles.progress} value={reviewed} max={Math.max(total, 1)} aria-label="Tiến độ phiên ôn" />
        {current ? <>
          <StudyCard key={current.cardId} account={account} card={current} flipped={flipped} busy={busy} flipRef={studyCard} onFlip={setFlipped} />
          {flipped ? <div className={styles.ratings} aria-label="Tự đánh giá mức ghi nhớ">
            {["Quên", "Khó", "Nhớ", "Dễ"].map((label, rating) => <button type="button" key={label} disabled={busy} onClick={() => rate(rating)}>
              <strong>{label}</strong><small>{rating === 0 ? "Ôn lại sau 5 phút" : "Lên lịch lần tới"}</small>
            </button>)}
          </div> : null}
          <p className={styles.studyHelp}><Icon name="bulb" /> Hãy tự nhớ nghĩa trước khi lật. Lật thẻ để chọn mức độ ghi nhớ.</p>
        </> : <div className={styles.complete}>
          <h3>{total ? "Bạn đã hoàn thành phiên ôn!" : "Chưa có thẻ đến lịch"}</h3>
          <p>{total ? "Đã lưu đánh giá cho " + reviewed + " thẻ." : "Bạn có thể thêm thẻ mới hoặc quay lại khi đến lịch ôn."}</p>
          <button type="button" disabled={busy} onClick={startStudy}>Kiểm tra lịch mới</button>
          <button type="button" disabled={busy} onClick={() => setStudy(null)}>Về quản lý thẻ</button>
        </div>}
      </section> : <section className={styles.panel}>
        <h2>Danh sách từ ({detail.cards.length})</h2>
        {!detail.cards.length ? <p>{detail.deck.canEdit ? "Chưa có từ nào. Tạo thẻ đầu tiên để bắt đầu ôn." : "Admin chưa thêm từ vào bộ thẻ này."}</p> :
          <ul className={styles.cardList}>{detail.cards.map(card => <li key={card.cardId}>
            <div><strong lang="en">{card.frontText}</strong><p>{card.backText}</p>
              {card.exampleSentence && <blockquote lang="en">{card.exampleSentence}</blockquote>}
              {detail.deck.canEdit && <small>{card.isDue ? "Đến lịch ôn" : "Ôn tiếp: " + dateLabel(card.nextReviewAt)} · {card.repetition} lần nhớ liên tiếp</small>}
            </div>
            {detail.deck.canEdit && <div className={styles.actions}>
              <button type="button" disabled={busy} onClick={() => editCard(card)}>Sửa</button>
              <button type="button" className={styles.danger} disabled={busy} onClick={() => deleteCard(card)}>Xóa</button>
            </div>}
          </li>)}</ul>}
      </section>}
    </>}
    {deckForm && <dialog ref={deckDialog} className={styles.dialog} aria-labelledby="flashcards-deck-title"
      onClose={() => { setDeckForm(null); setError(""); }} onCancel={event => { if (busy) event.preventDefault(); }}>
      <div className={styles.dialogContent}>
        <div className={styles.top}><h2 id="flashcards-deck-title">{deckForm.original ? "Sửa bộ thẻ" : "Tạo bộ thẻ mới"}</h2>
          <button type="button" aria-label="Đóng" disabled={busy} onClick={() => deckDialog.current?.close()}><Icon name="close" /></button>
        </div>
        {isAdmin && <p>Bộ thẻ do admin tạo được chia sẻ ở chế độ chỉ đọc.</p>}
        <form onSubmit={saveDeck}><fieldset disabled={busy} className={styles.form}>
          <label>Tên bộ thẻ<input autoFocus required maxLength={255} value={deckForm.title} placeholder="Ví dụ: Từ vựng giao tiếp"
            onChange={event => setDeckForm({ ...deckForm, title: event.target.value })} /></label>
          <label><span>Mô tả <small>(không bắt buộc)</small></span><textarea maxLength={500} rows={3} value={deckForm.description}
            onChange={event => setDeckForm({ ...deckForm, description: event.target.value })} /></label>
          <div className={styles.actions}><button type="button" onClick={() => deckDialog.current?.close()}>Hủy</button>
            <button type="submit" className={styles.primary}><Icon name="check" /> {deckForm.original ? "Lưu bộ thẻ" : "Tạo bộ thẻ"}</button></div>
        </fieldset></form>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>
    </dialog>}
  </main>;
}
