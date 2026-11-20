"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Icon from "@/components/site-icon";
import LessonRichText from "@/components/admin/lesson-rich-text";
import { aiJson, aiRequest } from "@/lib/ai-courses";
import { courseWordCount, readingAnswered, textLessonPath, type ReadingAnswer, type ReadingLesson, type ReadingResult } from "@/lib/course-text";
import { lessonPlainText } from "@/lib/lesson-text";
import { courseFlashcardsHref } from "@/lib/course-flashcards";
import { useLessonSession } from "./lesson-session";
import { readingAnnotationKey } from "@/lib/reading-annotations";
import { AnnotatedReadingText, ReadingAnnotations, ReadingAnnotationToolbar } from "./reading-annotations";
import styles from "./reading.module.css";

const focusLabels: Record<string, string> = { skimming: "Đọc lấy ý chính", scanning: "Đọc tìm thông tin", inference: "Suy luận", vocabulary: "Từ vựng" };
const typeLabels: Record<string, string> = { multiple_choice: "Chọn một đáp án", fill_blank: "Điền từ", short_answer: "Trả lời ngắn", true_false_not_given: "True / False / Not Given", matching: "Nối thông tin" };

function PassageImage({ lesson }: { lesson: ReadingLesson }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const src = lesson.imageUrl?.trim();
  if (!src) return null;
  const valid = /^https?:\/\//i.test(src) || /^\/api\/media\/[a-f0-9]{32}\.(png|jpe?g|webp)$/i.test(src);
  const alt = lesson.imageAlt?.trim() || lesson.passageTitle || lesson.title;
  return <figure className={styles.image}>
    {failed || !valid ? <div className={styles.imageError} role="status">
      <Icon name="file" /><p>Chưa tải được ảnh minh họa.</p><span>{alt}</span>
      {valid && <button type="button" onClick={() => { setAttempt(value => value + 1); setFailed(false); }}>Thử tải lại ảnh</button>}
    </div> : <div className={styles.imageFrame}>
      <Image key={attempt} src={src} alt={alt} fill unoptimized sizes="(max-width: 1000px) 100vw, 45vw" onError={() => setFailed(true)} />
      <button className={styles.enlarge} type="button" onClick={() => dialog.current?.showModal()}><Icon name="search" />Phóng to ảnh</button>
    </div>}
    {lesson.imageCaption && <figcaption>{lesson.imageCaption}</figcaption>}
    <dialog ref={dialog} className={styles.imageDialog} aria-labelledby={headingId} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className={styles.dialogHeader}><h2 id={headingId}>Ảnh minh họa bài đọc</h2><button type="button" aria-label="Đóng ảnh phóng to" onClick={() => dialog.current?.close()}><Icon name="close" /></button></div>
      {valid && <Image src={src} alt={alt} width={1600} height={1000} unoptimized className={styles.fullImage} />}
      {lesson.imageCaption && <p>{lesson.imageCaption}</p>}
    </dialog>
  </figure>;
}

export default function CourseReadingPractice({ lesson, userId }: { lesson: ReadingLesson; userId: number }) {
  const { signal, invalid } = useLessonSession();
  const [answers, setAnswers] = useState<Record<number, ReadingAnswer>>({});
  const [result, setResult] = useState<ReadingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmMissing, setConfirmMissing] = useState(false);
  const [font, setFont] = useState(16);
  const [bilingual, setBilingual] = useState(false);
  const start = useRef(0);
  const sending = useRef(false);
  const resultPanel = useRef<HTMLElement>(null);
  const id = useId();
  const answered = lesson.questions.filter(question => readingAnswered(question, answers[question.questionId])).length;
  const missing = lesson.questions.length - answered;
  const translation = result?.translation || lesson.translation;
  const words = courseWordCount(lessonPlainText(lesson.passage));

  useEffect(() => { start.current = performance.now(); }, []);
  useEffect(() => { if (result) resultPanel.current?.focus(); }, [result]);
  useEffect(() => {
    if (!Object.keys(answers).length || result || invalid) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [answers, result, invalid]);

  function update(questionId: number, change: Partial<ReadingAnswer>) {
    setAnswers(current => ({ ...current, [questionId]: { ...(current[questionId] ?? { questionId, matches: [] }), ...change } }));
    setConfirmMissing(false);
  }
  async function submit() {
    if (sending.current || signal.current?.signal.aborted) return;
    sending.current = true;
    setBusy(true); setError(""); setConfirmMissing(false);
    try {
      const value = await aiRequest<ReadingResult>(textLessonPath(lesson.courseId, lesson.lessonId, "reading") + "/submissions", {
        ...aiJson("POST", { contentVersion: lesson.contentVersion, answers: Object.values(answers), timeSpentSeconds: Math.min(86400, Math.max(0, Math.floor((performance.now() - start.current) / 1000))) }),
        signal: signal.current?.signal,
      });
      if (!signal.current?.signal.aborted) setResult(value);
    } catch (failure) {
      if (!signal.current?.signal.aborted) setError(failure instanceof Error ? failure.message : "Chưa nộp được bài đọc. Hãy thử lại.");
    } finally { sending.current = false; setBusy(false); }
  }
  function requestSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || result) return;
    if (missing) setConfirmMissing(true);
    else void submit();
  }
  function retry() {
    setResult(null); setAnswers({}); setError(""); setConfirmMissing(false); setBilingual(false);
    start.current = performance.now();
  }
  function goToQuestion(questionId: number) {
    document.getElementById(`${id}-question-${questionId}`)?.focus();
  }

  if (invalid) return <main id="main-content" className={styles.page}><p role="alert">Phiên đăng nhập đã thay đổi. Hãy đăng nhập lại để tiếp tục.</p><Link href="/login">Đăng nhập</Link></main>;

  return <ReadingAnnotations key={`${userId}:${lesson.courseId}:${lesson.lessonId}:${lesson.contentVersion}`} storageKey={readingAnnotationKey(userId, lesson.courseId, lesson.lessonId, lesson.contentVersion)}><main id="main-content" tabIndex={-1} className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Đường dẫn"><Link href="/courses">Khóa học</Link><Icon name="chevron" /><Link href={`/courses/${lesson.courseId}`}>{lesson.courseTitle}</Link><Icon name="chevron" /><span>Reading</span></nav>
    <header className={styles.header}>
      <div className={styles.heading}><span className={styles.bookIcon}><Icon name="book" /></span><div><span className={styles.eyebrow}>READING PRACTICE</span><h1>{lesson.title}</h1><p>Đọc hiểu và khám phá từ vựng trong ngữ cảnh.</p></div></div>
      <Link href={`/courses/${lesson.courseId}`} className={styles.back}>← Về khóa học</Link>
    </header>
    <div className={styles.overview}>
      <div><span className={styles.level}>{lesson.difficultyLevel || "Reading"}</span><span><Icon name="file" />{words} từ</span><span><Icon name="clipboard" />{lesson.questions.length} câu hỏi</span>{!!lesson.estimatedMinutes && <span><Icon name="clock" />{lesson.estimatedMinutes} phút</span>}</div>
      {lesson.latestResult && <span className={styles.lastResult}><Icon name="trend" />Gần nhất: <b>{lesson.latestResult.score}/100</b></span>}
    </div>
    {error && <p role="alert" className={styles.error}>{error} Câu trả lời của bạn vẫn được giữ.</p>}
    {result && <section className={styles.result} ref={resultPanel} tabIndex={-1} aria-label="Kết quả bài đọc">
      <div className={styles.score}>{result.result.score}<small>/100</small></div><div><span className={styles.eyebrow}>ĐÃ HOÀN THÀNH BÀI ĐỌC</span><h2>Đúng {result.result.correctAnswers}/{result.result.totalQuestions} câu hỏi</h2><p>Xem đáp án và giải thích bên dưới để hiểu bài hơn.</p></div><button type="button" className={styles.secondary} onClick={retry}><Icon name="replay" />Làm lại bài đọc</button>
    </section>}
    <form className={styles.workspace} onSubmit={requestSubmit} aria-label="Bài tập đọc hiểu">
      <div className={styles.toolbar}>
        <span className={styles.workspaceTitle}><Icon name="book" />Không gian đọc hiểu</span>
        <div className={styles.tools}><div className={styles.fontControl}><button type="button" aria-label="Giảm cỡ chữ bài đọc" disabled={font <= 14} onClick={() => setFont(value => value - 1)}>A−</button><span>{font}px</span><button type="button" aria-label="Tăng cỡ chữ bài đọc" disabled={font >= 22} onClick={() => setFont(value => value + 1)}>A+</button></div><button type="button" className={styles.translationButton} aria-pressed={bilingual && !!translation} disabled={!translation} title={translation ? "Xem bản dịch tham khảo" : "Bản dịch được mở sau khi nộp bài"} onClick={() => setBilingual(value => !value)}><Icon name="translate" />Bản dịch</button></div>
      </div>
      <ReadingAnnotationToolbar />
      <div className={styles.split}>
        <article className={styles.passagePane} aria-label="Bài đọc" tabIndex={0}>
          <span className={styles.eyebrow}>{lesson.category || "READING PASSAGE"}</span><AnnotatedReadingText region="title"><h2 className={styles.passageTitle}>{lesson.passageTitle || lesson.title}</h2></AnnotatedReadingText>
          <p className={styles.readingHint}><Icon name="bulb" />Bấm vào từ được gạch chân để xem nghĩa.</p>
          <PassageImage key={lesson.imageUrl} lesson={lesson} />
          <AnnotatedReadingText region="passage" className={styles.passageText} style={{ fontSize: font }}><LessonRichText text={lesson.passage} vocabulary={lesson.vocabulary} /></AnnotatedReadingText>
          {bilingual && translation && <aside className={styles.translation} aria-label="Bản dịch tham khảo"><h3><Icon name="translate" />Bản dịch tham khảo</h3><LessonRichText text={translation} /></aside>}
          {!!lesson.vocabulary.length && <><Link className={styles.flashcardsLink} href={courseFlashcardsHref(lesson.courseId, lesson.lessonId)}><Icon name="cards" />Ôn từ vựng bằng Flashcards<Icon name="arrow" /></Link><details className={styles.vocabulary}><summary>Từ vựng trong bài <span>{lesson.vocabulary.length} từ</span></summary><dl>{lesson.vocabulary.map((item, index) => <div key={index}><dt lang="en">{item.word}</dt><dd>{item.meaning}{item.example && <p lang="en">{item.example}</p>}</dd></div>)}</dl></details></>}
        </article>
        <section className={styles.questionsPane} aria-label="Câu hỏi đọc hiểu">
          <div className={styles.questionHeader}><div><h2>Câu hỏi đọc hiểu</h2><span aria-live="polite">{result ? `Đúng ${result.result.correctAnswers}/${lesson.questions.length} câu` : `Đã trả lời ${answered}/${lesson.questions.length} câu`}</span></div><nav className={styles.questionNav} aria-label="Chuyển đến câu hỏi">{lesson.questions.map((question, index) => {
            const review = result?.review.find(item => item.questionId === question.questionId);
            return <button key={question.questionId} type="button" data-state={review ? review.correct ? "correct" : "incorrect" : readingAnswered(question, answers[question.questionId]) ? "answered" : "empty"} aria-label={`Câu ${index + 1}: ${review ? review.correct ? "đúng" : "sai" : readingAnswered(question, answers[question.questionId]) ? "đã trả lời" : "chưa trả lời"}`} onClick={() => goToQuestion(question.questionId)}>{index + 1}</button>;
          })}</nav></div>
          <div className={styles.questionList}>
            {lesson.instructions && <div className={styles.instructions}><strong>Hướng dẫn làm bài</strong><AnnotatedReadingText region="instructions"><p>{lesson.instructions}</p></AnnotatedReadingText></div>}
            {lesson.questions.map((question, index) => {
              const answer = answers[question.questionId];
              const review = result?.review.find(item => item.questionId === question.questionId);
              const questionId = `${id}-question-${question.questionId}`;
              return <article key={question.questionId} id={questionId} tabIndex={-1} className={styles.question}>
                <div className={styles.questionMeta}><span>CÂU {String(index + 1).padStart(2, "0")}<small>{focusLabels[question.focus] || typeLabels[question.type]}</small></span><b>{question.points} điểm</b></div>
                <AnnotatedReadingText region={`question-${question.questionId}`}><h3 id={`${questionId}-title`} lang="en">{question.prompt.replaceAll("[blank]", "…………")}</h3></AnnotatedReadingText>
                <p className={styles.questionType}>{typeLabels[question.type]}</p>
                <fieldset disabled={busy || !!result} className={styles.fields} aria-labelledby={`${questionId}-title`}>
                  {question.options.length > 0 ? question.options.map((option, optionIndex) => {
                    const optionId = `${questionId}-option-${optionIndex}`;
                    return <AnnotatedReadingText key={optionIndex} region={`option-${question.questionId}-${optionIndex}`} className={styles.option} textClassName={styles.optionContent} onActivate={() => { if (!busy && !result) update(question.questionId, { optionIndex }); }}>
                      <input type="radio" id={optionId} name={`${id}-${question.questionId}`} checked={answer?.optionIndex === optionIndex} onChange={() => update(question.questionId, { optionIndex })} /><label htmlFor={optionId} className={styles.optionLetter} data-annotation-ignore>{String.fromCharCode(65 + optionIndex)}</label><label htmlFor={optionId} className={styles.optionText}>{option}</label>
                    </AnnotatedReadingText>;
                  }) : question.type === "matching" ? question.matchingLeft.map((left, leftIndex) => <label className={styles.match} key={leftIndex}><span lang="en">{left}</span><select aria-label={`Câu ${index + 1}: ${left}`} value={answer?.matches.find(match => match.leftIndex === leftIndex)?.rightId ?? ""} onChange={event => update(question.questionId, { matches: [...(answer?.matches ?? []).filter(match => match.leftIndex !== leftIndex), ...(event.target.value ? [{ leftIndex, rightId: event.target.value }] : [])] })}><option value="">Chọn ý phù hợp</option>{question.matchingRight.map(item => <option key={item.id} value={item.id}>{item.text}</option>)}</select></label>)
                    : <label className={styles.textAnswer}><span className={styles.srOnly}>Câu trả lời câu {index + 1}</span><input type="text" maxLength={500} autoComplete="off" placeholder="Nhập câu trả lời của bạn…" value={answer?.text ?? ""} onChange={event => update(question.questionId, { text: event.target.value })} /></label>}
                </fieldset>
                {review && <div className={styles.review} data-correct={review.correct}><strong><Icon name={review.correct ? "check" : "close"} />{review.correct ? "Chính xác" : "Chưa chính xác"}</strong><p>Bạn trả lời: {review.submittedAnswer || "Bỏ trống"}</p><p>Đáp án: <b>{review.correctAnswer}</b></p>{review.explanation && <p>{review.explanation}</p>}</div>}
              </article>;
            })}
          </div>
        </section>
      </div>
      {confirmMissing && <div className={styles.confirm} role="alert"><div><strong>Bạn còn {missing} câu chưa hoàn thành.</strong><p>Câu bỏ trống sẽ được tính là sai.</p></div><button type="button" className={styles.secondary} onClick={() => { setConfirmMissing(false); const first = lesson.questions.find(question => !readingAnswered(question, answers[question.questionId])); if (first) goToQuestion(first.questionId); }}>Tiếp tục làm bài</button><button type="button" className={styles.primary} onClick={() => void submit()}>Vẫn nộp bài</button></div>}
      <footer className={styles.footer}><div className={styles.progress}><span>{result ? "Đã nộp bài đọc" : `Tiến độ làm bài: ${answered}/${lesson.questions.length} câu`}</span><progress value={result ? lesson.questions.length : answered} max={Math.max(1, lesson.questions.length)} aria-label="Tiến độ làm bài đọc" /></div>{result ? <button type="button" className={styles.primary} onClick={retry}><Icon name="replay" />Làm lại bài đọc</button> : <button disabled={busy} className={styles.primary} type="submit"><Icon name="check" />{busy ? "Đang chấm bài…" : "Nộp bài & xem kết quả"}</button>}</footer>
    </form>
  </main></ReadingAnnotations>;
}
