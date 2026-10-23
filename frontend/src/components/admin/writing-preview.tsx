"use client";
import {useState} from "react";
import {countWords,writingTaskTypes,type LessonDraft} from "@/lib/admin-courses";
import {lessonPlainText} from "@/lib/lesson-text";
import Icon from "@/components/site-icon";
import FormattedTextEditor from "./formatted-text-editor";
import LessonRichText from "./lesson-rich-text";
import styles from "./admin.module.css";

export default function WritingPreview({lesson}:{lesson:LessonDraft}) {
  const [answer,setAnswer]=useState("");
  const [checked,setChecked]=useState(false);
  const writing=lesson.writing!;
  const words=countWords(lessonPlainText(answer));
  const enough=words>=writing.minWords&&words<=writing.maxWords;
  return <div className={styles.writingSimulator}>
    <div className={styles.simulatorBar}><span><Icon name="writing"/>Writing Practice · {lesson.difficultyLevel}</span><span><Icon name="clock"/>{lesson.estimatedMinutes} phút</span></div>
    <div className={styles.simulatorPrompt}><span className={styles.studioBadge}>{writingTaskTypes[writing.taskType]}</span><h3>{writing.topic||lesson.title||"Chủ đề bài viết"}</h3><LessonRichText text={writing.prompt||"Thêm đề bài để xem trước."}/>
      {writing.instructions&&<aside className={styles.guidingTips}><strong>Gợi ý & hướng dẫn</strong><LessonRichText text={writing.instructions}/></aside>}
    </div>
    <div className={styles.simulatorAnswer}>
      <div className={styles.studioSectionLabel}><strong>Bài viết thử</strong><span aria-live="polite">{words} / {writing.maxWords} từ</span></div>
      <FormattedTextEditor label="Nội dung bài viết thử" value={answer} onChange={text=>{setAnswer(text);setChecked(false);}} rows={9} maxLength={40000} placeholder="Write your answer here…"/>
      <div className={styles.simulatorActions}><button type="button" className={styles.secondaryButton} disabled title="Chưa kết nối dịch vụ AI"><Icon name="brain"/>Kiểm tra ngữ pháp AI</button><button type="button" className={styles.primaryButton} onClick={()=>setChecked(true)}>Kiểm tra độ dài bài viết</button></div>
      <p className={styles.hint}>Yêu cầu {writing.minWords}–{writing.maxWords} từ. Bài viết thử chỉ dùng để mô phỏng, không lưu thành bài nộp.</p>
      {checked&&<p role="status" className={enough?styles.success:styles.notice}>{enough?"Độ dài bài viết phù hợp.":words<writing.minWords?`Cần viết thêm ít nhất ${writing.minWords-words} từ.`:`Bài viết vượt ${words-writing.maxWords} từ so với giới hạn.`}</p>}
    </div>
    {!!writing.rubric.length&&<details className={styles.simulatorDetails}><summary>Tiêu chí đánh giá</summary><ul className={styles.previewRubric}>{writing.rubric.map((item,index)=><li key={index}><strong>{item.name} · {item.weight}%</strong><p>{item.description}</p></li>)}</ul></details>}
    {writing.sampleAnswer&&<details className={styles.simulatorDetails}><summary>Xem bài viết mẫu</summary><LessonRichText text={writing.sampleAnswer}/></details>}
    <aside className={styles.aiUnavailable}><Icon name="sparkles"/><div><strong>AI Diagnostics & Vocabulary Uplift</strong><p>Chưa tích hợp dịch vụ chấm điểm, kiểm tra ngữ pháp và gợi ý từ vựng AI.</p></div></aside>
  </div>;
}
