"use client";

import { recordLearningInteraction, notifyLearningActivity } from "@/lib/learning-activity";
import Link from "next/link";
import { useState } from "react";
import { aiJson, aiRequest } from "@/lib/ai-courses";
import { useLessonSession } from "./lesson-session";
export { default as CourseReadingPractice } from "./reading-practice";
import { courseWordCount, textLessonPath, type CourseWritingResult, type WritingLesson } from "@/lib/course-text";
import styles from "./lessons.module.css";

function Expired() { return <main id="main-content" className={styles.page}><p role="alert">Phiên đăng nhập đã thay đổi. Hãy đăng nhập lại để tiếp tục.</p><Link href="/login">Đăng nhập</Link></main>; }

export function CourseWritingPractice({ lesson }: { lesson: WritingLesson }) {
  const { signal, invalid } = useLessonSession();
  const [text, setText] = useState(lesson.latestResult?.originalText ?? "");
  const [result, setResult] = useState<CourseWritingResult | null>(lesson.latestResult);
  const [corrections, setCorrections] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const words = courseWordCount(text);
  if (invalid) return <Expired />;
  async function submit() {
    setBusy(true); setError("");
    try {
      const value = await aiRequest<CourseWritingResult>(textLessonPath(lesson.courseId, lesson.lessonId, "writing") + "/submissions", {
        ...aiJson("POST", { contentVersion: lesson.contentVersion, originalText: text, corrections }), signal: signal.current?.signal,
      });
      if (!signal.current?.signal.aborted) { notifyLearningActivity(); setResult(value); }
    } catch (failure) { if (!signal.current?.signal.aborted) setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <main id="main-content" tabIndex={-1} className={styles.page}>
    <Link className={styles.back} href={`/courses/${lesson.courseId}`}>← {lesson.courseTitle}</Link>
    <header className={styles.hero}><span className={styles.badge}>WRITING · {lesson.difficultyLevel}</span><h1>{lesson.title}</h1><p>{lesson.topic} · {lesson.minWords}–{lesson.maxWords} từ</p></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.grid}><section className={styles.card}><h2>Đề bài</h2><p className={styles.passage} lang="en">{lesson.prompt}</p><p className={styles.passage}>{lesson.instructions}</p><h3>Tiêu chí bài viết</h3><ul>{lesson.rubric.map((item, index) => <li key={index}><b>{item.name} · {item.weight}%</b><p>{item.description}</p></li>)}</ul></section>
      <form className={styles.card} onSubmit={event => { event.preventDefault(); void submit(); }}><fieldset disabled={busy} className={styles.fields}><label>Bài viết của bạn<textarea required rows={14} maxLength={12000} value={text} onChange={event => { const value = event.target.value; setText(value); if (value.trim()) void recordLearningInteraction("writing"); }} placeholder="Write your answer here…" lang="en" /></label><p className={styles.wordCount} aria-live="polite">{words} từ · Yêu cầu {lesson.minWords}–{lesson.maxWords} từ</p><label className={styles.option}><input type="checkbox" checked={corrections} onChange={event => setCorrections(event.target.checked)} />Kèm gợi ý sửa lỗi ngữ pháp</label><button type="submit" disabled={busy || words < lesson.minWords || words > lesson.maxWords} className={styles.primary}>{busy ? "Đang phân tích bài viết…" : "Lưu bài & phân tích CEFR"}</button></fieldset></form>
    </div>
    {result && <section className={styles.card} aria-label="Kết quả bài viết"><span className={styles.badge}>BÀI VIẾT ĐÃ LƯU</span><h2>Ước lượng CEFR: {result.cefrLevel}</h2><p>Đã lưu lần nộp #{result.submissionId}. Bạn có thể sửa bài và nộp lại.</p>{result.warnings.map((warning, index) => <p className={styles.notice} key={index}>{warning}</p>)}{result.correctedText && <><h3>Bản gợi ý chỉnh sửa</h3><p className={styles.passage} lang="en">{result.correctedText}</p></>}{result.errors.length > 0 && <ul>{result.errors.map((item, index) => <li key={index}>{item.original} → <b>{item.suggestion}</b></li>)}</ul>}<details><summary>Bài viết tham khảo</summary><p className={styles.passage} lang="en">{result.sampleAnswer}</p></details></section>}
  </main>;
}
