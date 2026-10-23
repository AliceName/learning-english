"use client";
import {useState} from "react";
import {lessonKinds, type LessonDraft} from "@/lib/admin-courses";
import Icon from "@/components/site-icon";
import WritingPreview from "./writing-preview";
import ReadingPreview from "./reading-preview";
import QuestionPreview from "./question-preview";
import styles from "./admin.module.css";


function GrammarNotes({text}:{text:string}) {
  // A deliberately small, safe format: line breaks and inline code. No raw HTML rendering.
  return <div className={styles.grammarRules}>{text.split(/(`[^`]+`)/g).map((part,index)=>part.startsWith("`")&&part.endsWith("`")
    ?<code key={index}>{part.slice(1,-1)}</code>:<span key={index}>{part}</span>)}</div>;
}

export default function LessonPreview({lesson}:{lesson:LessonDraft}) {
  const [index,setIndex]=useState(0);
  const [notice,setNotice]=useState("");
  const sentences=lesson.speaking?.sentences??[];
  const questions=lesson.skillType==="grammar"?lesson.grammar?.questions??[]:lesson.skillType==="reading"?lesson.reading?.questions??[]:lesson.listening?.questions??[];
  const count=lesson.skillType==="speaking"?sentences.length:questions.length;
  const current=Math.min(index,Math.max(0,count-1));
  const selected=sentences[current];
  const question=questions[current];
  const kind=lessonKinds[lesson.skillType];
  function speak() {
    if(!selected?.text)return;
    if(!("speechSynthesis" in window)){setNotice("Trình duyệt chưa hỗ trợ đọc mẫu.");return;}
    window.speechSynthesis.cancel();
    const speech=new SpeechSynthesisUtterance(selected.text);speech.lang="en-US";speech.rate=.9;
    window.speechSynthesis.speak(speech);setNotice("Đọc mẫu bằng giọng của trình duyệt.");
  }
  if(lesson.skillType==="writing") return <WritingPreview lesson={lesson}/>;
  if(lesson.skillType==="reading") return <ReadingPreview lesson={lesson}/>;
  return <div className={styles.learnerPreview}>
    <div className={styles.previewTop}><span><Icon name={kind.icon}/>{kind.label} Practice</span><small>{lesson.difficultyLevel}</small></div><h3>{lesson.title||"Tên bài học của bạn"}</h3>
    {lesson.skillType==="speaking"?<>
      <p className={styles.hint}>Hãy đọc to câu sau:</p><blockquote>{selected?.text||"Thêm câu luyện nói để xem trước tại đây."}</blockquote>
      {selected?.ipa&&<p className={styles.ipa}>{selected.ipa}</p>}
      {selected?.audioUrl?<audio controls src={selected.audioUrl} aria-label="Audio câu luyện nói"/>:<button type="button" className={styles.secondaryButton} onClick={speak} disabled={!selected?.text}><Icon name="volume"/>Nghe đọc mẫu</button>}
      {lesson.speaking?.goals&&<div className={styles.previewGoals}><strong>Mục tiêu luyện nói</strong><p>{lesson.speaking.goals}</p></div>}{notice&&<p className={styles.hint}>{notice}</p>}
      <p className={styles.previewDisclaimer}>Bản xem trước nội dung. Chấm phát âm AI chưa được tích hợp.</p>
    </>:<>
      {lesson.skillType==="grammar"&&<div className={styles.grammarTopic}>
        <h4>{lesson.grammar?.topic||"Chủ điểm ngữ pháp"}</h4>
        <GrammarNotes text={lesson.grammar?.rules||"Thêm quy tắc, công thức và ví dụ để xem trước."}/>
        {lesson.grammar?.commonMistakes&&<aside className={styles.previewGoals}><strong>Lỗi thường gặp</strong><GrammarNotes text={lesson.grammar.commonMistakes}/></aside>}
      </div>}
      {lesson.skillType==="listening"&&lesson.audioUrl&&<audio controls src={lesson.audioUrl} aria-label="Audio bài nghe xem trước"/>}
      {question?<QuestionPreview key={`${current}:${JSON.stringify(question)}`} question={question} formatBlanks={lesson.skillType==="grammar"}/>:<p className={styles.hint}>Thêm câu hỏi để kiểm thử tương tác.</p>}
      {lesson.listening?.transcript&&<details><summary>Bản ghi lời thoại{lesson.listening.hideTranscriptFirstListen?" (ẩn lần nghe đầu)":""}</summary><p className={styles.transcriptPreview}>{lesson.listening.transcript}</p></details>}
    </>}
    <div className={styles.previewPager}>
      <button type="button" aria-label="Câu trước" disabled={current===0} onClick={()=>setIndex(Math.max(0,current-1))}>←</button>
      <span>{count?current+1:0}/{count}</span>
      <button type="button" aria-label="Câu tiếp theo" disabled={current>=count-1} onClick={()=>setIndex(current+1)}>→</button>
    </div>
  </div>;
}
