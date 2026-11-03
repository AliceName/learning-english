"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isDictionaryVisible } from "@/lib/dictionary-visibility";
import { mascotSprites } from "@/lib/mascot-sprites";
import { SESSION_CHANGED } from "@/lib/session-events";
import styles from "./dictionary.module.css";

const DictionaryPanel = dynamic(() => import("./dictionary-panel"), { ssr: false });

export default function DictionaryWidgetHost() {
  const pathname = usePathname();
  const allowed = isDictionaryVisible(pathname);
  const [openAt, setOpenAt] = useState<string | null>(null);
  const [opening, setOpening] = useState(0);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [observedPath, setObservedPath] = useState(pathname);
  const launcher = useRef<HTMLButtonElement>(null);
  // Reset during the route render, including browser Back; a previous route must not reopen the panel.
  if (observedPath !== pathname) { setObservedPath(pathname); setOpenAt(null); }
  const open = allowed && openAt === pathname;

  useEffect(() => {
    const reset = () => { setOpenAt(null); setSessionVersion(version => version + 1); };
    window.addEventListener(SESSION_CHANGED, reset);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SESSION_CHANGED);
    channel?.addEventListener("message", reset);
    return () => { window.removeEventListener(SESSION_CHANGED, reset); channel?.close(); };
  }, []);

  const close = () => { setOpenAt(null); requestAnimationFrame(() => launcher.current?.focus()); };
  const sprite = mascotSprites[open ? "happy" : "idle"];

  return <>
    {allowed && <div className={styles.launcherWrap}>
      <span className={styles.launcherLabel} aria-hidden="true">Tra từ điển</span>
      <button ref={launcher} type="button" className={styles.launcher} aria-label={open ? "Thu gọn từ điển" : "Mở từ điển"}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={opening ? "dictionary-panel" : undefined}
        onClick={() => { if (open) close(); else { setOpening(value => value + 1); setOpenAt(pathname); } }}>
        {imageFailed ? <span className={styles.fallback} aria-hidden="true">Aa</span>
          : <span className={styles.mascot} aria-hidden="true" style={{ backgroundImage: `url(${sprite.image})`, backgroundPosition: sprite.position }} />}
        <span className={styles.launcherBadge} aria-hidden="true">{open ? "−" : "⌕"}</span>
      </button>
      {/* An invisible preload detects missing sprite files without displaying the entire sheet. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {!imageFailed && <img src={sprite.image} alt="" className={styles.assetProbe}
        ref={node => { if (node?.complete && node.naturalWidth === 0) setImageFailed(true); }}
        onError={() => setImageFailed(true)} />}
    </div>}
    {opening > 0 && <DictionaryPanel key={sessionVersion} open={open} opening={opening} onClose={close} />}
  </>;
}
