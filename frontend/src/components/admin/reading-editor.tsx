"use client";
import {useState} from "react";
import {countWords,newReadingQuestion,readingQuestionTypes,readingFocus,type Reading,type ReadingQuestion} from "@/lib/admin-courses";
import {readingParagraphCount,lessonPlainText} from "@/lib/lesson-text";
import Icon from "@/components/site-icon";
import FormattedTextEditor from "./formatted-text-editor";
import ChoiceOptionsEditor from "./choice-options-editor";
import styles from "./admin.module.css";

export default function ReadingEditor({value,onChange,disabled}:{value:Reading;onChange:(update:Reading|((previous:Reading)=>Reading))=>void;disabled:boolean}) {
  const [newType,setNewType]=useState<ReadingQuestion["type"]>("multiple_choice");
  const [glossaryNotice,setGlossaryNotice]=useState("");
  function update(index:number,change:Partial<ReadingQuestion>) {
    onChange(previous=>({...previous,questions:previous.questions.map((item,itemIndex)=>itemIndex===index?{...item,...change}:item)}));
  }
  function move(index:number,offset:number) {
    onChange(previous=>{const questions=[...previous.questions];[questions[index],questions[index+offset]]=[questions[index+offset],questions[index]];return {...previous,questions};});
  }
  function vocabulary(index:number,change:Partial<Reading["vocabulary"][number]>) {
    onChange(previous=>({...previous,vocabulary:previous.vocabulary.map((item,itemIndex)=>itemIndex===index?{...item,...change}:item)}));
  }
  return <>
    <section className={`${styles.panel} ${styles.contentFields}`}>
      <div className={styles.studioHeading}><span>01</span><div><h2>Văn bản bài đọc tiếng Anh</h2><p>{countWords(lessonPlainText(value.passage))} từ · {readingParagraphCount(value.passage)} đoạn · Ngăn cách các đoạn bằng một dòng trống.</p></div></div>
      <div className={styles.twoColumns}><label className={styles.field}>Tiêu đề bài đọc<input value={value.passageTitle} onChange={event=>onChange(previous=>({...previous,passageTitle:event.target.value}))} disabled={disabled} maxLength={255} placeholder="Quarterly Market Trends & Consumer Behavior"/></label>
      <label className={styles.field}>Thể loại bài đọc<input value={value.category??""} onChange={event=>onChange(previous=>({...previous,category:event.target.value}))} disabled={disabled} maxLength={255} placeholder="Corporate Economics"/></label></div>
      <FormattedTextEditor label="Văn bản bài đọc" value={value.passage} onChange={passage=>onChange(previous=>({...previous,passage}))} rows={14} disabled={disabled} onGlossary={word=>{
        const exists=value.vocabulary.some(item=>item.word.trim().toLowerCase()===word.toLowerCase());
        if(exists){setGlossaryNotice(`“${word}” đã có trong danh sách chú giải.`);return;}
        if(value.vocabulary.length>=30){setGlossaryNotice("Đã đạt tối đa 30 mục từ.");return;}
        onChange(previous=>({...previous,vocabulary:[...previous.vocabulary,{word,meaning:"",example:""}]}));
        setGlossaryNotice(`Đã thêm “${word}”. Nhập nghĩa trong mục Từ vựng ngay bên dưới.`);
      }} placeholder={"The third quarter revealed an unexpected pivot in consumer behavior.\n\nAccording to regional metrics, online engagement increased…"}/>
      {glossaryNotice&&<p role="status" className={styles.notice}>{glossaryNotice}</p>}
      <label className={styles.field}>Hướng dẫn đọc & làm bài<textarea value={value.instructions} onChange={event=>onChange(previous=>({...previous,instructions:event.target.value}))} rows={3} maxLength={3000} disabled={disabled} placeholder="Đọc bài và trả lời câu hỏi. Với Not Given, thông tin không được đề cập trong bài đọc."/></label>
      <details className={styles.studioDetails}><summary>Bản dịch song ngữ tham khảo <span>Không bắt buộc</span></summary><FormattedTextEditor label="Bản dịch tiếng Việt" value={value.translation??""} onChange={translation=>onChange(previous=>({...previous,translation}))} rows={8} disabled={disabled}/><p className={styles.hint}>Admin nhập bản dịch để bật chế độ song ngữ trong mô phỏng. Chưa tích hợp dịch tự động.</p></details>
    </section>
    <section className={styles.panel}>
      <div className={styles.sectionHeader}><span className={styles.sectionIcon}><Icon name="book"/></span><div><h2>Từ vựng & chú giải trong bài đọc</h2><p>{value.vocabulary.length}/30 mục từ · Từ có nghĩa được gạch chân trong mô phỏng; bấm vào từ để tra cứu.</p></div></div>
      {value.vocabulary.map((item,index)=><div key={index} className={styles.exerciseCard}>
        <div className={styles.exerciseHeading}><strong>Từ vựng {index+1}</strong><button type="button" className={styles.iconButton} disabled={disabled} aria-label={`Xóa từ vựng ${index+1}`} onClick={()=>onChange(previous=>({...previous,vocabulary:previous.vocabulary.filter((_,itemIndex)=>itemIndex!==index)}))}><Icon name="trash"/></button></div>
        <div className={styles.twoColumns}><label className={styles.field}>Từ / cụm từ<input value={item.word} onChange={event=>vocabulary(index,{word:event.target.value})} required maxLength={100} disabled={disabled}/></label><label className={styles.field}>Nghĩa / định nghĩa<input value={item.meaning} onChange={event=>vocabulary(index,{meaning:event.target.value})} required maxLength={500} disabled={disabled}/></label></div>
        <label className={styles.field}>Ví dụ trong ngữ cảnh<textarea value={item.example} onChange={event=>vocabulary(index,{example:event.target.value})} rows={2} maxLength={1000} disabled={disabled}/></label>
      </div>)}
      <button type="button" className={styles.addButton} disabled={disabled||value.vocabulary.length>=30} onClick={()=>onChange(previous=>({...previous,vocabulary:[...previous.vocabulary,{word:"",meaning:"",example:""}]}))}><Icon name="plus"/>Thêm từ vựng</button>
    </section>
    <section className={styles.panel}>
      <div className={styles.studioHeading}><span>02</span><div><h2>Danh sách câu hỏi kiểm tra ({value.questions.length})</h2><p>Skimming, Scanning, suy luận và từ vựng · Tối đa 30 câu hỏi.</p></div></div>
      <div className={styles.questionAddBar}><label className={styles.field}>Loại câu hỏi mới<select value={newType} disabled={disabled} onChange={event=>setNewType(event.target.value as ReadingQuestion["type"])}>{Object.entries(readingQuestionTypes).map(([type,label])=><option key={type} value={type}>{label}</option>)}</select></label><button type="button" className={styles.primaryButton} disabled={disabled||value.questions.length>=30} onClick={()=>onChange(previous=>({...previous,questions:[...previous.questions,newReadingQuestion(newType)]}))}><Icon name="plus"/>Thêm câu hỏi</button></div>
      {value.questions.map((question,index)=><div key={index} className={styles.exerciseCard}>
        <div className={styles.exerciseHeading}><span className={styles.exerciseNumber}>{index+1}</span><strong>{readingQuestionTypes[question.type]}</strong><div className={styles.questionActions}>
          <button type="button" className={styles.iconButton} aria-label={`Đưa câu ${index+1} lên`} disabled={disabled||index===0} onClick={()=>move(index,-1)}>↑</button>
          <button type="button" className={styles.iconButton} aria-label={`Đưa câu ${index+1} xuống`} disabled={disabled||index===value.questions.length-1} onClick={()=>move(index,1)}>↓</button>
          <button type="button" className={styles.iconButton} aria-label={`Xóa câu hỏi ${index+1}`} disabled={disabled} onClick={()=>onChange(previous=>({...previous,questions:previous.questions.filter((_,itemIndex)=>itemIndex!==index)}))}><Icon name="trash"/></button>
        </div></div>
        <div className={styles.twoColumns}><label className={styles.field}>Dạng câu hỏi<select value={question.type} disabled={disabled} onChange={event=>update(index,{...newReadingQuestion(event.target.value as ReadingQuestion["type"]),prompt:question.prompt,explanation:question.explanation,reference:question.reference,focus:question.focus,points:question.points})}>{Object.entries(readingQuestionTypes).map(([type,label])=><option key={type} value={type}>{label}</option>)}</select></label><div className={styles.twoColumns}><label className={styles.field}>Kỹ năng đọc<select value={question.focus??"scanning"} disabled={disabled} onChange={event=>update(index,{focus:event.target.value as ReadingQuestion["focus"]})}>{Object.entries(readingFocus).map(([type,label])=><option key={type} value={type}>{label}</option>)}</select></label><label className={styles.field}>Điểm<input type="number" min={0.1} max={10} step={0.1} required value={question.points??1} disabled={disabled} onChange={event=>update(index,{points:Number(event.target.value)})}/></label></div></div>
        <label className={styles.field}>{question.type==="fill_blank"?"Nội dung câu có [blank]":"Nội dung câu hỏi"}<textarea required value={question.prompt} onChange={event=>update(index,{prompt:event.target.value})} rows={2} maxLength={2000} disabled={disabled} placeholder={question.type==="fill_blank"?"The city introduced [blank] to reduce traffic.":"What is the main idea of paragraph A?"}/></label>
        {question.type==="multiple_choice"&&<ChoiceOptionsEditor options={question.options} correctOptionIndex={question.correctOptionIndex} onChange={choices=>update(index,choices)} disabled={disabled} questionNumber={index+1}/>}
        {question.type==="true_false_not_given"&&<label className={styles.field}>Đáp án đúng<select value={question.answer??"true"} disabled={disabled} onChange={event=>update(index,{answer:event.target.value})}><option value="true">True — đúng với bài đọc</option><option value="false">False — trái với bài đọc</option><option value="not_given">Not Given — không có thông tin</option></select></label>}
        {(question.type==="fill_blank"||question.type==="short_answer")&&<>
          <label className={styles.field}>Đáp án chuẩn<input value={question.answer??""} required maxLength={500} disabled={disabled} onChange={event=>update(index,{answer:event.target.value})}/></label>
          <label className={styles.checkboxLine}><input type="checkbox" checked={question.caseSensitive} disabled={disabled} onChange={event=>update(index,{caseSensitive:event.target.checked})}/>Phân biệt chữ hoa/thường</label>
          <div className={styles.field}><span>Đáp án thay thế (không bắt buộc)</span>{question.acceptedAnswers.map((answer,answerIndex)=><div key={answerIndex} className={styles.answerVariant}>
            <input value={answer} required maxLength={500} disabled={disabled} aria-label={`Câu ${index+1}: đáp án thay thế ${answerIndex+1}`} onChange={event=>update(index,{acceptedAnswers:question.acceptedAnswers.map((item,itemIndex)=>itemIndex===answerIndex?event.target.value:item)})}/>
            <button type="button" className={styles.iconButton} disabled={disabled} aria-label={`Xóa đáp án thay thế ${answerIndex+1} câu ${index+1}`} onClick={()=>update(index,{acceptedAnswers:question.acceptedAnswers.filter((_,itemIndex)=>itemIndex!==answerIndex)})}><Icon name="trash"/></button>
          </div>)}<button type="button" className={styles.textButton} disabled={disabled||question.acceptedAnswers.length>=10} onClick={()=>update(index,{acceptedAnswers:[...question.acceptedAnswers,""]})}>+ Thêm đáp án thay thế</button></div>
        </>}
        {question.type==="matching"&&<div className={styles.matchingPairs}>{question.pairs.map((pair,pairIndex)=><div key={pairIndex}>
          <input value={pair.left} aria-label={`Câu ${index+1}: vế trái ${pairIndex+1}`} placeholder="Đoạn / ý chính" required maxLength={500} disabled={disabled} onChange={event=>update(index,{pairs:question.pairs.map((item,itemIndex)=>itemIndex===pairIndex?{...item,left:event.target.value}:item)})}/><span>↔</span>
          <input value={pair.right} aria-label={`Câu ${index+1}: vế phải ${pairIndex+1}`} placeholder="Tiêu đề / nội dung phù hợp" required maxLength={500} disabled={disabled} onChange={event=>update(index,{pairs:question.pairs.map((item,itemIndex)=>itemIndex===pairIndex?{...item,right:event.target.value}:item)})}/>
        </div>)}<button type="button" className={styles.textButton} disabled={disabled||question.pairs.length>=8} onClick={()=>update(index,{pairs:[...question.pairs,{left:"",right:""}]})}>+ Thêm cặp</button>{question.pairs.length>2&&<button type="button" className={styles.textButton} disabled={disabled} onClick={()=>update(index,{pairs:question.pairs.slice(0,-1)})}>Bớt cặp cuối</button>}</div>}
        <div className={styles.twoColumns}><label className={styles.field}>Giải thích đáp án<textarea value={question.explanation??""} onChange={event=>update(index,{explanation:event.target.value})} rows={3} maxLength={2000} disabled={disabled}/></label><label className={styles.field}>Dẫn chứng / đoạn tham chiếu<textarea value={question.reference??""} onChange={event=>update(index,{reference:event.target.value})} rows={3} maxLength={1000} disabled={disabled}/></label></div>
      </div>)}
      {!value.questions.length&&<p className={styles.empty}>Chọn loại câu hỏi và bấm “Thêm câu hỏi” để bắt đầu.</p>}
    </section>
  </>;
}
