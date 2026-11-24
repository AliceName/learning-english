"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./writing.module.css";

const symbols = { info: "i", help: "?", warn: "!" } as const;

/**
 * A small round button that shows a short note on hover, keyboard focus or tap.
 * Used for caveats and how-to text that should not crowd the page.
 * The content must be phrasing content (text, <b>, <span>…), since it sits inside a <span>.
 */
export function InfoTip({ label, kind = "info", children }: { label: string; kind?: keyof typeof symbols; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const id = useId();
  // Fixed position from the icon, clamped to the viewport, so the bubble never widens the page.
  useLayoutEffect(() => {
    if (!open || !button.current || !bubble.current) { setPosition(null); return; }
    const anchor = button.current.getBoundingClientRect(), width = bubble.current.offsetWidth;
    const viewport = document.documentElement.clientWidth, margin = 12;
    const left = Math.min(Math.max(anchor.left + anchor.width / 2 - width / 2, margin), viewport - width - margin);
    setPosition({ left: Math.max(margin, left), top: anchor.bottom + 6 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, { capture: true }); window.removeEventListener("resize", close); };
  }, [open]);
  return <span className={styles.tip} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button ref={button} type="button" className={`${styles.tipButton} ${styles[`tip_${kind}`]}`} aria-label={label}
      aria-expanded={open} aria-describedby={open ? id : undefined}
      onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>{symbols[kind]}</button>
    {open && <span ref={bubble} role="tooltip" id={id} className={styles.tipBubble}
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden", left: 0, top: 0 }}>{children}</span>}
  </span>;
}
