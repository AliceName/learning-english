"use client";
import {useId,useRef,useState} from "react";
import {readingFocus,type LessonDraft} from "@/lib/admin-courses";
import Icon from "@/components/site-icon";
import LessonRichText from "./lesson-rich-text";
import QuestionPreview from "./question-preview";
import styles from "./admin.module.css";

export default function ReadingPreview({lesson}:{lesson:LessonDraft}) {
  const reading=lesson.reading!;
  const [bilingual,setBilingual]=useState(false);
  const [font,setFont]=useState(100);
  const [review,setReview]=useState(false);
  const [results,setResults]=useState<Record<string,boolean>>({});
  const questionsRef=useRef<HTMLDivElement>(null);
  const id=useId();
  const signatures=reading.questions.map((question,index)=>`${index}:${JSON.stringify(question)}`);
  const checked=signatures.filter(signature=>results[signature]!==undefined).length;
  const correct=signatures.filter(signature=>results[signature]===true).length;
  return <div className={styles.readingSimulator}>
    <div className={styles.simulatorBar}><span><Icon name="book"/>LinguaAI Reading · {lesson.difficultyLevel}</span><span><Icon name="clock"/>{lesson.estimatedMinutes} phút</span></div>
    <div className={styles.readingTools}><div><button type="button" aria-label="Giảm cỡ chữ bài đọc" disabled={font<=85} onClick={()=>setFont(font-5)}>A−</button><span>Cỡ chữ {font}%</span><button type="button" aria-label="Tăng cỡ chữ bài đọc" disabled={font>=130} onClick={()=>setFont(font+5)}>A+</button></div><div><button type="button" aria-pressed={bilingual} disabled={!reading.translation?.trim()} title={reading.translation?.trim()?"Hiện bản dịch tham khảo":"Thêm bản dịch tham khảo trong phần nội dung bài đọc"} onClick={()=>setBilingual(!bilingual)}>Song ngữ</button><button type="button" onClick={()=>{setReview(!review);questionsRef.current?.scrollTo({top:0,behavior:"smooth"});}}>Review</button></div></div>
    <div className={styles.readingSplit}>
      <section className={styles.passagePane} aria-label="Bài đọc xem trước" style={{fontSize:`${font}%`}}>
        <div className={styles.passageHeading}><span className={styles.studioBadge}>{reading.category||"READING PASSAGE"}</span><h3>{reading.passageTitle||lesson.title||"Tiêu đề bài đọc"}</h3><p>Cuộn độc lập để tra cứu dữ kiện. Bấm từ được gạch chân để xem chú giải.</p></div>
        <LessonRichText text={reading.passage||"Thêm văn bản bài đọc để xem trước."} vocabulary={reading.vocabulary}/>
        {bilingual&&reading.translation&&<aside className={styles.translation}><strong>Bản dịch tham khảo</strong><LessonRichText text={reading.translation}/></aside>}
      </section>
      <div className={styles.questionsPane} ref={questionsRef} role="region" aria-label="Câu hỏi đọc hiểu xem trước" tabIndex={0}>
        <div className={styles.questionPaneHeading}><strong>{reading.questions.length} câu hỏi · Đã kiểm tra {checked}/{reading.questions.length}</strong><progress value={checked} max={Math.max(1,reading.questions.length)} aria-label="Tiến độ kiểm tra câu hỏi"/></div>
        {reading.instructions&&<p className={styles.hint}>{reading.instructions}</p>}
        {review&&<p role="status" className={styles.notice}>Đã kiểm tra {checked}/{reading.questions.length} câu. Trả lời đúng {correct} câu trong bản mô phỏng.</p>}
        {reading.questions.map((question,index)=><section key={signatures[index]} id={`${id}-${index}`} className={styles.readingPreviewQuestion}>
          <div className={styles.studioSectionLabel}><strong>Câu {index+1}</strong><span>{question.points??1} điểm</span></div><small className={styles.hint}>{readingFocus[question.focus]??readingFocus.scanning}</small>
          <QuestionPreview question={question} formatBlanks onChecked={result=>setResults(previous=>{const next={...previous};if(result===undefined)delete next[signatures[index]];else next[signatures[index]]=result;return next;})}/>
        </section>)}
        {!reading.questions.length&&<p className={styles.hint}>Thêm câu hỏi để kiểm thử tương tác.</p>}
      </div>
    </div>
    {!!reading.questions.length&&<nav className={styles.readingQuestionNav} aria-label="Chuyển câu hỏi xem trước">{reading.questions.map((question,index)=><a key={index} href={`#${id}-${index}`} onClick={event=>{event.preventDefault();questionsRef.current?.querySelectorAll("section")[index]?.scrollIntoView({behavior:"smooth",block:"nearest"});}} aria-label={`Đến câu ${index+1}`}>{index+1}</a>)}</nav>}
  </div>;
}
