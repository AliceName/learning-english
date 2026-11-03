"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/components/site-icon";
import { SESSION_CHANGED } from "@/lib/session-events";
import { audioTime, isAnswered, listeningHref, listeningPath, listeningRequest, ListeningRequestError,
  type ListeningAnswer, type ListeningHistory, type ListeningLesson, type ListeningResult, type ListeningReview } from "@/lib/listening";
import ListeningPlayer from "./listening-player";
import styles from "./listening.module.css";

const questionNames = { multiple_choice: "Kiểm tra mức độ hiểu", fill_blank: "Nghe & điền từ còn thiếu", matching: "Nghe & nối ý chính" };

export default function ListeningPractice({ lesson }: { lesson: ListeningLesson }) {
  const router = useRouter(), path = listeningPath(lesson.courseId, lesson.lessonId);
  const [answers, setAnswers] = useState<Record<number, ListeningAnswer>>({});
  const [started, setStarted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [sessionInvalid, setSessionInvalid] = useState(false), [result, setResult] = useState<ListeningResult | null>(null);
  const [progress, setProgress] = useState(lesson.progress), [elapsed, setElapsed] = useState(0), [run, setRun] = useState(0);
  const [position, setPosition] = useState(lesson.positionSeconds), [positionError, setPositionError] = useState("");
  const [audioDuration, setAudioDuration] = useState(0);
  const [listened, setListened] = useState(false), [transcript, setTranscript] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false), [transcriptBusy, setTranscriptBusy] = useState(false);
  const [history, setHistory] = useState<ListeningHistory | null>(null), [historyBusy, setHistoryBusy] = useState(false);
  const [seek, setSeek] = useState<{ seconds: number; nonce: number } | null>(null);
  const controller = useRef<AbortController | null>(null), startTime = useRef(0), savingPosition = useRef(false);
  const submitDialog = useRef<HTMLDialogElement>(null), leaveDialog = useRef<HTMLDialogElement>(null), leaveTarget = useRef("");
  const resultHeading = useRef<HTMLHeadingElement>(null), busyRef = useRef(false);
  const answered = lesson.questions.filter(question => isAnswered(question, answers[question.questionId])).length;
  const dirty = started && !result && answered > 0 && !sessionInvalid;
  const canShowTranscript = !lesson.hideTranscriptFirstListen || listened || !!result;
  const next = lesson.lessons[lesson.lessons.findIndex(item => item.lessonId === lesson.lessonId) + 1];

  const invalidate = useCallback(() => {
    controller.current?.abort();
    setSessionInvalid(true); setAnswers({}); setResult(null); setTranscript(null); setTranscriptOpen(false);
    setHistory(null); setStarted(false); setBusy(false); setError("Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại để tiếp tục.");
  }, []);
  useEffect(() => {
    controller.current = new AbortController();
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SESSION_CHANGED);
    if (channel) channel.onmessage = invalidate;
    window.addEventListener(SESSION_CHANGED, invalidate);
    return () => { controller.current?.abort(); window.removeEventListener(SESSION_CHANGED, invalidate); channel?.close(); };
  }, [invalidate]);
  useEffect(() => {
    if (!started || result || sessionInvalid) return;
    const timer = window.setInterval(() => setElapsed(Math.min(86400, Math.floor((performance.now() - startTime.current) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [started, result, sessionInvalid]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || url.href === location.href || url.hash && url.pathname === location.pathname) return;
      event.preventDefault(); event.stopPropagation(); leaveTarget.current = url.pathname + url.search + url.hash; leaveDialog.current?.showModal();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", navigate, true); };
  }, [dirty]);

  const showError = useCallback((reason: unknown) => {
    if (controller.current?.signal.aborted) return;
    if (reason instanceof ListeningRequestError && reason.status === 401) { invalidate(); return; }
    setError(reason instanceof Error ? reason.message : "Chưa thể xử lý yêu cầu. Vui lòng thử lại.");
  }, [invalidate]);
  const start = useCallback(async (again = false) => {
    if (busyRef.current || sessionInvalid) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const response = await listeningRequest<{ positionSeconds: number }>(`${path}/start`, { method: "POST", signal: controller.current?.signal });
      controller.current?.signal.throwIfAborted();
      setPosition(again ? 0 : response.positionSeconds); setRun(value => value + 1);
      setAnswers({}); setResult(null); setListened(false); setTranscript(null); setTranscriptOpen(false); setSeek(null);
      setElapsed(0); startTime.current = performance.now(); setStarted(true);
    } catch (reason) { showError(reason); }
    finally { busyRef.current = false; setBusy(false); }
  }, [path, sessionInvalid, showError]);
  const savePosition = (seconds: number) => {
    if (!started || result || sessionInvalid || savingPosition.current || !Number.isFinite(seconds)) return;
    savingPosition.current = true;
    void listeningRequest(`${path}/position`, { method: "PUT", body: JSON.stringify({ positionSeconds: Math.max(0, Math.min(86400, seconds)) }), signal: controller.current?.signal })
      .then(() => setPositionError("")).catch(reason => {
        if (controller.current?.signal.aborted) return;
        if (reason instanceof ListeningRequestError && reason.status === 401) invalidate();
        else setPositionError("Chưa lưu được vị trí nghe. Bài đang làm vẫn được giữ trong phiên này.");
      }).finally(() => { savingPosition.current = false; });
  };
  function update(questionId: number, change: Partial<ListeningAnswer>) {
    setAnswers(previous => ({ ...previous, [questionId]: { ...(previous[questionId] ?? { questionId, matches: [] }), ...change } }));
  }
  const replay = useCallback((seconds: number | null) => { if (seconds !== null) setSeek(previous => ({ seconds, nonce: (previous?.nonce ?? 0) + 1 })); }, []);
  async function toggleTranscript() {
    if (!canShowTranscript || sessionInvalid || transcriptBusy) return;
    if (transcript !== null) { setTranscriptOpen(value => !value); return; }
    setTranscriptBusy(true); setError("");
    try { const response = await listeningRequest<{ transcript: string }>(`${path}/transcript`, { signal: controller.current?.signal }); controller.current?.signal.throwIfAborted(); setTranscript(response.transcript); setTranscriptOpen(true); }
    catch (reason) { showError(reason); }
    finally { setTranscriptBusy(false); }
  }
  async function loadHistory(page = 1) {
    if (historyBusy || sessionInvalid) return;
    setHistoryBusy(true); setError("");
    try { const response = await listeningRequest<ListeningHistory>(`${path}/results?page=${page}`, { signal: controller.current?.signal }); controller.current?.signal.throwIfAborted(); setHistory(response); }
    catch (reason) { showError(reason); }
    finally { setHistoryBusy(false); }
  }
  async function viewResult(resultId: number) {
    if (busyRef.current || started && !result || sessionInvalid) return;
    busyRef.current = true; setBusy(true); setError("");
    try { const response = await listeningRequest<ListeningResult>(`${path}/results/${resultId}`, { signal: controller.current?.signal }); controller.current?.signal.throwIfAborted(); setResult(response); setStarted(true); setSeek(null); }
    catch (reason) { showError(reason); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const submit = useCallback(async () => {
    submitDialog.current?.close();
    if (busyRef.current || !started || result || sessionInvalid) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const response = await listeningRequest<ListeningResult>(`${path}/submissions`, { method: "POST", signal: controller.current?.signal,
        body: JSON.stringify({ contentVersion: lesson.contentVersion, answers: Object.values(answers), timeSpentSeconds: Math.min(86400, Math.floor((performance.now() - startTime.current) / 1000)) }) });
      controller.current?.signal.throwIfAborted();
      setResult(response); setProgress(response.progress); setHistory(null);
      requestAnimationFrame(() => { resultHeading.current?.focus(); resultHeading.current?.scrollIntoView({ behavior: "smooth", block: "center" }); });
    } catch (reason) { showError(reason); }
    finally { busyRef.current = false; setBusy(false); }
  }, [answers, lesson.contentVersion, path, result, sessionInvalid, showError, started]);

  return <main id="main-content" tabIndex={-1} className={styles.page}>
    <div className={styles.breadcrumb}><nav aria-label="Đường dẫn"><Link href="/courses"><Icon name="book" />Khóa học</Link><span>/</span><Link href={`/courses/${lesson.courseId}`}>{lesson.courseTitle}</Link><span>/</span><span>{lesson.title}</span></nav>
      <div className={styles.badges}>{lesson.difficultyLevel && <span>CEFR {lesson.difficultyLevel}</span>}<span><Icon name="headphones" />Listening Lab</span></div></div>
    <section className={`${styles.card} ${styles.hero}`}>
      <div><h1>{lesson.title}</h1><p><Icon name="shield" />Nghe kỹ audio và hoàn thành {lesson.questions.length} câu hỏi{lesson.estimatedMinutes ? ` · Khoảng ${lesson.estimatedMinutes} phút` : ""}.</p></div>
      <div className={styles.answerProgress}><div><span>Đã trả lời</span><strong>{answered}/{lesson.questions.length}</strong></div><progress value={answered} max={lesson.questions.length} aria-label="Tiến độ trả lời" /></div>
    </section>
    {error && <div className={styles.error} role="alert">{error}{sessionInvalid ? <Link href="/login">Đăng nhập</Link> : <button type="button" onClick={() => setError("")}>Đóng thông báo</button>}</div>}
    {!started && !sessionInvalid && <section className={styles.intro}>
      <div><strong>Sẵn sàng luyện nghe?</strong><p>Bạn có thể nghe lại, thay đổi tốc độ và làm lại bài. Điểm được tính sau khi nộp.</p>{lesson.latestResult && <p>Đã làm {lesson.attemptCount} lần · Điểm gần nhất: <strong>{lesson.latestResult.score}/100</strong></p>}</div>
      <button type="button" className={styles.primary} disabled={busy} onClick={() => void start()}><Icon name="play" />{busy ? "Đang mở bài…" : lesson.positionSeconds > 0 ? "Tiếp tục làm bài" : "Bắt đầu làm bài"}</button>
    </section>}
    {!sessionInvalid && <ListeningPlayer key={run} url={lesson.audioUrl} title={lesson.title} enabled={started && !sessionInvalid} position={position} seek={seek}
      onPosition={savePosition} onListened={() => setListened(true)} onDuration={setAudioDuration} transcriptControls={<button type="button" className={styles.softButton} disabled={!canShowTranscript || transcriptBusy}
        aria-expanded={transcriptOpen} aria-controls="listening-transcript" title={!canShowTranscript ? "Transcript mở sau lần nghe đầu hoặc khi nộp bài" : undefined} onClick={() => void toggleTranscript()}><Icon name="eye" />{transcriptBusy ? "Đang tải…" : "Transcript"}</button>}>
      {!canShowTranscript && <p className={styles.hint}>Transcript được mở sau khi nghe hết lần đầu hoặc sau khi nộp bài.</p>}
      {transcriptOpen && <section id="listening-transcript" className={styles.transcript}><h2><Icon name="file" />Lời thoại / Transcript</h2><p>{transcript}</p></section>}
    </ListeningPlayer>}
    {positionError && !sessionInvalid && <p className={styles.hint} role="status">{positionError}</p>}
    {result && <section className={`${styles.card} ${styles.result}`} aria-label="Kết quả bài làm"><div className={styles.score}>{result.result.score}<span>/100</span></div>
      <div><h2 ref={resultHeading} tabIndex={-1}>Kết quả bài nghe</h2><p>Đúng {result.result.correctAnswers}/{result.result.totalQuestions} câu · Thời gian: {audioTime(result.result.timeSpentSeconds ?? 0)}</p>
        <p>{result.fullReview ? "Xem đáp án và giải thích ở từng câu bên dưới." : "Lịch sử lưu điểm tổng và chi tiết câu sai; các lựa chọn của câu đúng không được lưu."}</p>
        <button type="button" className={styles.primary} disabled={busy || sessionInvalid} onClick={() => void start(true)}><Icon name="replay" />{busy ? "Đang xử lý…" : "Làm lại bài nghe"}</button></div>
    </section>}
    {!sessionInvalid && result && !result.fullReview && <section className={styles.questionStack} aria-label="Chi tiết câu sai">{result.review.length === 0
      ? <div className={styles.card}><p>{result.result.correctAnswers === result.result.totalQuestions ? "Bạn đã trả lời đúng tất cả câu hỏi trong lần làm này." : "Lần làm này chưa có chi tiết câu sai được lưu."}</p></div>
      : result.review.map(review => <article key={review.questionId} className={styles.card}><h2>Câu {review.questionId + 1}: {review.prompt.replaceAll("[blank]", "…")}</h2><Review review={review} replay={replay} audioDuration={audioDuration} /></article>)}</section>}
    {!sessionInvalid && (!result || result.fullReview) && <form onSubmit={event => { event.preventDefault(); if (answered < lesson.questions.length) submitDialog.current?.showModal(); else void submit(); }}>
      {started && !result && <div className={styles.questionNav}><span>Đi tới câu:</span>{lesson.questions.map((question, index) => <button key={question.questionId} type="button" aria-label={`Đi tới câu ${index + 1}`} data-answered={isAnswered(question, answers[question.questionId])}
        onClick={() => { const element = document.getElementById(`listening-question-${index}`); element?.scrollIntoView({ behavior: "smooth", block: "center" }); element?.focus(); }}>{index + 1}</button>)}<span className={styles.timer}><Icon name="clock" />{audioTime(elapsed)}</span></div>}
      <div className={styles.questionStack}>{lesson.questions.map((question, index) => {
        const answer = answers[question.questionId], review = result?.review.find(item => item.questionId === question.questionId);
        return <article key={question.questionId} id={`listening-question-${index}`} tabIndex={-1} className={`${styles.card} ${styles.question}`}>
          <div className={styles.questionTop}><div className={styles.questionHeading}><span className={styles.number}>{String(index + 1).padStart(2, "0")}</span><div><h2>{questionNames[question.type]}</h2><p>{question.type === "multiple_choice" ? "Chọn đáp án đúng nhất theo nội dung audio." : question.type === "fill_blank" ? "Điền từ nghe được vào chỗ trống theo ngữ cảnh." : "Chọn nội dung tương ứng cho mỗi ý bên trái."}</p></div></div>
            {question.atSeconds !== null && <button type="button" className={styles.softButton} disabled={!started || busy || !audioDuration || question.atSeconds > audioDuration} aria-label={`Nghe lại câu ${index + 1}`} onClick={() => replay(question.atSeconds)}><Icon name="replay" />Nghe lại câu này</button>}</div>
          <fieldset className={styles.questionFields} disabled={!started || busy || !!result}><legend className={styles.srOnly}>Câu {index + 1}: {questionNames[question.type]}</legend>
          <p className={question.type === "fill_blank" ? styles.blankPrompt : styles.prompt}>{question.prompt.replaceAll("[blank]", "…………")}</p>
          {question.type === "multiple_choice" ? <div className={styles.options}>{question.options.map((option, optionIndex) => <label key={optionIndex} data-selected={answer?.optionIndex === optionIndex}>
            <span className={styles.optionLetter}>{String.fromCharCode(65 + optionIndex)}</span><span>{option}</span><input type="radio" name={`question-${index}`} checked={answer?.optionIndex === optionIndex} value={optionIndex} onChange={() => update(question.questionId, { optionIndex })} /></label>)}</div>
            : question.type === "fill_blank" ? <label className={styles.fillAnswer}>Câu trả lời của bạn<input type="text" autoComplete="off" spellCheck={false} maxLength={500} placeholder="Gõ từ nghe được…" value={answer?.text ?? ""} onChange={event => update(question.questionId, { text: event.target.value })} /></label>
              : <div className={styles.matching}>{question.matchingLeft.map((left, leftIndex) => <label key={leftIndex}><span>{left}</span><select aria-label={`Câu ${index + 1}: ${left}`} value={answer?.matches.find(match => match.leftIndex === leftIndex)?.rightId ?? ""}
                onChange={event => { const rightId = event.target.value; update(question.questionId, { matches: [...(answer?.matches ?? []).filter(match => match.leftIndex !== leftIndex), ...(rightId ? [{ leftIndex, rightId }] : [])] }); }}><option value="">Chọn ý tương ứng</option>{question.matchingRight.map(option => <option key={option.id} value={option.id}>{option.text}</option>)}</select></label>)}</div>}
          </fieldset>{review && <Review review={review} replay={replay} audioDuration={audioDuration} />}
        </article>;
      })}</div>
      {started && !result && <div className={styles.submitBar}><div><strong>{answered}/{lesson.questions.length} câu đã trả lời</strong><span>Câu bỏ trống sẽ được tính là sai.</span></div><button type="submit" className={styles.primary} disabled={busy || sessionInvalid}><Icon name="check" />{busy ? "Đang nộp bài…" : "Nộp bài & xem kết quả"}</button></div>}
    </form>}
    {!sessionInvalid && <section className={`${styles.card} ${styles.history}`}><div className={styles.sectionHeading}><div><h2>Lịch sử làm bài</h2><p>Xem điểm và ôn lại các câu trả lời sai.</p></div><button type="button" className={styles.softButton} disabled={historyBusy || busy || started && !result} onClick={() => void loadHistory()}>{historyBusy ? "Đang tải…" : "Xem lịch sử"}</button></div>
      {started && !result && <p className={styles.hint}>Nộp bài để xem lịch sử mà không mất câu trả lời đang làm.</p>}
      {history && <><div className={styles.historyList}>{history.items.length === 0 ? <p>Chưa có lần nộp bài nào.</p> : history.items.map(item => <div key={item.resultId}><div><strong>{item.score}/100</strong><span>{item.correctAnswers}/{item.totalQuestions} câu đúng · {audioTime(item.timeSpentSeconds ?? 0)}</span><time dateTime={item.submittedAt}>{new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.submittedAt))}</time></div><button type="button" disabled={busy || started && !result} onClick={() => void viewResult(item.resultId)}>Xem kết quả</button></div>)}</div>
        {history.totalPages > 1 && <div className={styles.historyPages}><button type="button" disabled={historyBusy || history.page <= 1} onClick={() => void loadHistory(history.page - 1)}>Trang trước</button><span>{history.page}/{history.totalPages}</span><button type="button" disabled={historyBusy || history.page >= history.totalPages} onClick={() => void loadHistory(history.page + 1)}>Trang sau</button></div>}</>}
    </section>}
    {!sessionInvalid && <footer className={styles.footer}><div><strong>Tiến độ luyện nghe: {progress.completedLessons}/{progress.totalLessons} bài</strong><progress value={progress.completedLessons} max={progress.totalLessons || 1} aria-label="Tiến độ luyện nghe trong khóa" /></div><div><Link href={`/courses/${lesson.courseId}`}>← Về khóa học</Link>{next && <Link href={listeningHref(lesson.courseId, next.lessonId)} className={styles.softButton}>Bài nghe tiếp theo<Icon name="arrow" /></Link>}</div></footer>}
    <dialog ref={submitDialog} className={styles.dialog}><h2>Bạn còn {lesson.questions.length - answered} câu chưa hoàn thành</h2><p>Các câu bỏ trống được tính là sai. Bạn có thể tiếp tục làm hoặc nộp ngay.</p><div><button type="button" onClick={() => submitDialog.current?.close()}>Tiếp tục làm</button><button type="button" className={styles.primary} onClick={() => void submit()}>Nộp bài</button></div></dialog>
    <dialog ref={leaveDialog} className={styles.dialog}><h2>Rời bài đang làm?</h2><p>Câu trả lời chưa nộp sẽ bị mất khi rời trang.</p><div><button type="button" onClick={() => leaveDialog.current?.close()}>Ở lại làm bài</button><button type="button" className={styles.primary} onClick={() => { setStarted(false); leaveDialog.current?.close(); router.push(leaveTarget.current); }}>Rời bài</button></div></dialog>
  </main>;
}

function Review({ review, replay, audioDuration }: { review: ListeningReview; replay: (seconds: number | null) => void; audioDuration: number }) {
  return <div className={`${styles.review} ${review.correct ? styles.correct : styles.incorrect}`}>
    <strong><Icon name={review.correct ? "check" : "close"} />{review.correct ? "Chính xác!" : "Chưa chính xác"}</strong>
    {review.pairs.length ? <ul>{review.pairs.map((pair, index) => <li key={index}>{pair.left}: <span>{pair.submittedAnswer ?? "Bỏ trống"}</span>{!pair.correct && <> · Đáp án: <b>{pair.correctAnswer}</b></>}</li>)}</ul>
      : <><p>Bạn trả lời: <b>{review.submittedAnswer ?? "Bỏ trống"}</b></p><p>Đáp án: <b>{review.correctAnswer}</b></p></>}
    {review.explanation && <p><b>Giải thích:</b> {review.explanation}</p>}
    {review.atSeconds !== null && <button type="button" className={styles.softButton} disabled={!audioDuration || review.atSeconds > audioDuration} onClick={() => replay(review.atSeconds)}><Icon name="replay" />Nghe lại tại {audioTime(review.atSeconds)}</button>}
  </div>;
}
