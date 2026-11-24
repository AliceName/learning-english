"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { bookmarkKey, type Bookmark, type BookmarkKey } from "@/lib/bookmarks";
import Icon from "@/components/site-icon";
import styles from "./bookmark-button.module.css";

type LoadResult = { items: Bookmark[]; error?: never } | { items: null; error: string };
type Store = {
  result: LoadResult | null;
  saved: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  reload: () => void;
  update: (key: BookmarkKey, save: boolean, title: string) => Promise<void>;
  saveNote: (key: BookmarkKey, note: string | null) => Promise<void>;
  offerUndo: (key: string, title: string, restore: () => Promise<void>) => void;
};
type Undo = { key: string; title: string; restore: () => Promise<void>; restoring?: boolean; error?: string };
type Mutation = "PUT" | "PATCH" | "DELETE";
const Context = createContext<Store | null>(null);

async function requestBookmarks(path: string, method: "GET" | Mutation, { signal, note }: { signal?: AbortSignal; note?: string | null } = {}) {
  const response = await fetch("/api/bookmarks" + path, {
    method, signal, cache: "no-store",
    ...(note !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) }),
  })
    .catch(() => { throw new Error("Chưa kết nối được máy chủ. Vui lòng thử lại."); });
  if (response.ok) return response;
  if (response.status === 401) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  if (response.status === 404) throw new Error(method === "PATCH" ? "Dấu trang này đã bị bỏ lưu." : "Nội dung này không còn mở được.");
  throw new Error(method === "GET" ? "Chưa tải được dấu trang." : "Chưa cập nhật được dấu trang. Vui lòng thử lại.");
}

export function BookmarkProvider({ children, initialItems }: { children: ReactNode; initialItems?: Bookmark[] | null }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<LoadResult | null>(() => initialItems === undefined ? null
    : initialItems === null ? { items: null, error: "Chưa tải được dấu trang." } : { items: initialItems });
  const active = useRef(new Set<string>());
  const mutationVersion = useRef(0);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [undo, setUndo] = useState<Undo | null>(null);
  const [undoFocused, setUndoFocused] = useState(false);
  const saved = useMemo(() => new Set(result?.items?.map(bookmarkKey)), [result]);

  useEffect(() => {
    if (attempt === 0 && initialItems === null) return;
    const controller = new AbortController();
    const version = mutationVersion.current;
    void requestBookmarks("", "GET", { signal: controller.signal })
      .then(response => response.json() as Promise<Bookmark[]>)
      .then(items => {
        if (!Array.isArray(items)) throw new Error("Chưa tải được dấu trang.");
        if (!controller.signal.aborted && !active.current.size && version === mutationVersion.current) setResult({ items });
      }).catch(reason => {
        if (!controller.signal.aborted) setResult(previous => previous?.items ? previous
          : { items: null, error: reason instanceof Error ? reason.message : "Chưa tải được dấu trang." });
      });
    return () => controller.abort();
  }, [attempt, initialItems]);

  useEffect(() => {
    if (!undo || undo.restoring || undo.error || undoFocused) return;
    const timer = window.setTimeout(() => setUndo(current => current === undo ? null : current), 8000);
    return () => window.clearTimeout(timer);
  }, [undo, undoFocused]);

  function reload() {
    if (active.current.size) return;
    setResult(null);
    setAttempt(value => value + 1);
  }

  async function mutate(target: BookmarkKey, method: Mutation, note?: string | null) {
    const key = bookmarkKey(target);
    if (active.current.has(key)) throw new Error("Đang cập nhật dấu trang này. Vui lòng thử lại.");
    mutationVersion.current++;
    active.current.add(key);
    setPending(new Set(active.current));
    try {
      const response = await requestBookmarks("/" + key, method, { note });
      const item: Bookmark | null = method === "PUT" ? await response.json() : null;
      setResult(previous => previous?.items ? {
        items: method === "PATCH" ? previous.items.map(current => bookmarkKey(current) === key ? { ...current, note } : current) : [
          ...(item ? [item] : []),
          ...previous.items.filter(current => bookmarkKey(current) !== key),
        ],
      } : previous);
    } finally {
      active.current.delete(key);
      setPending(new Set(active.current));
    }
  }

  function offerUndo(key: string, title: string, restore: () => Promise<void>) {
    setUndoFocused(false);
    setUndo({ key, title, restore });
  }

  async function update(target: BookmarkKey, save: boolean, title: string) {
    if (!result?.items) return;
    const key = bookmarkKey(target);
    const removed = save ? undefined : result.items.find(item => bookmarkKey(item) === key);
    await mutate(target, save ? "PUT" : "DELETE");
    if (save) setUndo(current => current?.key === key ? null : current);
    if (removed?.target) offerUndo(key, title, () => mutate(target, "PUT", removed.note ?? null));
  }

  async function restoreBookmark() {
    if (!undo || undo.restoring) return;
    const working = { ...undo, restoring: true, error: undefined };
    setUndo(working);
    try {
      await undo.restore();
      setUndo(current => current === working ? null : current);
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : "Chưa khôi phục được dấu trang. Vui lòng thử lại.";
      setUndo(current => current === working ? { ...undo, error } : current);
    }
  }

  return <Context.Provider value={{ result, saved, pending, reload, update, saveNote: (key, note) => mutate(key, "PATCH", note), offerUndo }}>
    {children}
    {undo && <div className={styles.undoNotice} onFocus={() => setUndoFocused(true)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setUndoFocused(false); }}>
      <p role="status">Đã bỏ lưu <strong>{undo.title}</strong></p>
      <button type="button" disabled={undo.restoring} onClick={() => void restoreBookmark()}>{undo.restoring ? "Đang khôi phục…" : "Hoàn tác"}</button>
      <button type="button" disabled={undo.restoring} aria-label="Đóng thông báo" onClick={() => setUndo(null)}><Icon name="close" /></button>
      {undo.error && <p role="alert" className={styles.undoError}>{undo.error}</p>}
    </div>}
  </Context.Provider>;
}

export function useBookmarks() {
  return useContext(Context);
}
