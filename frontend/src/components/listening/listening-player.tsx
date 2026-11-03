"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Icon from "@/components/site-icon";
import { audioTime } from "@/lib/listening";
import styles from "./listening.module.css";

export default function ListeningPlayer({ url, title, enabled, position, seek, onPosition, onListened, onDuration, transcriptControls, children }: {
  url: string; title: string; enabled: boolean; position: number; seek: { seconds: number; nonce: number } | null;
  onPosition: (seconds: number) => void; onListened: () => void; onDuration: (seconds: number) => void; transcriptControls: ReactNode; children: ReactNode;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0), [current, setCurrent] = useState(0);
  const [ready, setReady] = useState(false), [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1), [volume, setVolume] = useState(1), [error, setError] = useState("");
  const initialPosition = useRef(position), lastSaved = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    const node = audio.current;
    mounted.current = true;
    const otherStarted = (event: Event) => { if (event.target !== node && event.target instanceof HTMLMediaElement) node?.pause(); };
    document.addEventListener("play", otherStarted, true);
    return () => { mounted.current = false; document.removeEventListener("play", otherStarted, true); node?.pause(); };
  }, []);
  useEffect(() => { if (!enabled) audio.current?.pause(); }, [enabled]);
  useEffect(() => {
    const node = audio.current;
    if (!node || !seek || !enabled || !Number.isFinite(node.duration) || seek.seconds > node.duration) return;
    node.currentTime = Math.max(0, seek.seconds);
    void node.play().catch(() => { if (mounted.current) setError("Chưa phát được audio. Hãy bấm Phát để thử lại."); });
  }, [seek, enabled]);

  function jump(seconds: number) { const node = audio.current; if (node) node.currentTime = Math.max(0, Math.min(duration, seconds)); }
  function save(seconds: number, force = false) {
    if (mounted.current && enabled && (force || Math.abs(seconds - lastSaved.current) >= 10)) { lastSaved.current = seconds; onPosition(seconds); }
  }
  return <section className={styles.card} aria-label="Trình phát bài nghe">
    <div className={styles.playerHeading}>
      <p className={styles.audioTitle}><span className={styles.liveDot} /><strong>Audio bài nghe:</strong> <span>{title}</span></p>
      <div className={styles.playerTools}>
        {transcriptControls}
        <div className={styles.speedGroup} aria-label="Tốc độ phát">{[0.75, 1, 1.25, 1.5].map(value => <button key={value} type="button" aria-label={`Tốc độ ${value}x`} aria-pressed={speed === value}
          onClick={() => { setSpeed(value); if (audio.current) audio.current.playbackRate = value; }}>{value}x</button>)}</div>
        <label className={styles.volume}><Icon name="volume" /><input type="range" min="0" max="1" step="0.05" value={volume} aria-label="Âm lượng"
          onChange={event => { const value = Number(event.target.value); setVolume(value); if (audio.current) audio.current.volume = value; }} /></label>
      </div>
    </div>
    <audio ref={audio} src={url} preload="metadata" aria-label="Audio bài nghe" onLoadedMetadata={event => {
      const node = event.currentTarget;
      if (Number.isFinite(node.duration)) { setDuration(node.duration); onDuration(node.duration); node.currentTime = Math.min(initialPosition.current, Math.max(0, node.duration - 0.1)); }
    }} onCanPlay={() => { setReady(true); setError(""); }} onTimeUpdate={event => { const value = event.currentTarget.currentTime; setCurrent(value); save(value); }}
      onPlay={event => {
        document.querySelectorAll<HTMLMediaElement>("audio,video").forEach(other => { if (other !== event.currentTarget) other.pause(); });
        setPlaying(true);
      }} onPause={event => { if (mounted.current) { setPlaying(false); save(event.currentTarget.currentTime, true); } }}
      onEnded={event => { setPlaying(false); onListened(); save(event.currentTarget.currentTime, true); }}
      onError={() => { setReady(false); setPlaying(false); setError("Chưa tải được audio. Kiểm tra kết nối và thử lại."); }} />
    <div className={styles.timeline}><input type="range" min="0" max={duration || 1} step="0.1" value={Math.min(current, duration || 1)} disabled={!enabled || !ready} aria-label="Vị trí phát"
      onChange={event => jump(Number(event.target.value))} /><div><strong>{audioTime(current)}</strong><span>{audioTime(duration)}</span></div></div>
    <div className={styles.playback}>
      <button type="button" disabled={!enabled || !ready} aria-label="Tua lùi 5 giây" onClick={() => jump(current - 5)}><Icon name="replay" /><span>5s</span></button>
      <button type="button" className={styles.playButton} disabled={!enabled || !ready} aria-label={playing ? "Tạm dừng audio" : "Phát audio"} onClick={() => {
        const node = audio.current; if (!node) return;
        if (playing) node.pause(); else void node.play().catch(() => setError("Trình duyệt chưa phát được audio. Vui lòng thử lại."));
      }}><Icon name={playing ? "pause" : "play"} /></button>
      <button type="button" disabled={!enabled || !ready} aria-label="Tua tới 5 giây" onClick={() => jump(current + 5)}><span>5s</span><Icon name="arrow" /></button>
    </div>
    {!enabled && <p className={styles.hint}>Bấm Bắt đầu để nghe audio và làm bài tập.</p>}
    {enabled && !ready && !error && <p className={styles.hint} role="status">Đang chuẩn bị audio…</p>}
    {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => { setError(""); audio.current?.load(); }}>Thử lại audio</button></div>}
    {children}
  </section>;
}
