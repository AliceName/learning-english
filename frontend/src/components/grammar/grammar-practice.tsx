"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/components/site-icon";
import { SESSION_CHANGED } from "@/lib/session-events";
import { grammarAnswered, grammarDraftKey, grammarHref, grammarLoginHref, grammarTime, parseGrammarDraft,
  submitGrammar, GrammarRequestError, type GrammarAnswer, type GrammarLesson, type GrammarResult } from "@/lib/grammar";
import styles from "./grammar.module.css";

const questionLabels = {
  multiple_choice: "Chọn đáp án đúng (Multiple Choice)",
  fill_blank: "Điền từ còn thiếu (Fill in the Blank)",
  error_correction: "Tìm lỗi sai (Error Correction)",
};
const instructions = {
  multiple_choice: "Đọc câu hỏi và chọn một đáp án đúng bên dưới.",
  fill_blank: "Điền dạng từ hoặc cấu trúc đúng để hoàn thành câu.",
  error_correction: "Chọn phần chứa lỗi ngữ pháp trong câu bên dưới.",
};

function GrammarRules({ text }: { text: string }) {
  return <div className={styles.rulesText}>{text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part)}</div>;
}

export default function GrammarPractice({ lesson, userId }: { lesson: GrammarLesson; userId: number }) {
  const draftKey = grammarDraftKey(userId, lesson);
  const [answers, setAnswers] = useState<Record<number, GrammarAnswer>>({});
  const [current, setCurrent] = useState(0), [elapsed, setElapsed] = useState(0), [notes, setNotes] = useState("");
  const [ready, setReady] = useState(false), [paused, setPaused] = useState(false), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GrammarResult | null>(null), [error, setError] = useState("");
  const [storageStatus, setStorageStatus] = useState("Đang chuẩn bị bài học…");
  const [invalidSession, setInvalidSession] = useState(false);
  const [modal, setModal] = useState<"handbook" | "submit" | "pause" | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), questionHeading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null), busyRef = useRef(false), elapsedRef = useRef(0);
  const question = lesson.questions[current], answer = answers[question.questionId];
  const blankValue = question.type === "fill_blank" ? answer?.text?.trim()
    : answer?.optionIndex !== undefined ? question.options[answer.optionIndex] : "";
  const review = result?.review.find(item => item.questionId === question.questionId);
  const answered = lesson.questions.filter(item => grammarAnswered(item, answers[item.questionId])).length;
  const locked = !ready || paused || busy || invalidSession || !!result;
  const unit = lesson.lessons.findIndex(item => item.lessonId === lesson.lessonId) + 1;
  const nextLesson = lesson.lessons[unit];

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const draft = parseGrammarDraft(localStorage.getItem(draftKey), lesson);
        if (draft) {
          setAnswers(draft.answers); setCurrent(draft.current); setElapsed(draft.elapsed);
          elapsedRef.current = draft.elapsed; setNotes(draft.notes);
        }
        setStorageStatus(draft ? "Đã khôi phục bài làm trên thiết bị" : "Tự động lưu trên thiết bị");
      } catch { setStorageStatus("Không thể lưu trên thiết bị này"); }
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [draftKey, lesson]);

  useEffect(() => {
    if (!ready || paused || busy || result || invalidSession) return;
    const base = elapsedRef.current, start = performance.now();
    const timer = window.setInterval(() => {
      elapsedRef.current = Math.min(86400, base + Math.floor((performance.now() - start) / 1000));
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [ready, paused, busy, result, invalidSession]);

  useEffect(() => {
    if (!ready || invalidSession) return;
    // Keep notes after submission; a later visit starts a fresh attempt.
    const draft = JSON.stringify({ answers: result ? {} : answers, current: result ? 0 : current,
      elapsed: result ? 0 : elapsed, notes });
    const save = () => {
      try { localStorage.setItem(draftKey, draft); setStorageStatus("Đã lưu trên thiết bị"); }
      catch { setStorageStatus("Không thể lưu trên thiết bị này"); }
    };
    const timer = window.setTimeout(save, 250);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer); window.removeEventListener("pagehide", save);
      // Next.js navigation can unmount the lesson before the debounce or pagehide runs.
      try { localStorage.setItem(draftKey, draft); } catch { /* The visible save status reports unavailable storage. */ }
    };
  }, [answers, current, elapsed, notes, ready, invalidSession, result, draftKey]);

  const invalidate = useCallback(() => {
    request.current?.abort(); busyRef.current = false;
    setInvalidSession(true); setAnswers({}); setNotes(""); setResult(null); setBusy(false);
    dialog.current?.close(); setModal(null);
    setError("Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại để tiếp tục.");
  }, []);
  useEffect(() => {
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SESSION_CHANGED);
    if (channel) channel.onmessage = invalidate;
    window.addEventListener(SESSION_CHANGED, invalidate);
    return () => { request.current?.abort(); channel?.close(); window.removeEventListener(SESSION_CHANGED, invalidate); };
  }, [invalidate]);

  function navigate(index: number) {
    setCurrent(index);
    requestAnimationFrame(() => questionHeading.current?.focus());
  }
  function updateAnswer(value: GrammarAnswer) {
    if (locked) return;
    setAnswers(previous => ({ ...previous, [question.questionId]: value }));
    setError("");
  }
  function openModal(value: "handbook" | "submit" | "pause") {
    if (value === "pause") setPaused(true);
    setModal(value); dialog.current?.showModal();
  }
  function closeModal() {
    dialog.current?.close(); setModal(null); setPaused(false);
  }
  async function submit() {
    if (busyRef.current || invalidSession || result) return;
    busyRef.current = true; setBusy(true); setError(""); closeModal();
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await submitGrammar(lesson, Object.values(answers), elapsedRef.current, controller.signal);
      if (controller.signal.aborted) return;
      setResult(response); setCurrent(0);
      requestAnimationFrame(() => questionHeading.current?.focus());
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof GrammarRequestError && failure.status === 401) invalidate();
      else setError(failure instanceof Error ? failure.message : "Chưa thể nộp bài. Vui lòng thử lại.");
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }
  function retry() {
    setResult(null); setAnswers({}); setCurrent(0); setElapsed(0); elapsedRef.current = 0; setError("");
    requestAnimationFrame(() => questionHeading.current?.focus());
  }
  function advance() {
    if (current < lesson.questions.length - 1) navigate(current + 1);
    else if (!result) openModal("submit");
  }
  const nextLabel = current < lesson.questions.length - 1 ? "Câu tiếp theo" : "Nộp bài";

  return <main id="main-content" tabIndex={-1} className={styles.page}>
    <header className={styles.lessonHeader}>
      <div className={styles.headingText}>
        <nav className={styles.breadcrumb} aria-label="Đường dẫn">
          <Link href="/" aria-label="Trang chủ"><Icon name="home" /></Link><Icon name="chevron" />
          <Link href="/courses">Khóa học</Link><Icon name="chevron" /><Link href={`/courses/${lesson.courseId}`}>{lesson.courseTitle}</Link>
        </nav>
        <div className={styles.titleRow}><span className={styles.unit}>UNIT {String(unit).padStart(2, "0")}</span><h1>{lesson.title}</h1></div>
      </div>
      <div className={styles.headerActions}>
        <button className={styles.secondary} onClick={() => openModal("handbook")} disabled={invalidSession}><Icon name="book" />Cẩm nang ngữ pháp</button>
        <button className={styles.secondary} onClick={() => openModal("pause")} disabled={busy || !!result || invalidSession || !ready}><Icon name="pause" />Tạm dừng</button>
      </div>
    </header>

    {error && <div className={styles.error} role="alert">{error}{invalidSession && <Link href={grammarLoginHref(lesson.courseId, lesson.lessonId)}>Đăng nhập lại</Link>}</div>}
    {result && <section className={styles.resultBanner} role="status" aria-label="Kết quả bài làm">
      <span className={styles.resultIcon}><Icon name="star" /></span><div><h2>Đã hoàn thành bài ngữ pháp!</h2><p>Đúng {result.result.correctAnswers}/{result.result.totalQuestions} câu · Thời gian {grammarTime(result.result.timeSpentSeconds ?? elapsed)}</p></div>
      <strong>{result.result.score}<small>/100 điểm</small></strong>
      <button className={styles.secondary} onClick={retry}><Icon name="replay" />Làm lại bài</button>
    </section>}

    <div className={styles.layout}>
      <div className={styles.exerciseColumn}>
        <section className={`${styles.card} ${styles.progressCard}`} aria-label="Tiến độ làm bài">
          <Image className={styles.mascot} src="/illustrations/speaking-cat.svg" width={116} height={82} alt="" />
          <strong className={styles.questionCount}>Câu {String(current + 1).padStart(2, "0")} / {lesson.questions.length}</strong>
          <progress value={answered} max={lesson.questions.length} aria-label={`${answered}/${lesson.questions.length} câu đã làm`} />
          <span className={styles.timer}><Icon name="clock" />{grammarTime(elapsed)}</span>
        </section>

        <section className={`${styles.card} ${styles.exercise}`} aria-labelledby="grammar-question-heading">
          <div className={styles.exerciseMeta}><span className={styles.typeBadge}><Icon name={question.type === "error_correction" ? "search" : question.type === "fill_blank" ? "writing" : "compass"} />{questionLabels[question.type]}</span>
            {lesson.difficultyLevel && <span className={styles.level}><Icon name="trend" />CEFR {lesson.difficultyLevel}</span>}
            <span className={styles.accuracy}>Độ chính xác: <strong>{result ? `${result.result.score}%` : "Chưa chấm"}</strong></span>
          </div>
          {question.tag && <span className={styles.topicTag}><Icon name="bookmark" />{question.tag}</span>}
          <div className={styles.promptCard}><p>{instructions[question.type]}</p>
            <h2 id="grammar-question-heading" tabIndex={-1} ref={questionHeading} className={styles.prompt}>{question.prompt.split("[blank]").map((part, index) => <span key={index}>{index > 0 && <span className={styles.blank}>{blankValue || "…"}</span>}{part}</span>)}</h2>
          </div>
          <fieldset className={styles.answerField} disabled={locked}>
            <legend className={styles.srOnly}>Câu {current + 1}: {question.type === "fill_blank" ? "Nhập câu trả lời" : "Chọn một đáp án"}</legend>
            {question.type === "fill_blank" ? <label className={styles.fillAnswer}>Câu trả lời của bạn
              <input value={answer?.text ?? ""} maxLength={500} autoComplete="off" spellCheck={false} placeholder="Nhập đáp án…" lang="en"
                onChange={event => updateAnswer({ questionId: question.questionId, text: event.target.value })} />
            </label> : <div className={styles.options}>{question.options.map((option, index) => {
              const selected = answer?.optionIndex === index;
              const state = review ? review.correctOptionIndex === index ? "correct" : selected ? "incorrect" : undefined : undefined;
              return <label key={index} className={styles.option} data-selected={selected || undefined} data-result={state}>
                <input type="radio" name={`grammar-${question.questionId}`} checked={selected}
                  onChange={() => updateAnswer({ questionId: question.questionId, optionIndex: index })} />
                <span className={styles.optionLetter}>{String.fromCharCode(65 + index)}</span><span className={styles.optionText}>{option}</span>
                <span className={styles.optionMark} aria-hidden="true">{selected && <Icon name="check" />}</span>
              </label>;
            })}</div>}
          </fieldset>
          {review && <div className={styles.feedback} data-correct={review.correct}>
            <h3><Icon name={review.correct ? "check" : "bulb"} />{review.correct ? "Chính xác!" : review.submittedAnswer ? "Cùng xem lại câu này" : "Bạn chưa trả lời câu này"}</h3>
            {!review.correct && <p>Đáp án đúng: <strong>{review.correctAnswer}</strong></p>}
            {review.correction && <p>Cách sửa đúng: <strong>{review.correction}</strong></p>}
            {review.explanation && <p>{review.explanation}</p>}
          </div>}
          <div className={styles.questionNavigation}>
            <button className={styles.secondary} onClick={() => navigate(current - 1)} disabled={current === 0 || busy || paused || invalidSession}><span aria-hidden="true">←</span>Câu trước</button>
            {result && current === lesson.questions.length - 1 ? <Link className={styles.primary} href={`/courses/${lesson.courseId}`}>Về khóa học<Icon name="arrow" /></Link>
              : <button className={styles.primary} onClick={advance} disabled={!ready || busy || paused || invalidSession}>{nextLabel}<Icon name="chevron" /></button>}
          </div>
        </section>
      </div>

      <aside className={styles.sidebar} aria-label="Hỗ trợ làm bài">
        <section className={`${styles.card} ${styles.questionMap}`}>
          <div className={styles.sectionHeading}><h2><Icon name="dashboard" />Bản đồ câu hỏi</h2><span>{answered}/{lesson.questions.length} đã làm</span></div>
          <div className={styles.mapGrid}>{lesson.questions.map((item, index) => {
            const done = grammarAnswered(item, answers[item.questionId]);
            const checked = result?.review.find(entry => entry.questionId === item.questionId);
            return <button key={item.questionId} aria-current={index === current ? "step" : undefined}
              aria-label={`Câu ${index + 1}, ${checked ? checked.correct ? "đúng" : "sai" : done ? "đã làm" : "chưa làm"}`}
              data-done={done || undefined} data-result={checked ? checked.correct ? "correct" : "incorrect" : undefined}
              disabled={busy || paused || invalidSession} onClick={() => navigate(index)}>
              {String(index + 1).padStart(2, "0")}{done && <Icon name="check" />}
            </button>;
          })}</div>
          <div className={styles.mapLegend}><span><i data-state="done" />Đã làm</span><span><i data-state="active" />Đang làm</span><span><i />Chưa làm</span></div>
        </section>

        <section className={`${styles.card} ${styles.ruleCard}`} aria-labelledby="grammar-topic">
          <div className={styles.ruleInner}><h2 id="grammar-topic"><Icon name="bolt" /><span>{lesson.topic}</span></h2><GrammarRules text={lesson.rules} /></div>
        </section>

        <section className={`${styles.card} ${styles.notesCard}`}>
          <div className={styles.sectionHeading}><h2><Icon name="writing" /><label htmlFor="grammar-notes">Ghi chú của bạn</label></h2><span>{notes.length}/5000</span></div>
          <textarea id="grammar-notes" value={notes} maxLength={5000} disabled={!ready || invalidSession} onChange={event => setNotes(event.target.value)} placeholder="Thêm ghi chú về công thức, dấu hiệu nhận biết…" />
          <p>Ghi chú được lưu trên thiết bị này.</p>
        </section>
        {lesson.latestResult && !result && <p className={styles.latestResult}>Lần gần nhất: <strong>{lesson.latestResult.score}/100 điểm</strong> · Đúng {lesson.latestResult.correctAnswers}/{lesson.latestResult.totalQuestions} câu</p>}
      </aside>
    </div>

    <footer className={styles.taskbar} aria-label="Thanh tác vụ làm bài">
      <div className={styles.saveStatus} role="status"><Icon name="save" /><span>{invalidSession ? "Vui lòng đăng nhập lại" : storageStatus}</span></div>
      <div className={styles.taskbarActions}>
        {result ? <>
          <button className={styles.secondary} onClick={retry}><Icon name="replay" />Làm lại bài</button>
          <Link className={styles.primary} href={nextLesson ? grammarHref(lesson.courseId, nextLesson.lessonId) : `/courses/${lesson.courseId}`}>{nextLesson ? "Bài học tiếp theo" : "Về khóa học"}<Icon name="chevron" /></Link>
        </> : <>
          <button className={styles.secondary} disabled={locked || !answer} onClick={() => setAnswers(previous => {
            const updated = { ...previous }; delete updated[question.questionId]; return updated;
          })}><Icon name="replay" />Làm lại câu này</button>
          <button className={styles.primary} onClick={advance} disabled={!ready || busy || paused || invalidSession}>{busy ? "Đang chấm bài…" : nextLabel}<Icon name="chevron" /></button>
        </>}
      </div>
    </footer>

    <dialog className={styles.dialog} ref={dialog} onCancel={closeModal} onClose={() => { setModal(null); setPaused(false); }} aria-labelledby="grammar-dialog-heading">
      <div className={styles.dialogHeading}><h2 id="grammar-dialog-heading">{modal === "handbook" ? "Cẩm nang ngữ pháp" : modal === "pause" ? "Bài làm đang tạm dừng" : "Nộp bài ngữ pháp?"}</h2><button aria-label="Đóng" className={styles.closeButton} onClick={closeModal}><Icon name="close" /></button></div>
      {modal === "handbook" ? <div className={styles.handbook}><h3>{lesson.topic}</h3><GrammarRules text={lesson.rules} />{lesson.commonMistakes && <div className={styles.commonMistakes}><h3><Icon name="bulb" />Lỗi thường gặp & lưu ý</h3><GrammarRules text={lesson.commonMistakes} /></div>}</div>
        : modal === "pause" ? <><p>Đồng hồ đã dừng ở {grammarTime(elapsed)}. Bạn có thể tiếp tục khi sẵn sàng.</p><button className={styles.primary} onClick={closeModal}><Icon name="play" />Tiếp tục làm bài</button></>
          : <><p>Bạn đã trả lời <strong>{answered}/{lesson.questions.length}</strong> câu.{answered < lesson.questions.length && ` Còn ${lesson.questions.length - answered} câu chưa trả lời và sẽ được tính là sai.`}</p><p>Sau khi nộp, bạn có thể xem đáp án và giải thích từng câu.</p><div className={styles.dialogActions}><button className={styles.secondary} onClick={closeModal}>Tiếp tục làm bài</button><button className={styles.primary} disabled={busy} onClick={submit}>Nộp bài & xem kết quả<Icon name="check" /></button></div></>}
    </dialog>
  </main>;
}
