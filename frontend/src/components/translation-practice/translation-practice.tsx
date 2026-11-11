"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Icon from "@/components/site-icon";
import styles from "./translation-practice.module.css";

const levels = ["A1", "A2", "B1"] as const;
type Level = (typeof levels)[number];
type Selection = { level: Level; review: boolean; requestId?: string };
type Prompt = { promptId: number; topic: string; vietnameseText: string; attemptToken: string };
type Grade = {
  status: "approved" | "scored";
  score: number | null;
  meaningCorrect: boolean;
  grammarCorrect: boolean;
  feedback: string;
  correctedText: string | null;
  correctionExplanation?: string | null;
  alternative?: { text: string; explanation: string } | null;
  scores: { meaning: number; grammar: number; naturalness: number } | null;
  issues: { original: string; suggestion: string; explanation: string }[];
  examples: string[];
  candidateStatus: "none" | "pending" | "unavailable";
};
type Failure = { title: string; code?: string; retryAfter?: number };

const maxAnswer = 500;
const sessionGoal = 15;

async function send<T>(action: "next" | "grade", payload: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/translation-practice/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal,
  });
  if (response.ok) return await response.json() as T;
  const problem = await response.json().catch(() => null) as Failure | null;
  const retryAfter = Number(response.headers.get("retry-after"));
  throw { title: problem?.title ?? "Chưa kết nối được. Vui lòng thử lại.", code: problem?.code, retryAfter } satisfies Failure;
}

function describeError(error: unknown): Failure {
  if (typeof error === "object" && error !== null && "title" in error && typeof error.title === "string") return error as Failure;
  return { title: "Chưa kết nối được. Vui lòng thử lại." };
}

function normalizeExample(value: string) {
  return value.trim().normalize().replace(/\s+/g, " ");
}

export default function TranslationPractice() {
  const [selection, setSelection] = useState<Selection>({ level: "A2", review: false });
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [promptError, setPromptError] = useState<Failure | null>(null);
  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<Failure | null>(null);
  const [done, setDone] = useState<Set<number>>(() => new Set());
  const [speechMessage, setSpeechMessage] = useState("");
  const initialId = useRef<string | null>(null);
  const gradeRequest = useRef<{ key: string; id: string } | null>(null);
  const gradeInFlight = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = selection.requestId ?? (initialId.current ??= crypto.randomUUID());
    void send<Prompt>("next", { level: selection.level, review: selection.review, requestId }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setPrompt(value); })
      .catch(error => { if (!controller.signal.aborted) setPromptError(describeError(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selection]);

  function selectNext(level = selection.level, review = selection.review, retry = false) {
    if (gradeInFlight.current) return;
    setLoading(true);
    setPrompt(null);
    setPromptError(null);
    setAnswer("");
    setGrade(null);
    setGradeError(null);
    setSpeechMessage("");
    window.speechSynthesis?.cancel();
    gradeRequest.current = null;
    setSelection({ level, review, requestId: retry ? selection.requestId ?? initialId.current ?? undefined : crypto.randomUUID() });
  }

  async function submit(includeAiFeedback = false) {
    if (!prompt || !answer.trim() || gradeInFlight.current) return;
    gradeInFlight.current = true;
    setGradeError(null);
    setGrading(true);
    const key = JSON.stringify([prompt.attemptToken, answer, includeAiFeedback]);
    if (gradeRequest.current?.key !== key) gradeRequest.current = { key, id: crypto.randomUUID() };
    try {
      const result = await send<Grade>("grade", { attemptToken: prompt.attemptToken, answer,
        requestId: gradeRequest.current.id, includeAiFeedback });
      setGrade(result);
      setDone(previous => previous.has(prompt.promptId) ? previous : new Set(previous).add(prompt.promptId));
    } catch (error) {
      setGradeError(describeError(error));
    } finally {
      gradeInFlight.current = false;
      setGrading(false);
    }
  }

  function updateAnswer(value: string) {
    setAnswer(value);
    setGrade(null);
    setGradeError(null);
    gradeRequest.current = null;
  }

  function speak(value: string, language: "vi-VN" | "en-US") {
    setSpeechMessage("");
    if (!("speechSynthesis" in window)) {
      setSpeechMessage("Trình duyệt này chưa hỗ trợ đọc câu.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.lang = language;
    const voice = window.speechSynthesis.getVoices().find(item => item.lang.slice(0, 2) === language.slice(0, 2));
    if (voice) utterance.voice = voice;
    utterance.onerror = event => {
      if (event.error !== "interrupted" && event.error !== "canceled")
        setSpeechMessage("Chưa thể đọc câu. Hãy kiểm tra giọng đọc trên thiết bị.");
    };
    window.speechSynthesis.speak(utterance);
  }

  function gradeForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return <main id="main-content" tabIndex={-1} className={styles.page}>
    <header className={styles.hero}>
      <nav aria-label="Vị trí trang" className={styles.breadcrumb}>
        <Link href="/account" aria-label="Tổng quan"><Icon name="home" /></Link><Icon name="chevron" />
        <span aria-current="page">Luyện phiên dịch</span>
      </nav>
      <div className={styles.heroTitle}>
        <span className={styles.heroIcon}><Icon name="translate" /></span>
        <div><h1>Phản xạ dịch</h1><p>Rèn phản xạ dịch Việt → Anh chính xác và tự nhiên theo từng trình độ.</p></div>
      </div>
      <Image className={styles.mascot} src="/illustrations/speaking-reading-cat.webp" width={210} height={174} alt="" priority />
    </header>

    <section aria-label="Trình độ và tiến độ" className={styles.toolbar}>
      <div className={styles.levels} aria-label="Cấp độ" role="group">
        {levels.map(level => <button type="button" key={level} aria-pressed={selection.level === level}
          disabled={grading} onClick={() => { if (level !== selection.level) selectNext(level, false); }}>{level}</button>)}
      </div>
      {selection.review && <button className={styles.secondary} type="button" disabled={grading || loading}
        onClick={() => selectNext(selection.level, false)}>Kết thúc ôn lại</button>}
      <div className={styles.progress}><span>Tiến độ phiên <strong>{Math.min(done.size, sessionGoal)}/{sessionGoal}</strong> câu</span>
        <progress aria-label="Tiến độ phiên" max={sessionGoal} value={Math.min(done.size, sessionGoal)} /></div>
    </section>

    <div className={styles.columns}>
      <div className={styles.exercise}>
        <section aria-labelledby="prompt-heading" className={`${styles.card} ${styles.prompt}`} aria-busy={loading}>
          <div className={styles.row}><h2 id="prompt-heading" className={styles.eyebrow}>{prompt?.topic ?? "Câu tiếng Việt"}</h2>
            {prompt && <button type="button" className={styles.iconButton} aria-label="Nghe câu tiếng Việt"
              onClick={() => speak(prompt.vietnameseText, "vi-VN")}><Icon name="volume" /></button>}</div>
          {loading && <p className={styles.muted} role="status">Đang lấy câu luyện…</p>}
          {prompt && <p className={styles.question} lang="vi">“{prompt.vietnameseText}”</p>}
          {promptError && <div className={styles.notice} role="status"><p>{promptError.title}</p>
            {promptError.code === "review_available"
              ? <button className={styles.primary} type="button" onClick={() => selectNext(selection.level, true)}>Ôn lại</button>
              : <button className={styles.secondary} type="button" onClick={() => selectNext(selection.level, selection.review, true)}>Thử lại</button>}
          </div>}
        </section>

        <form className={`${styles.card} ${styles.form}`} onSubmit={gradeForm}>
          <div className={styles.row}><label htmlFor="translation-answer"><Icon name="writing" /> Bản dịch tiếng Anh</label>
            <span className={styles.counter} id="translation-count">{answer.length} / {maxAnswer} ký tự</span></div>
          <textarea id="translation-answer" ref={textarea} lang="en" rows={4} spellCheck={false} maxLength={maxAnswer}
            placeholder="Viết bản dịch của bạn ở đây…" value={answer} disabled={!prompt || grading}
            aria-describedby="translation-count" onChange={event => updateAnswer(event.target.value)} />
          <div className={styles.actions}>
            <button className={styles.secondary} type="button" disabled={!answer || grading} onClick={() => { updateAnswer(""); textarea.current?.focus(); }}>
              <Icon name="trash" /> Xóa</button>
            <button className={styles.secondary} type="button" disabled={!prompt || loading || grading} onClick={() => selectNext()}>
              <Icon name="translate" /> Đổi câu</button>
            <button className={styles.primary} type="submit" disabled={!prompt || !answer.trim() || grading}>{grading ? "Đang chấm…" : "Chấm câu"}</button>
          </div>
          {speechMessage && <p role="status" className={styles.muted}>{speechMessage}</p>}
        </form>
      </div>

      <section className={`${styles.card} ${styles.results}`} aria-labelledby="result-heading" aria-busy={grading}>
        <h2 id="result-heading">Kết quả bản dịch</h2>
        {gradeError && <div className={styles.warning} role="alert">
          <strong>Chưa chấm được</strong><p>{gradeError.title}</p>
          {!!gradeError.retryAfter && <p>Hãy thử lại sau khoảng {Math.ceil(gradeError.retryAfter / 60)} phút.</p>}
        </div>}
        {!grade && !gradeError && <div className={styles.empty}><span><Icon name={grading ? "clock" : "clipboard"} /></span>
          <p role="status">{grading ? "Đang đối chiếu bản dịch của bạn…" : "Phản hồi sẽ xuất hiện sau khi bạn chấm câu."}</p></div>}
        {grade && <div className={styles.feedback} role="status">
          <div className={styles.scoreRow}>
            <span className={grade.meaningCorrect && grade.grammarCorrect ? styles.scoreGood : styles.scoreOther}>
              {grade.score ?? <Icon name="check" />}
            </span>
            <div><strong>{grade.meaningCorrect && grade.grammarCorrect ? "Đúng nghĩa và ngữ pháp" : "Xem lại bản dịch"}</strong>
              <p>{grade.feedback}</p></div>
          </div>
          {grade.scores && <dl className={styles.scores}>
            <div><dt>Đúng nghĩa</dt><dd>{grade.scores.meaning}/60</dd></div>
            <div><dt>Ngữ pháp</dt><dd>{grade.scores.grammar}/25</dd></div>
            <div><dt>Tự nhiên</dt><dd>{grade.scores.naturalness}/15</dd></div>
          </dl>}
          {grade.correctedText && grade.correctedText !== answer.trim() && <section className={styles.correction}>
            <h3>Bản dịch đã chỉnh sửa</h3>
            <p lang="en" className={styles.revisedSentence}>{grade.correctedText}</p>
            {grade.correctionExplanation && <p><strong>Vì sao sửa như vậy?</strong> {grade.correctionExplanation}</p>}
          </section>}
          {grade.alternative && <section className={`${styles.correction} ${styles.alternative}`}>
            <h3>Gợi ý cách diễn đạt khác</h3>
            <p lang="en" className={styles.revisedSentence}>{grade.alternative.text}</p>
            <p><strong>Khi nào nên dùng?</strong> {grade.alternative.explanation}</p>
          </section>}
          {grade.issues.length > 0 && <ul className={styles.issues}>{grade.issues.map((issue, index) => <li key={index}>
            <strong>{issue.suggestion ? <span lang="en">{issue.original ? `${issue.original} → ` : ""}{issue.suggestion}</span>
              : <>Bỏ <span lang="en">{issue.original}</span></>}</strong><p>{issue.explanation}</p>
          </li>)}</ul>}
          {grade.examples.length > 0 && <div className={styles.examples}><h3>Các cách dịch đúng</h3><ol>
            {grade.examples.map(example => {
              const matchesAnswer = normalizeExample(example) === normalizeExample(answer);
              return <li key={example} className={matchesAnswer ? styles.matchedExample : undefined}>
                <span><span lang="en">{example}</span>{matchesAnswer && <small>Bạn</small>}</span>
                <button className={styles.iconButton} type="button" aria-label={`Nghe câu tiếng Anh: ${example}`}
                  onClick={() => speak(example, "en-US")}><Icon name="volume" /></button>
              </li>;
            })}
          </ol></div>}
          {grade.candidateStatus === "pending" && <p className={styles.muted}>Bản dịch của bạn đang chờ duyệt để đưa vào kho dùng chung.</p>}
          {grade.candidateStatus === "unavailable" && <p className={styles.muted}>Chưa lưu được bản dịch vào hàng chờ duyệt.</p>}
          {grade.status === "approved" && <button type="button" className={styles.secondary} disabled={grading}
            onClick={() => void submit(true)}><Icon name="sparkles" /> Chấm chi tiết bằng AI</button>}
          <div className={styles.resultActions}>
            <button type="button" className={styles.secondary} disabled={grading} onClick={() => { setGradeError(null); textarea.current?.focus(); }}>
              Sửa bài</button>
            <button type="button" className={styles.primary} disabled={grading} onClick={() => selectNext()}>
              Câu tiếp theo <Icon name="arrow" /></button>
          </div>
        </div>}
      </section>
    </div>
  </main>;
}
