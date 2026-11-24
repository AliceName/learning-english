"use client";

import { useState } from "react";
import Icon from "@/components/site-icon";
import { bookmarkKey, type BookmarkKey } from "@/lib/bookmarks";
import { useBookmarks } from "./bookmark-provider";
import styles from "./bookmark-button.module.css";

export default function BookmarkButton({ targetType, targetId, title, remove = false, disabled = false }: BookmarkKey & {
  title: string;
  remove?: boolean;
  disabled?: boolean;
}) {
  const store = useBookmarks();
  const [error, setError] = useState("");
  if (!store) return null;

  const target = { targetType, targetId };
  const key = bookmarkKey(target);
  const saved = store.saved.has(key);
  const busy = store.pending.has(key);
  const failed = Boolean(store.result?.error);

  function onClick() {
    setError("");
    if (store?.result?.error) store.reload();
    else void store?.update(target, !remove && !saved, title).catch(reason =>
      setError(reason instanceof Error ? reason.message : "Chưa cập nhật được dấu trang."));
  }

  return <span className={styles.control}>
    <button type="button" className={styles.button} data-remove={remove || undefined}
      disabled={disabled || !store.result || busy} aria-busy={busy || undefined}
      aria-label={failed ? "Tải lại dấu trang" : remove ? "Bỏ lưu " + title : "Dấu trang cho " + title}
      aria-pressed={remove || failed ? undefined : saved} onClick={onClick}>
      <Icon name={remove ? "trash" : "bookmark"} />
      {failed ? "Tải lại dấu trang" : busy ? "Đang xử lý…" : remove ? "Bỏ lưu" : saved ? "Đã đánh dấu" : "Đánh dấu"}
    </button>
    {error && <small role="alert" className={styles.error}>{error}</small>}
  </span>;
}
