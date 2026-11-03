"use client";

import { useEffect, useId, useRef, useState } from "react";
import Icon from "@/components/site-icon";
import type { PracticeResult, PracticeSentence } from "@/lib/free-speaking-history";
import { PcmRecorder, type RecordingStopReason } from "@/lib/pcm-recorder";
import { feedbackMode } from "@/lib/pronunciation-feedback";
import type { SpeakingAssessment, SpeakingWord } from "@/lib/speaking";
import { microphoneError, wordAudioRange } from "@/lib/speaking-practice";
import PronunciationFeedback from "./pronunciation-feedback";
import styles from "./free-speaking.module.css";

const maxSeconds = 12;
const maxBytes = 2 * 1024 * 1024;
type Phase = "idle" | "creating" | "starting" | "recording" | "encoding" | "scoring";

export function playSample(text: string, reportError: (message: string) => void) {
  if (!("speechSynthesis" in window)) { reportError("Trình duyệt chưa hỗ trợ giọng mẫu."); return; }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = .85;
  utterance.onerror = event => {
    if (event.error !== "canceled" && event.error !== "interrupted") reportError("Chưa phát được giọng mẫu. Vui lòng thử lại.");
  };
  window.speechSynthesis.speak(utterance);
}

export default function FreeSpeakingDialog({ initialSentence, showResult, onCreate, onScore, onClose }: {
  initialSentence?: PracticeSentence;
  showResult?: boolean;
  onCreate: (text: string) => PracticeSentence | Promise<PracticeSentence>;
  onScore: (sentence: PracticeSentence, result: PracticeResult) => Promise<PracticeSentence>;
  onClose: () => void;
}) {
  const [sentence, setSentence] = useState(initialSentence);
  const [text, setText] = useState("");
  const [showingResult, setShowingResult] = useState(!!showResult);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [clip, setClip] = useState<Blob | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(initialSentence?.result);
  const modal = useRef<HTMLDialogElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const recorder = useRef<PcmRecorder | null>(null);
  const recordingRequest = useRef<AbortController | null>(null);
  const scoreRequest = useRef<AbortController | null>(null);
  const endOfWord = useRef<number | null>(null);
  const mounted = useRef(false);
  const titleId = useId();
  const textId = useId();
  const hintId = useId();
  const recording = showingResult ? result?.recording : clip;
  const busy = phase !== "idle";

  useEffect(() => {
    mounted.current = true;
    modal.current?.showModal();
    return () => {
      mounted.current = false;
      recordingRequest.current?.abort();
      recorder.current?.dispose();
      scoreRequest.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    const player = audio.current;
    if (!recording || !player) return;
    const url = URL.createObjectURL(recording);
    player.src = url;
    return () => {
      player.pause();
      player.removeAttribute("src");
      URL.revokeObjectURL(url);
      endOfWord.current = null;
    };
  }, [recording, showingResult]);

  useEffect(() => {
    if (!sentence) return;
    heading.current?.focus();
  }, [sentence, showingResult]);

  function stopPlayback() {
    window.speechSynthesis?.cancel();
    audio.current?.pause();
    endOfWord.current = null;
  }

  async function createSentence(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const input = text.trim().replace(/\s+/g, " ");
    if (!input || !/^[A-Za-z '’.,!?;:()"\-]+$/.test(input)) {
      setError("Nhập câu tiếng Anh và viết số thành chữ.");
      return;
    }
    const wordCount = input.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)?.length ?? 0;
    if (wordCount < 1 || wordCount > 35) {
      setError("Câu luyện nói cần có từ 1 đến 35 từ.");
      return;
    }
    setPhase("creating"); setError("");
    const saved = await onCreate(input);
    if (!mounted.current) return;
    setSentence(saved);
    setResult(saved.result);
    setPhase("idle");
  }

  async function finish(reason?: RecordingStopReason) {
    const active = recorder.current;
    if (!active) return;
    recorder.current = null;
    setPhase("encoding"); setLevel(0);
    try {
      const blob = await active.finish();
      if (!mounted.current) return;
      setClip(blob);
      setMessage(reason === "limit" ? "Đã đủ 12 giây. Hãy nghe lại để kiểm tra bạn đã đọc trọn câu." : "Bản ghi đã sẵn sàng để chấm.");
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : "Chưa tạo được bản ghi. Vui lòng thử lại.");
    } finally { if (mounted.current) setPhase("idle"); }
  }

  async function start() {
    if (busy || recordingRequest.current) return;
    stopPlayback();
    setPhase("starting"); setError(""); setMessage(""); setElapsed(0);
    const controller = new AbortController();
    recordingRequest.current = controller;
    try {
      const active = await PcmRecorder.start(maxSeconds, (seconds, volume) => {
        if (!controller.signal.aborted) { setElapsed(seconds); setLevel(volume); }
      }, reason => { void finish(reason); }, { signal: controller.signal });
      if (controller.signal.aborted) { active.dispose(); return; }
      recorder.current = active; setPhase("recording");
    } catch (error) {
      if (!controller.signal.aborted) { setError(microphoneError(error)); setPhase("idle"); }
    } finally {
      if (recordingRequest.current === controller) recordingRequest.current = null;
    }
  }

  function upload(file?: File) {
    if (!file || busy) return;
    if (!file.name.toLowerCase().endsWith(".wav") || file.size < 44 || file.size > maxBytes) {
      setError("Chọn tệp WAV tối đa 2 MB và dài từ 0,3 đến 12 giây.");
      return;
    }
    stopPlayback(); setError(""); setMessage("Tệp đã sẵn sàng để chấm.");
    setClip(file);
  }

  async function score() {
    if (!sentence || !clip || busy || scoreRequest.current) return;
    stopPlayback();
    setError(""); setMessage(""); setPhase("scoring");
    const controller = new AbortController();
    scoreRequest.current = controller;
    try {
      const body = new FormData();
      body.append("text", sentence.text);
      body.append("file", clip, "recording.wav");
      const response = await fetch("/api/speaking/free/score", { method: "POST", body, signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." :
        data?.title || "Chưa chấm được bản ghi. Hãy thử lại.");
      const next = { assessment: data as SpeakingAssessment, recording: clip };
      const saved = await onScore(sentence, next);
      if (!controller.signal.aborted) {
        setSentence(saved); setResult(next); setShowingResult(true); setClip(null);
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Chưa gửi được bản ghi. Hãy thử lại.");
    } finally {
      scoreRequest.current = null;
      if (!controller.signal.aborted) setPhase("idle");
    }
  }

  async function playWord(word: SpeakingWord) {
    if (!result || !audio.current) return;
    const range = wordAudioRange(word, result.assessment.durationSeconds);
    if (!range) return;
    const player = audio.current;
    stopPlayback();
    try {
      player.currentTime = range.start;
      endOfWord.current = range.end;
      await player.play();
    } catch {
      endOfWord.current = null;
      setError("Chưa phát được đoạn ghi âm này.");
    }
  }

  function retry() {
    stopPlayback(); setError(""); setMessage(""); setElapsed(0); setShowingResult(false);
  }

  return <dialog ref={modal} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
    <div className={styles.dialogInner}>
      <div className={styles.dialogHeader}>
        <div><span>LUYỆN NÓI TỰ DO</span><h2 id={titleId} ref={heading} tabIndex={-1}>
          {!sentence ? "Tạo câu luyện nói" : showingResult ? "Kết quả phát âm" : "Đọc cả câu"}
        </h2></div>
        <button type="button" className={styles.close} aria-label="Đóng" onClick={() => modal.current?.close()}><Icon name="close" /></button>
      </div>
      {!sentence ? <form className={styles.editor} onSubmit={event => void createSentence(event)}>
        <label htmlFor={textId}>Câu tiếng Anh bạn muốn luyện</label>
        <textarea id={textId} lang="en" autoFocus required rows={3} maxLength={300} placeholder="I read a book yesterday."
          value={text} aria-describedby={hintId} disabled={busy} onChange={event => { setText(event.target.value); setError(""); }} />
        <p id={hintId}>Tối đa 35 từ và 300 ký tự. Viết số thành chữ. <span>{text.length}/300</span></p>
        <button className={styles.primary} disabled={busy}><Icon name="mic" /> {busy ? "Đang tạo câu…" : "Tạo câu và bắt đầu luyện"}</button>
      </form> : <>
        <div className={styles.prompt}>
          <button type="button" className={styles.secondary} aria-label="Nghe câu mẫu" title="Nghe câu mẫu" disabled={busy}
            onClick={() => { stopPlayback(); setError(""); playSample(sentence.text, setError); }}><Icon name="volume" /></button>
          <p lang="en">{sentence.text}</p>
        </div>
        {showingResult && result ? <>
          <div className={styles.resultSummary}>
            <div><small>Điểm phát âm</small><strong>{feedbackMode(result.assessment) === "record_again" ? "Cần ghi lại" :
              <>{result.assessment.overallScore.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}<small>/100</small></>}</strong></div>
            <div><small>Độ phủ âm đã chấm</small><strong>{Math.round(result.assessment.coverage * 100)}%</strong></div>
            <div><small>Thời lượng</small><strong>{result.assessment.durationSeconds.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}<small> giây</small></strong></div>
          </div>
          <p className={styles.modelFeedback}>{result.assessment.feedback}</p>
          <audio ref={audio} controls preload="metadata" aria-label="Nghe lại bản ghi đã chấm" onPlay={() => window.speechSynthesis?.cancel()}
            onTimeUpdate={event => {
              if (endOfWord.current !== null && event.currentTarget.currentTime >= endOfWord.current) {
                event.currentTarget.pause(); endOfWord.current = null;
              }
            }} onEnded={() => { endOfWord.current = null; }} />
          <PronunciationFeedback attempt={{ attemptId: titleId, assessment: result.assessment, referenceText: sentence.text }}
            disabled={false} canRetry rate={.85} onBeforePlay={stopPlayback} onListenRecording={word => void playWord(word)} onRetry={retry} />
        </> : <div className={styles.recorder}>
          <div className={styles.recorderHeader}><span><Icon name="mic" /> Phòng thu âm</span><span>{Math.floor(elapsed)} / {maxSeconds} giây</span></div>
          <div className={styles.waveform} aria-hidden="true">
            {[.25, .44, .65, .36, .75, .95, .61, 1, .68, .89, .58, .76, .47, .36, .61, .29, .22].map((bar, index) =>
              <i key={index} style={{ height: `${6 + bar * (phase === "recording" ? 18 + 30 * level : 16)}px` }} />)}
          </div>
          <button type="button" className={styles.recordButton} data-recording={phase === "recording"} disabled={busy && phase !== "recording"}
            aria-label={phase === "recording" ? "Dừng ghi âm" : "Bắt đầu ghi âm"}
            onClick={() => phase === "recording" ? void finish() : void start()}><Icon name={phase === "recording" ? "pause" : "mic"} /></button>
          <p className={styles.recorderHint} role="status">{phase === "starting" ? "Đang mở microphone…" : phase === "recording" ? "Đang ghi âm. Bấm dừng khi đọc xong." :
            phase === "encoding" ? "Đang xử lý bản ghi…" : phase === "scoring" ? "AI đang chấm điểm phát âm…" : "Bấm microphone và đọc trọn câu trong một lần."}</p>
          <label className={styles.upload}><Icon name="upload" /> Chọn tệp WAV<input type="file" accept=".wav,audio/wav" disabled={busy} onChange={event => {
            upload(event.target.files?.[0]); event.currentTarget.value = "";
          }} /></label>
          {clip && <audio ref={audio} controls preload="metadata" aria-label="Nghe thử bản ghi" onPlay={() => window.speechSynthesis?.cancel()} />}
          <button type="button" className={styles.primary} disabled={busy || !clip} onClick={() => void score()}><Icon name="sparkles" />
            {phase === "scoring" ? "Đang chấm điểm…" : "Chấm điểm phát âm bằng AI"}
          </button>
        </div>}
      </>}
      {message && <p className={styles.dialogMessage} role="status">{message}</p>}
      {error && <p className={styles.dialogError} role="alert">{error}</p>}
    </div>
  </dialog>;
}
