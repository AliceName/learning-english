"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SpeakingAttempt, SpeakingLesson, SpeakingWord } from "@/lib/speaking";
import { PcmRecorder, type RecordingStopReason } from "@/lib/pcm-recorder";
import { allPracticeTargets, compareAttempts, completedPracticeTargets, getPracticeTarget, matchesPracticeTarget, mergeHistory, microphoneError, wordAudioRange, type SpeakingPracticeMode } from "@/lib/speaking-practice";
import PronunciationFeedback from "./pronunciation-feedback";
import { feedbackMode } from "@/lib/pronunciation-feedback";
import styles from "./speaking.module.css";

type Phase = "idle" | "starting" | "recording" | "encoding" | "submitting";
type Clip = { blob: Blob; url: string; submitted: boolean; name: string };
export default function SpeakingPractice({ lesson, initialHistory, historyUnavailable }: { lesson: SpeakingLesson; initialHistory: SpeakingAttempt[]; historyUnavailable: boolean }) {
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<SpeakingPracticeMode>(() => lesson.segments?.[0]?.length ? "segment" : "sentence");
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [stopOnSilence, setStopOnSilence] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [clips, setClips] = useState<Record<string, Clip>>({});
  const [result, setResult] = useState<SpeakingAttempt | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [sessionAttempts, setSessionAttempts] = useState<SpeakingAttempt[]>([]);
  const [historyError, setHistoryError] = useState(historyUnavailable ? "Chưa tải được lịch sử trước đó. Bạn vẫn có thể luyện câu mới." : "");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [audioNotice, setAudioNotice] = useState("");
  const [playingWord, setPlayingWord] = useState("");
  const [rate, setRate] = useState(.75);
  const recorder = useRef<PcmRecorder | null>(null);
  const recorderStartup = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const clipStore = useRef<Record<string, Clip>>({});
  const page = useRef<HTMLElement | null>(null);
  const resultHeading = useRef<HTMLHeadingElement | null>(null);
  const sampleAudio = useRef<HTMLAudioElement | null>(null);
  const wordAudio = useRef<HTMLAudioElement | null>(null);
  const segmentEnd = useRef<number | null>(null);
  const playbackGeneration = useRef(0);
  const sentence = lesson.sentences[index];
  const segments = lesson.segments?.[index] ?? [];
  const target = getPracticeTarget(lesson, index, mode === "segment" ? segmentIndex : null) ?? getPracticeTarget(lesson, index, null)!;
  const isSegment = target.segmentIndex !== null;
  const unit = isSegment ? "cụm" : "câu";
  const sampleUrl = isSegment ? null : sentence.audioUrl;
  const clip = clips[target.key];
  const busy = phase !== "idle";
  const targets = allPracticeTargets(lesson, mode);
  const completed = completedPracticeTargets(sessionAttempts, lesson, mode);
  const position = targets.findIndex(item => item.key === target.key);
  const following = targets[position + 1];
  const nextPending = [...targets.slice(position + 1), ...targets.slice(0, position + 1)].find(item => !completed.has(item.key));
  const resultMode = result ? feedbackMode(result.assessment) : "normal";
  const comparison = result ? compareAttempts(result, history) : null;
  const canRetry = !!result && matchesPracticeTarget(result, lesson, index, target.segmentIndex);
  const step = phase !== "idle" || clip && !clip.submitted ? 2 : result ? 3 : 1;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recorderStartup.current?.abort();
      recorder.current?.dispose();
      request.current?.abort();
      historyRequest.current?.abort();
      window.speechSynthesis?.cancel();
      for (const stored of Object.values(clipStore.current)) URL.revokeObjectURL(stored.url);
    };
  }, []);
  useEffect(() => {
    if (!result) return;
    const frame = requestAnimationFrame(() => resultHeading.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [result]);

  function stopPlayback(except?: HTMLAudioElement) {
    window.speechSynthesis?.cancel();
    for (const audio of page.current?.querySelectorAll("audio") ?? []) if (audio !== except) audio.pause();
    if (except !== wordAudio.current) { playbackGeneration.current++; segmentEnd.current = null; setPlayingWord(""); }
  }
  function saveClip(key: string, next: Clip | null) {
    const previous = clipStore.current[key];
    if (previous && previous.url !== next?.url) URL.revokeObjectURL(previous.url);
    const updated = { ...clipStore.current };
    if (next) updated[key] = next; else delete updated[key];
    clipStore.current = updated;
    setClips(updated);
  }
  async function finish(reason?: RecordingStopReason) {
    const active = recorder.current;
    if (!active) return;
    const version = generation.current;
    recorder.current = null;
    setPhase("encoding"); setLevel(0);
    try {
      const blob = await active.finish();
      if (mounted.current && version === generation.current) {
        saveClip(target.key, { blob, url: URL.createObjectURL(blob), submitted: false, name: `Bản ghi ${unit} · microphone` });
        setResult(null); setNotice(reason === "silence" ? "Đã tự dừng sau khoảng im lặng. Nghe lại để kiểm tra đã đọc đủ rồi gửi chấm." : reason === "limit" ? `Đã đạt giới hạn ${lesson.maxRecordingSeconds} giây. Nghe lại để kiểm tra đã đọc đủ rồi gửi chấm.` : "Bản ghi đã sẵn sàng. Nghe lại rồi gửi chấm điểm.");
      }
    } catch (e) {
      if (mounted.current && version === generation.current) setError(e instanceof Error ? e.message : "Chưa tạo được bản ghi. Vui lòng thử lại.");
    } finally { if (mounted.current && version === generation.current) setPhase("idle"); }
  }
  async function start() {
    if (busy) return;
    setError(""); setNotice(""); setAudioNotice(""); setSeconds(0); setPhase("starting");
    stopPlayback();
    const version = ++generation.current;
    const startup = new AbortController(); recorderStartup.current = startup;
    try {
      const active = await PcmRecorder.start(lesson.maxRecordingSeconds, (time, volume) => {
        if (mounted.current && version === generation.current) { setSeconds(time); setLevel(volume); }
      }, reason => { void finish(reason); }, { stopOnSilence, silenceSeconds: 1.5, signal: startup.signal });
      if (!mounted.current || version !== generation.current) { active.dispose(); return; }
      recorder.current = active; setPhase("recording");
    } catch (e) {
      if (mounted.current && version === generation.current) { setError(microphoneError(e)); setPhase("idle"); }
    } finally { if (recorderStartup.current === startup) recorderStartup.current = null; }
  }
  function cancelRecording() {
    generation.current++;
    recorderStartup.current?.abort(); recorderStartup.current = null;
    recorder.current?.dispose(); recorder.current = null;
    setPhase("idle"); setSeconds(0); setLevel(0);
    setNotice("Đã hủy lần ghi này. Bản ghi trước đó, nếu có, vẫn được giữ.");
  }
  function selectTarget(next: number, nextSegment: number | null, attempt?: SpeakingAttempt) {
    if (busy) return;
    const selected = getPracticeTarget(lesson, next, nextSegment) ?? getPracticeTarget(lesson, next, null);
    if (!selected) return;
    stopPlayback();
    setIndex(next); setSegmentIndex(selected.segmentIndex ?? 0); setMode(selected.segmentIndex === null ? "sentence" : "segment");
    setSeconds(0); setError(""); setNotice(""); setAudioNotice("");
    const draft = clipStore.current[selected.key];
    setResult(attempt ?? (draft && !draft.submitted ? null : mergeHistory(history).find(item => matchesPracticeTarget(item, lesson, next, selected.segmentIndex))) ?? null);
  }
  function selectSentence(next: number, attempt?: SpeakingAttempt) {
    selectTarget(next, attempt ? attempt.scope?.kind === "segment" ? attempt.scope.segmentIndex : null : mode === "segment" ? 0 : null, attempt);
  }
  function sentenceCompleted(sentenceIndex: number) {
    const items = targets.filter(item => item.sentenceIndex === sentenceIndex);
    return items.length > 0 && items.every(item => completed.has(item.key));
  }
  function upload(file: File | undefined) {
    if (!file || busy) return;
    setError("");
    if (!file.name.toLowerCase().endsWith(".wav") || file.size > lesson.maxAudioBytes || file.size < 44) {
      setError(`Chọn tệp WAV tối đa 2 MB, dài từ 0,3 đến ${lesson.maxRecordingSeconds} giây. Bản ghi trước vẫn được giữ.`); return;
    }
    stopPlayback(); setResult(null); setAudioNotice("");
    saveClip(target.key, { blob: file, url: URL.createObjectURL(file), submitted: false, name: file.name });
    setNotice("Đã chọn tệp. Nghe lại rồi gửi chấm điểm.");
  }
  async function submit() {
    if (!clip || clip.submitted || busy || request.current) return;
    stopPlayback(); setError(""); setNotice(""); setPhase("submitting");
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 70_000);
    try {
      const body = new FormData();
      body.append("file", clip.blob, "recording.wav"); body.append("lessonId", String(lesson.lessonId)); body.append("sentenceIndex", String(index));
      body.append("sentenceText", sentence.text);
      if (target.segmentIndex !== null) body.append("segmentIndex", String(target.segmentIndex));
      const response = await fetch("/api/speaking/attempts", { method: "POST", body, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại trước khi gửi." : data.title || "Chưa chấm được bản ghi. Vui lòng thử lại.");
      if (mounted.current) {
        const attempt = data as SpeakingAttempt;
        saveClip(target.key, { ...clip, submitted: true });
        setResult(attempt); setHistory(old => mergeHistory([attempt], old));
        setSessionAttempts(old => [...old, attempt]);
        setAudioNotice("");
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error && e.name === "AbortError" ? "Yêu cầu đã hết thời gian chờ. Bản ghi vẫn còn. Tải lại lịch sử để kiểm tra trước khi gửi lại." : e instanceof Error ? e.message : "Chưa gửi được bản ghi. Bản ghi vẫn còn để thử lại.");
    } finally { window.clearTimeout(timeout); request.current = null; if (mounted.current) setPhase("idle"); }
  }
  async function reloadHistory() {
    if (historyRequest.current || busy) return;
    const controller = new AbortController(); historyRequest.current = controller;
    setHistoryLoading(true); setHistoryError("");
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/speaking/lessons/${lesson.lessonId}/attempts`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : "Chưa tải được lịch sử. Bạn có thể thử lại.");
      const data = await response.json() as SpeakingAttempt[];
      if (mounted.current) setHistory(old => mergeHistory(data, old));
    } catch (e) { if (mounted.current) setHistoryError(e instanceof Error && e.name !== "AbortError" ? e.message : "Tải lịch sử quá lâu. Vui lòng thử lại."); }
    finally { window.clearTimeout(timeout); historyRequest.current = null; if (mounted.current) setHistoryLoading(false); }
  }
  function speak() {
    if (!("speechSynthesis" in window)) { setError("Trình duyệt chưa có giọng đọc. Bạn có thể luyện trực tiếp theo câu mẫu."); return; }
    stopPlayback();
    const utterance = new SpeechSynthesisUtterance(target.text);
    utterance.lang = "en-US"; utterance.rate = rate;
    utterance.onerror = event => { if (mounted.current && event.error !== "canceled" && event.error !== "interrupted") setError("Chưa phát được giọng mẫu. Hãy kiểm tra giọng tiếng Anh của trình duyệt rồi thử lại."); };
    window.speechSynthesis.speak(utterance);
  }
  async function playWord(word: SpeakingWord) {
    if (!result || busy || !wordAudio.current) return;
    const range = wordAudioRange(word, result.assessment.durationSeconds);
    if (!range) { setAudioNotice("Chưa có mốc âm thanh phù hợp cho từ này. Bạn có thể nghe lại cả bản ghi."); return; }
    const audio = wordAudio.current;
    stopPlayback(); setAudioNotice("");
    const version = playbackGeneration.current;
    try {
      audio.currentTime = range.start; audio.playbackRate = 1;
      segmentEnd.current = range.end; setPlayingWord(word.text);
      await audio.play();
    } catch {
      if (mounted.current && version === playbackGeneration.current) {
        segmentEnd.current = null; setPlayingWord("");
        setAudioNotice("Chưa phát được đoạn ghi âm. Hãy thử lại hoặc nghe toàn bộ bản ghi bên dưới.");
      }
    }
  }
  function restartSession() {
    if (busy) return;
    stopPlayback(); setSessionAttempts([]); setIndex(0); setSegmentIndex(0); setResult(null); setError(""); setNotice("Đã bắt đầu lượt luyện mới. Các kết quả trước vẫn có trong lịch sử.");
  }

  return <main ref={page} id="main-content" className={styles.page} tabIndex={-1}>
    <Link className={styles.back} href={`/courses/${lesson.courseId}`}>← {lesson.courseTitle}</Link>
    <header className={styles.header}><div><p className={styles.eyebrow}>SPEAKING PRACTICE</p><h1>{lesson.title}</h1><p>{lesson.goals || "Nghe, đọc thành tiếng và luyện lại theo phản hồi."}</p></div><span className={styles.badge}>Bộ chấm thử nghiệm</span></header>
    <div className={styles.practiceMode} role="group" aria-label="Chế độ luyện nói">
      <button disabled={busy || !segments.length} aria-pressed={mode === "segment"} onClick={() => selectTarget(index, 0)}>Luyện từng cụm</button>
      <button disabled={busy} aria-pressed={mode === "sentence"} onClick={() => selectTarget(index, null)}>Đọc cả câu</button>
      <p>{isSegment ? "Nghe và đọc từng cụm ngắn. Bạn có thể chọn lại cụm khó để luyện riêng." : "Đọc toàn bộ câu để nhận điểm cả câu."}</p>
    </div>
    <section className={styles.progressCard} aria-label="Tiến độ lượt luyện">
      <div><strong>Lượt luyện này: {completed.size}/{targets.length} {mode === "segment" ? "cụm" : "câu"}</strong><p>Tiến độ tính trong lần mở bài này. Điểm cụm và điểm cả câu được lưu riêng; bản ghi cần thu lại chưa được tính.</p></div>
      <progress value={completed.size} max={Math.max(1, targets.length)} aria-label={`Số ${mode === "segment" ? "cụm" : "câu"} đã luyện trong lượt này`} />
      {completed.size === targets.length ? <div className={styles.completion} role="status"><b>Đã luyện hết các {mode === "segment" ? "cụm" : "câu"} trong bài!</b><button disabled={busy} onClick={restartSession}>Luyện thêm một lượt</button>{mode === "segment" && <button disabled={busy} onClick={() => selectTarget(index, null)}>Thử đọc cả câu</button>}<Link href={`/courses/${lesson.courseId}`}>Về khóa học →</Link></div> : null}
    </section>
    <nav className={styles.sentences} aria-label="Chọn câu luyện nói">{lesson.sentences.map((s, i) => <button key={i} disabled={busy} aria-current={i === index ? "step" : undefined} onClick={() => selectSentence(i)} title={s.text}>
      {sentenceCompleted(i) ? "✓ " : ""}Câu {i + 1}{targets.some(item => item.sentenceIndex === i && clips[item.key] && !clips[item.key].submitted) && <small> · có bản nháp</small>}
    </button>)}</nav>
    <ol className={styles.steps} aria-label="Các bước luyện nói">{["Nghe câu mẫu", "Thu và nghe lại", "Xem phản hồi"].map((label, i) => <li key={label} aria-current={step === i + 1 ? "step" : undefined}><span>{i + 1}</span>{label}</li>)}</ol>
    <div className={styles.layout}><div className={styles.practice}>
      <section className={styles.card} aria-labelledby="sentence-title">
        <div className={styles.cardTop}><h2 id="sentence-title">Câu {index + 1} / {lesson.sentences.length}</h2><span>Đọc tối đa {lesson.maxRecordingSeconds} giây</span></div>
        {isSegment && <>
          <p className={styles.phraseLabel}>Cụm {(target.segmentIndex ?? 0) + 1}/{segments.length} · chọn một cụm bên dưới để luyện</p>
          {segments.length > 1 && <nav className={styles.phraseContext} aria-label="Các cụm trong câu đầy đủ">{segments.map(segment => {
            const item = getPracticeTarget(lesson, index, segment.index);
            return <button key={segment.index} disabled={busy} aria-current={target.segmentIndex === segment.index ? "step" : undefined}
              aria-label={`Chọn cụm ${segment.index + 1}: ${segment.text}`} onClick={() => selectTarget(index, segment.index)}>
              <small>{item && completed.has(item.key) ? "✓ " : ""}Cụm {segment.index + 1}{item && clips[item.key] && !clips[item.key].submitted ? " · bản nháp" : ""}</small><span lang="en">{segment.text}</span>
            </button>;
          })}</nav>}
        </>}
        <blockquote lang="en">{target.text}</blockquote>{!isSegment && sentence.ipa && <p className={styles.ipa} lang="en">{sentence.ipa}</p>}
        {isSegment && <p className={styles.hint}>Chỉ đọc cụm đang chọn. Bạn sẽ nhận màu và điểm riêng cho cụm này, rồi có thể chuyển tiếp hoặc luyện lại.</p>}
        <div className={styles.sampleControls}><label>Tốc độ mẫu <select value={rate} disabled={busy} onChange={event => { const next = Number(event.target.value); setRate(next); if (sampleAudio.current) sampleAudio.current.playbackRate = next; }}><option value={.75}>Chậm · 0,75×</option><option value={1}>Bình thường · 1×</option></select></label>
          {!sampleUrl && <button className={styles.textButton} disabled={busy} onClick={speak}>▷ Nghe {unit} mẫu</button>}<button className={styles.secondary} disabled={busy} onClick={() => stopPlayback()}>Dừng nghe</button></div>
        {sampleUrl ? <audio ref={sampleAudio} key={sampleUrl} controls preload="metadata" src={sampleUrl} aria-label="Audio câu mẫu" onLoadedMetadata={event => { event.currentTarget.playbackRate = rate; }} onPlay={event => { if (busy) event.currentTarget.pause(); else stopPlayback(event.currentTarget); }} onError={() => setError("Chưa tải được audio mẫu. Bạn vẫn có thể đọc câu và thử tải lại trang sau.")} /> : <p className={styles.hint}>Giọng mẫu do trình duyệt tổng hợp, có thể khác nhau giữa các thiết bị.</p>}
        {isSegment && <div className={styles.segmentNavigation}><button className={styles.secondary} disabled={busy || segmentIndex === 0} onClick={() => selectTarget(index, segmentIndex - 1)}>← Cụm trước</button>
          {segmentIndex < segments.length - 1 ? <button className={styles.primary} disabled={busy} onClick={() => selectTarget(index, segmentIndex + 1)}>Cụm tiếp theo →</button> : <button className={styles.secondary} disabled={busy} onClick={() => selectTarget(index, null)}>Ôn lại cả câu</button>}</div>}
        <div className={styles.sentenceNavigation}><button disabled={busy || index === 0} onClick={() => selectSentence(index - 1)}>← Câu trước</button><span>{index + 1} / {lesson.sentences.length}</span><button disabled={busy || index === lesson.sentences.length - 1} onClick={() => selectSentence(index + 1)}>Câu tiếp theo →</button></div>
      </section>
      <section className={`${styles.card} ${styles.recorder}`} aria-labelledby="recorder-title">
        <span className={`${styles.mic} ${phase === "recording" ? styles.live : ""}`} aria-hidden="true">●</span>
        <h2 id="recorder-title">{phase === "recording" ? "Đang ghi âm…" : phase === "starting" ? "Đang mở microphone…" : phase === "encoding" ? "Đang chuẩn bị bản ghi…" : phase === "submitting" ? "Đang chấm bài nói…" : clip && !clip.submitted ? "Nghe lại bản ghi của bạn" : "Đến lượt bạn đọc"}</h2>
        <p>{phase === "submitting" ? "Đang phân tích các âm đã đọc. Vui lòng chờ kết quả trước khi chuyển phần luyện." : `Đặt microphone gần vừa đủ, đọc rõ ${isSegment ? "cụm đang chọn" : "toàn bộ câu"} rồi nghe lại trước khi gửi.`}</p>
        <label className={styles.autoStop}><input type="checkbox" checked={stopOnSilence} disabled={busy} onChange={event => setStopOnSilence(event.target.checked)} />Tự dừng sau khoảng 1,5 giây im lặng</label>
        <p className={styles.hint}>Nếu bạn thường ngập ngừng giữa các từ, có thể tắt tự dừng và bấm Dừng khi đọc xong.</p>
        {phase === "recording" && <div className={styles.recordingStats}><span>{seconds.toFixed(1)} / {lesson.maxRecordingSeconds} giây</span><meter min={0} max={1} value={level} aria-label="Mức âm lượng microphone" /><span className={styles.volumeHint}>{level < .03 ? "Chưa nghe rõ · kiểm tra mic" : level > .9 ? "Âm lượng lớn · thử lùi mic" : "Đã nhận âm thanh"}</span></div>}
        <div className={styles.actions}>
          {phase === "recording" ? <><button className={styles.primary} onClick={() => void finish()}>■ Dừng và nghe lại</button><button className={styles.secondary} onClick={cancelRecording}>Hủy lần ghi</button></> : <button className={styles.primary} disabled={busy} onClick={() => void start()}>{clip || result ? "Ghi âm lại" : "Bắt đầu ghi âm"}</button>}
          {phase === "starting" && <button className={styles.secondary} onClick={cancelRecording}>Hủy mở microphone</button>}
          <label className={`${styles.fileButton} ${busy ? styles.disabled : ""}`}>Chọn tệp WAV<input type="file" accept=".wav,audio/wav" disabled={busy} onChange={event => { upload(event.target.files?.[0]); event.target.value = ""; }} /></label>
        </div>
        {phase === "submitting" && <div className={styles.waiting} role="status"><span className={styles.spinner} aria-hidden="true" />Đang gửi và chấm bản ghi…</div>}
        {clip && (phase === "idle" || phase === "submitting") && <div className={styles.preview}><p className={styles.clipName}>{clip.name}{clip.submitted ? " · đã gửi chấm" : " · chưa gửi chấm"}</p>
          <audio key={clip.url} controls src={clip.url} aria-label="Nghe bản ghi của bạn" onPlay={event => { if (busy) event.currentTarget.pause(); else stopPlayback(event.currentTarget); }} onError={() => setError("Chưa phát được tệp này. Hãy chọn WAV khác hoặc ghi lại bằng microphone.")} />
          {!clip.submitted && <button className={styles.primary} disabled={busy} onClick={() => void submit()}>Gửi chấm điểm</button>}
          <button className={styles.secondary} disabled={busy} onClick={() => { stopPlayback(); saveClip(target.key, null); setNotice(`Đã bỏ bản ghi tạm của ${unit} này.`); }}>Bỏ bản ghi tạm</button>
        </div>}
        <p className={styles.hint}>Bản nháp được giữ riêng cho từng cụm và cả câu khi chuyển qua lại trong tab này. Tải lại hoặc đóng trang sẽ mất bản nháp. Tệp WAV tối đa 2 MB.</p>
      </section>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <div className={styles.error} role="alert">{error}</div>}
      <div aria-busy={phase === "submitting"}>{result && <section className={styles.card} aria-labelledby="result-title">
        <div className={styles.cardTop}><h2 ref={resultHeading} tabIndex={-1} id="result-title">Kết quả bản ghi</h2><span>{result.assessment.status === "partial" ? "Chấm được một phần" : "Đã chấm"}</span></div>
        <p className={styles.scopeLabel}>{result.scope?.kind === "segment" ? `Điểm riêng cụm ${result.scope.segmentIndex + 1} · câu ${result.sentenceIndex + 1}` : `Điểm cả câu ${result.sentenceIndex + 1}`}</p>
        {result.scope?.kind === "segment" && <p className={styles.hint}>Câu đầy đủ: <span lang="en">{result.scope.sentenceText}</span><br />Điểm bên dưới chỉ áp dụng cho cụm đã đọc.</p>}
        <p lang="en">{result.referenceText}</p><p className={styles.hint}>Bản ghi lúc {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(result.createdAt))}</p>
        {!canRetry && <p className={styles.notes}>Câu mẫu hoặc cách chia cụm của bản ghi này đã thay đổi. Chọn phần luyện ở phía trên để đọc nội dung hiện tại.</p>}
        <div className={styles.score}><strong>{result.assessment.overallScore.toFixed(1)}<small>/100</small></strong><div><b>{resultMode === "record_again" ? "Điểm tạm · nên ghi âm lại" : resultMode === "limited_coverage" ? `Điểm phần đã chấm · chưa đủ toàn ${result.scope?.kind === "segment" ? "cụm" : "câu"}` : "Điểm các âm đã đánh giá"}</b><p>Đã chấm {result.assessment.words.reduce((n, word) => n + word.phones.length, 0)} / {result.assessment.referenceTokenCount} âm tham chiếu ({(result.assessment.coverage * 100).toFixed(0)}%).<br />Điểm /100 là trung bình điểm các âm đã chấm nhân 50; không phải tỷ lệ phát âm đúng.</p></div></div>
        {comparison && <div className={styles.comparison}><b>So với lần luyện trước cùng {result.scope?.kind === "segment" ? "cụm" : "câu"}</b>{comparison.delta === null ? <p>{comparison.reason}</p> : <p>{comparison.previous.assessment.overallScore.toFixed(1)} → {result.assessment.overallScore.toFixed(1)} /100 <strong>{comparison.delta > 0 ? "+" : ""}{comparison.delta.toFixed(1)} điểm</strong><small>Cùng bộ chấm và cùng phần âm được hỗ trợ. Chênh lệch chỉ mang tính tham khảo.</small></p>}</div>}
        <PronunciationFeedback key={result.attemptId} attempt={result} disabled={busy} canRetry={canRetry} rate={rate} onBeforePlay={() => stopPlayback()} onListenRecording={word => void playWord(word)} onRetry={() => void start()} />
        {playingWord && <p className={styles.notice} role="status">Đang nghe đoạn ghi âm quanh từ “{playingWord}”… <button className={styles.secondary} onClick={() => stopPlayback()}>Dừng đoạn ghi âm</button></p>}
        {audioNotice && <p className={styles.error} role="status">{audioNotice}</p>}
        <audio ref={wordAudio} hidden key={`segment-${result.attemptId}`} src={result.audioUrl} preload="metadata" onTimeUpdate={event => { if (segmentEnd.current !== null && event.currentTarget.currentTime >= segmentEnd.current) event.currentTarget.pause(); }} onPlay={event => { if (busy) event.currentTarget.pause(); else stopPlayback(event.currentTarget); }} onPause={event => { if (event.currentTarget.paused) { segmentEnd.current = null; setPlayingWord(""); } }} onEnded={() => { segmentEnd.current = null; setPlayingWord(""); }} onError={() => setAudioNotice("Chưa tải được bản ghi đã lưu. Bạn có thể thử lại từ lịch sử.")} />
        <details className={styles.details}><summary>Điểm chi tiết từng từ và âm · thang 0–2</summary><div className={styles.words}>{result.assessment.words.map(word => <article key={word.index} className={styles.word}><div><strong lang="en">{word.text}</strong><span>{word.score === null ? "Chưa đánh giá được" : `${word.score.toFixed(2)} / 2`}</span></div>{word.phones.length ? <><div className={styles.phones}>{word.phones.map((phone, i) => <span key={i} title={`${phone.sourcePhone}: ${phone.score.toFixed(2)} / 2`}><b lang="en">/{phone.symbol}/</b><small>{phone.score.toFixed(2)}</small></span>)}</div>{word.reason && <p>{word.reason}</p>}</> : <p>{word.reason}</p>}</article>)}</div></details>
        {result.assessment.warnings.length > 0 && <ul className={styles.notes}>{result.assessment.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
        <p className={styles.feedback}>{result.assessment.feedback}</p>
        <h3>Nghe lại toàn bộ bản ghi đã chấm</h3><audio key={result.audioUrl} src={result.audioUrl} controls preload="metadata" aria-label="Nghe lại bản ghi đã lưu" onPlay={event => { if (busy) event.currentTarget.pause(); else stopPlayback(event.currentTarget); }} onError={() => setAudioNotice("Chưa phát được bản ghi đã lưu. Hãy tải lại lịch sử và thử lại.")} />
        <p className={styles.hint}>Chưa đánh giá trọng âm, độ trôi chảy hoặc xác định lỗi thay âm cụ thể.</p>
        <div className={styles.resultActions}>{isSegment && <button className={styles.secondary} disabled={busy} onClick={() => selectTarget(index, null)}>Thử đọc cả câu</button>}
          {following ? <button className={styles.primary} disabled={busy} onClick={() => selectTarget(following.sentenceIndex, following.segmentIndex)}>{following.sentenceIndex === index ? "Luyện cụm tiếp theo →" : "Luyện câu tiếp theo →"}</button> : nextPending && nextPending.key !== target.key ? <button className={styles.primary} disabled={busy} onClick={() => selectTarget(nextPending.sentenceIndex, nextPending.segmentIndex)}>Luyện phần chưa hoàn tất →</button> : <Link className={styles.back} href={`/courses/${lesson.courseId}`}>Quay lại khóa học →</Link>}</div>
      </section>}</div>
    </div><aside className={styles.history} aria-label="Lịch sử luyện nói">
      <div className={styles.cardTop}><h2>Lần luyện gần đây</h2><button className={styles.secondary} disabled={busy || historyLoading} onClick={() => void reloadHistory()}>{historyLoading ? "Đang tải…" : "Tải lại"}</button></div><p>20 bản ghi mới nhất. Chọn một lần luyện để nghe và xem phản hồi.</p>
      {historyError && <p className={styles.historyError} role="status">{historyError}</p>}
      {history.length === 0 ? <div className={styles.empty}>Kết quả sẽ xuất hiện ở đây sau khi gửi chấm thành công.</div> : <ol>{history.map(attempt => <li key={attempt.attemptId}><button disabled={busy || !lesson.sentences[attempt.sentenceIndex]} aria-pressed={result?.attemptId === attempt.attemptId} onClick={() => selectSentence(attempt.sentenceIndex, attempt)}><span>Câu {attempt.sentenceIndex + 1} · {attempt.scope?.kind === "segment" ? `cụm ${attempt.scope.segmentIndex + 1}` : "cả câu"}<small>{new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date(attempt.createdAt))}</small>{feedbackMode(attempt.assessment) === "record_again" && <small>Cần thu lại</small>}</span><strong>{attempt.assessment.overallScore.toFixed(1)}<small>/100</small></strong></button></li>)}</ol>}
    </aside></div>
  </main>;
}
