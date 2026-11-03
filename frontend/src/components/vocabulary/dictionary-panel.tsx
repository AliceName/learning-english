"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { VocabularyResponse } from "@/lib/vocabulary";
import DictionaryResults from "./dictionary-results";
import styles from "./dictionary.module.css";

type Auth = { opening: number; state: "authenticated" | "anonymous" | "unavailable"; userId?: number };

export default function DictionaryPanel({ open, opening, onClose }: { open: boolean; opening: number; onClose: () => void }) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lookup = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const owner = useRef<number | undefined>(undefined);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [word, setWord] = useState("");
  const [result, setResult] = useState<VocabularyResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const authenticated = auth?.opening === opening && auth.state === "authenticated";
  const checking = !auth || auth.opening !== opening;
  const audioUnauthorized = useCallback(() => {
    setAuth({ opening, state: "anonymous" }); owner.current = undefined;
    setResult(null); setWord("");
  }, [opening]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const media = window.matchMedia("(max-width: 600px)");
    const previousOverflow = document.body.style.overflow;
    const sync = () => {
      if (node.open) node.close();
      document.body.style.overflow = previousOverflow;
      if (open) {
        if (media.matches) { node.showModal(); document.body.style.overflow = "hidden"; }
        else node.show();
      }
    };
    sync();
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
      if (node.open) node.close();
      document.body.style.overflow = previousOverflow;
      node.querySelectorAll("audio").forEach(audio => audio.pause());
      lookup.current?.abort();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => {
        if (controller.signal.aborted) return;
        if (response.ok) {
          const user = await response.json();
          if (controller.signal.aborted) return;
          if (owner.current !== user.userId) { setResult(null); setWord(""); setError(""); }
          owner.current = user.userId;
          setAuth({ opening, state: "authenticated", userId: user.userId });
        } else {
          setResult(null); owner.current = undefined;
          setAuth({ opening, state: response.status === 401 ? "anonymous" : "unavailable" });
        }
      }).catch(() => { if (!controller.signal.aborted) setAuth({ opening, state: "unavailable" }); });
    return () => controller.abort();
  }, [open, opening, authAttempt]);

  useEffect(() => { if (open && authenticated) input.current?.focus(); }, [open, authenticated]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authenticated || !word.trim()) return;
    dialog.current?.querySelectorAll("audio").forEach(audio => audio.pause());
    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    const id = ++requestId.current;
    setPending(true); setError(""); setResult(null);
    try {
      const response = await fetch(`/api/vocabulary?${new URLSearchParams({ word: word.trim() })}`, {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      const body = await response.json().catch(() => null);
      if (id !== requestId.current || controller.signal.aborted) return;
      if (response.status === 401) { setAuth({ opening, state: "anonymous" }); owner.current = undefined; setWord(""); return; }
      if (!response.ok) { setError(body?.title ?? "Chưa thể tra từ. Vui lòng thử lại."); return; }
      if (!Array.isArray(body?.entries) || !body.entries.length) throw new Error("Invalid dictionary response");
      setResult(body as VocabularyResponse);
    } catch {
      if (!controller.signal.aborted && id === requestId.current) setError("Kết nối bị gián đoạn hoặc quá thời gian chờ. Vui lòng thử lại.");
    } finally { if (id === requestId.current) setPending(false); }
  }

  return <dialog ref={dialog} id="dictionary-panel" className={styles.panel} aria-labelledby="dictionary-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { if (event.key === "Escape" && !dialog.current?.matches(":modal")) { event.preventDefault(); event.stopPropagation(); onClose(); } }}
    onClick={event => { if (event.target === dialog.current) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <header className={styles.panelHeader}>
      <span className={styles.panelMark} aria-hidden="true">Aa</span><div><h2 id="dictionary-title">Tra từ điển</h2><p>Một từ mới, một bước tiến</p></div>
      <button type="button" className={styles.close} aria-label="Đóng từ điển" onClick={onClose}>×</button>
    </header>
    <div className={styles.panelBody}>
      {checking ? <div className={styles.empty} role="status"><span className={styles.spinner} />Đang kiểm tra phiên đăng nhập…</div>
        : !authenticated ? <div className={styles.empty}>
          <span className={styles.emptyMark} aria-hidden="true">Aa</span>
          <h3>{auth.state === "anonymous" ? "Từ mới luôn ở ngay bên bạn" : "Chưa kết nối được tài khoản"}</h3>
          <p>{auth.state === "anonymous" ? "Đăng nhập để tra nghĩa, phiên âm và ví dụ ngay trong lúc học." : "Hãy thử lại sau một lát để tiếp tục tra từ."}</p>
          {auth.state === "anonymous" ? pathname === "/login" ? <button className={styles.primary} onClick={() => { onClose(); document.getElementById("email")?.focus(); }}>Đến ô đăng nhập</button>
            : <Link href="/login" onClick={onClose} className={styles.primary}>Đăng nhập để tra từ</Link>
            : <button className={styles.primary} onClick={() => setAuthAttempt(value => value + 1)}>Thử kết nối lại</button>}
        </div> : <>
          <form onSubmit={submit} className={styles.searchForm}>
            <label htmlFor="dictionary-word">Bạn muốn tra từ nào?</label>
            <div className={styles.searchRow}><input ref={input} id="dictionary-word" value={word} onChange={event => setWord(event.target.value)} maxLength={100}
              placeholder="Ví dụ: curious" autoComplete="off" autoCapitalize="none" spellCheck={false} required />
              <button type="submit" disabled={!word.trim()} aria-label="Tra cứu từ">Tra từ <span aria-hidden="true">↗</span></button></div>
            <p>Định nghĩa tiếng Anh · Phiên âm · Ví dụ</p>
          </form>
          <div className={styles.resultArea} aria-busy={pending}>
            {pending ? <div className={styles.empty} role="status"><span className={styles.spinner} /><p>Đang tìm nghĩa cho bạn…</p></div>
              : error ? <div className={styles.notice} role="alert"><strong>Chưa thể hiển thị kết quả</strong><p>{error}</p><small>Bạn có thể sửa từ hoặc nhấn Tra từ để thử lại.</small></div>
              : result ? <><p className={styles.resultAnnouncement} role="status">Đã tìm thấy “{result.word}”.</p><DictionaryResults key={result.word} result={result} active={open && authenticated} onUnauthorized={audioUnauthorized} /></>
              : <div className={styles.empty}><span className={styles.emptyMark} aria-hidden="true">Aa</span><h3>Khám phá một từ mới</h3><p>Nhập một từ tiếng Anh phía trên.<br />Bạn có thể tiếp tục bài học khi đang tra từ.</p></div>}
          </div>
        </>}
    </div>
    <footer className={styles.panelFooter}>Đồng hành cùng bạn trong từng bài học</footer>
  </dialog>;
}
