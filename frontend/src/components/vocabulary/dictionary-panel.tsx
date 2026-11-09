"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { DictionaryDirection, VocabularyResponse } from "@/lib/vocabulary";
import DictionaryResults from "./dictionary-results";
import styles from "./dictionary.module.css";

type Auth = { opening: number; state: "authenticated" | "anonymous" | "unavailable"; userId?: number };

function DictionaryIcon({ kind }: { kind: "book" | "swap" | "search" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "search" ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>
      : kind === "swap" ? <><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" /></>
        : <><path d="M12 5v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2Z" /></>}
  </svg>;
}

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
  const [direction, setDirection] = useState<DictionaryDirection>("en-en");
  const [result, setResult] = useState<VocabularyResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
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
      const response = await fetch(`/api/vocabulary?${new URLSearchParams({ word: word.trim(), direction })}`, {
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

  function changeDirection(next: DictionaryDirection) {
    if (next === direction) return;
    requestId.current++; lookup.current?.abort();
    dialog.current?.querySelectorAll("audio").forEach(audio => audio.pause());
    setDirection(next); setResult(null); setError(""); setPending(false);
    input.current?.focus();
  }

  return <dialog ref={dialog} id="dictionary-panel" className={`${styles.panel}${expanded ? ` ${styles.panelExpanded}` : ""}`} aria-labelledby="dictionary-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { if (event.key === "Escape" && !dialog.current?.matches(":modal")) { event.preventDefault(); event.stopPropagation(); onClose(); } }}
    onClick={event => { if (event.target === dialog.current) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <header className={styles.panelHeader}>
      <span className={styles.panelMark} aria-hidden="true">Aa</span><h2 id="dictionary-title">Tra từ điển</h2>
      <Image src="/illustrations/speaking-dialog-cat.webp" width={640} height={440} alt="" className={styles.headerCat} />
      <button type="button" className={`${styles.close} ${styles.expand}`} aria-label={expanded ? "Thu nhỏ từ điển" : "Phóng to từ điển"}
        title={expanded ? "Thu nhỏ" : "Phóng to"} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {expanded ? <><path d="M8 8H3v13h13v-5" /><rect x="8" y="3" width="13" height="13" rx="1" /></>
            : <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /><path d="m8 8-5-5m13 5 5-5M8 16l-5 5m13-5 5 5" /></>}
        </svg>
      </button>
      <button type="button" className={styles.close} aria-label="Đóng từ điển" onClick={onClose}>×</button>
    </header>
    {authenticated && <div className={styles.toolbar}>
      <div className={styles.directionTabs} role="group" aria-label="Hướng tra từ điển">
        {([ ["en-en", "Anh – Anh"], ["en-vi", "Anh – Việt"], ["vi-en", "Việt – Anh"] ] as const).map(([value, label]) =>
          <button key={value} type="button" aria-pressed={direction === value} onClick={() => changeDirection(value)}>
            <DictionaryIcon kind={value === "en-en" ? "book" : "swap"} />{label}
          </button>)}
      </div>
      <form onSubmit={submit} className={styles.searchForm}>
        <label htmlFor="dictionary-word">Bạn muốn tra từ nào?</label>
        <div className={styles.searchRow}>
          <div className={styles.inputWrap}><DictionaryIcon kind="search" /><input ref={input} id="dictionary-word" value={word}
            onChange={event => setWord(event.target.value)} maxLength={100} placeholder="Nhập từ cần tra…"
            autoComplete="off" autoCapitalize="none" spellCheck={false} required /></div>
          <button type="submit" disabled={!word.trim()} aria-label="Tra cứu từ">Tra</button>
        </div>
      </form>
    </div>}
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
          <div className={styles.resultArea} aria-busy={pending}>
            {pending ? <div className={styles.empty} role="status"><span className={styles.spinner} /><p>Đang tìm nghĩa cho bạn…</p></div>
              : error ? <div className={styles.notice} role="alert"><strong>Chưa thể hiển thị kết quả</strong><p>{error}</p><small>Bạn có thể sửa từ hoặc nhấn Tra từ để thử lại.</small></div>
              : result ? <><p className={styles.resultAnnouncement} role="status">Đã tìm thấy “{result.word}”.</p><DictionaryResults key={`${direction}:${result.word}`} result={result} active={open && authenticated} onUnauthorized={audioUnauthorized} /></>
              : <div className={`${styles.empty} ${styles.welcome}`}>
                <Image src="/illustrations/speaking-reading-cat.webp" width={640} height={440} alt="" className={styles.readingCat} />
                <h3>Tra một từ mới nhé!</h3><p>Nhập từ và chọn hướng tra để xem<br />định nghĩa, phiên âm, ví dụ,…</p>
              </div>}
          </div>
        </>}
    </div>
    <footer className={styles.panelFooter} aria-hidden="true">
      <svg viewBox="0 0 190 40" fill="none"><path d="M3 31c25-17 32 9 57-4s21-26 40-17-8 27 21 17l34-15" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 5" strokeLinecap="round" /><path d="m151 10 30-8-13 29-5-15-12-6Zm12 6 18-14" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
    </footer>
  </dialog>;
}
