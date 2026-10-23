"use client";

import {newGrammarQuestion, type Grammar, type GrammarQuestion} from "@/lib/admin-courses";
import Icon from "@/components/site-icon";
import ChoiceOptionsEditor from "./choice-options-editor";
import styles from "./admin.module.css";

type Update = Grammar | ((previous: Grammar) => Grammar);
const questionTypes = {multiple_choice:"Trắc nghiệm",fill_blank:"Điền từ",error_correction:"Tìm và sửa lỗi"} as const;

export default function GrammarEditor({value, onChange, disabled}: {
  value: Grammar; onChange:(value:Update)=>void; disabled:boolean;
}) {
  function update(index:number, change:Partial<GrammarQuestion>) {
    onChange(previous=>({...previous,questions:previous.questions.map((item,itemIndex)=>itemIndex===index?{...item,...change}:item)}));
  }
  function move(index:number, offset:number) {
    onChange(previous=>{
      const questions=[...previous.questions];
      [questions[index],questions[index+offset]]=[questions[index+offset],questions[index]];
      return {...previous,questions};
    });
  }
  return <>
    <section className={`${styles.panel} ${styles.grammarOverview}`}>
      <div className={styles.sectionHeader}><span className={styles.sectionIcon}><Icon name="book"/></span><div><h2>Tổng quan chủ điểm ngữ pháp</h2><p>Quy tắc, công thức và hướng dẫn người học.</p></div></div>
      <label className={styles.field}>Tên chủ điểm ngữ pháp
        <input value={value.topic} onChange={event=>onChange(previous=>({...previous,topic:event.target.value}))} maxLength={255} disabled={disabled} placeholder="Ví dụ: Present Perfect & Past Simple"/>
      </label>
      <label className={styles.field}>Tóm tắt quy tắc & công thức chính
        <textarea value={value.rules} onChange={event=>onChange(previous=>({...previous,rules:event.target.value}))} rows={8} maxLength={20000} disabled={disabled} placeholder={"Cách dùng và cấu trúc ngữ pháp…\nS + have/has + V3/ed\nVí dụ: She has worked here since 2020."}/>
      </label>
      <p className={styles.hint}>Giữ nguyên xuống dòng. Đặt công thức trong dấu `...` để làm nổi bật khi xem trước. Cần chủ điểm, quy tắc và ít nhất một câu hỏi khi xuất bản.</p>
      <label className={styles.field}>Lỗi thường gặp & lưu ý
        <textarea value={value.commonMistakes} onChange={event=>onChange(previous=>({...previous,commonMistakes:event.target.value}))} rows={3} maxLength={3000} disabled={disabled} placeholder="Ví dụ: Không dùng thì hiện tại hoàn thành với yesterday, last week…"/>
      </label>
    </section>
    <section className={styles.panel}>
      <div className={styles.sectionHeader}><span className={styles.sectionIcon}><Icon name="clipboard"/></span><div><h2>Bài tập ngữ pháp</h2><p>{value.questions.length}/30 câu · Trắc nghiệm, điền từ, tìm và sửa lỗi.</p></div></div>
      {value.questions.length===0&&<p className={styles.hint}>Thêm câu hỏi để học viên luyện tập ngay sau phần lý thuyết.</p>}
      {value.questions.map((question,index)=><div key={index} className={styles.exerciseCard}>
        <div className={styles.exerciseHeading}><span className={styles.exerciseNumber}>{index+1}</span><strong>{questionTypes[question.type]}</strong>
          <div className={styles.questionActions}>
            <button type="button" className={styles.iconButton} aria-label={`Đưa câu ${index+1} lên`} disabled={disabled||index===0} onClick={()=>move(index,-1)}>↑</button>
            <button type="button" className={styles.iconButton} aria-label={`Đưa câu ${index+1} xuống`} disabled={disabled||index===value.questions.length-1} onClick={()=>move(index,1)}>↓</button>
            <button type="button" className={styles.iconButton} aria-label={`Xóa câu hỏi ${index+1}`} disabled={disabled} onClick={()=>onChange(previous=>({...previous,questions:previous.questions.filter((_,itemIndex)=>itemIndex!==index)}))}><Icon name="trash"/></button>
          </div>
        </div>
        <div className={styles.twoColumns}>
          <label className={styles.field}>Dạng câu hỏi<select value={question.type} disabled={disabled} onChange={event=>{
            const type=event.target.value as GrammarQuestion["type"];
            update(index,{...newGrammarQuestion(type),prompt:question.prompt,explanation:question.explanation,tag:question.tag});
          }}>{Object.entries(questionTypes).map(([type,label])=><option key={type} value={type}>{label}</option>)}</select></label>
          <label className={styles.field}>Tag chuyên đề<input value={question.tag??""} onChange={event=>update(index,{tag:event.target.value})} disabled={disabled} maxLength={250} placeholder="Ví dụ: Past Perfect, Third Conditional"/></label>
        </div>
        <label className={styles.field}>{question.type==="fill_blank"?"Nội dung câu có [blank]":question.type==="error_correction"?"Câu chứa lỗi sai":"Nội dung câu hỏi"} <em>*</em>
          <textarea required value={question.prompt} onChange={event=>update(index,{prompt:event.target.value})} rows={2} maxLength={2000} disabled={disabled} placeholder={question.type==="fill_blank"?"If I [blank] (know), I would have helped.":question.type==="error_correction"?"Not only did he forgot his notes, but he also arrived late.":"Chọn dạng động từ đúng để hoàn thành câu…"}/>
        </label>
        {question.type!=="fill_blank"?<>
          <ChoiceOptionsEditor options={question.options} correctOptionIndex={question.correctOptionIndex} onChange={choices=>update(index,choices)} disabled={disabled} questionNumber={index+1} legend={question.type==="error_correction"?"Các phần trong câu — chọn phần sai":"Các lựa chọn — chọn đáp án đúng"}/>
          {question.type==="error_correction"&&<label className={styles.field}>Cách sửa đúng <em>*</em><input value={question.correction??""} onChange={event=>update(index,{correction:event.target.value})} required maxLength={1000} disabled={disabled} placeholder="Ví dụ: did he forget"/></label>}
        </>:<>
          <label className={styles.field}>Đáp án chính xác <em>*</em><input value={question.answer??""} onChange={event=>update(index,{answer:event.target.value})} required maxLength={500} disabled={disabled} placeholder="had known"/></label>
          <label className={styles.checkboxLine}><input type="checkbox" checked={question.caseSensitive} onChange={event=>update(index,{caseSensitive:event.target.checked})} disabled={disabled}/>Phân biệt chữ hoa/thường</label>
          <div className={styles.field}><span>Đáp án thay thế được chấp nhận (không bắt buộc)</span>
            {question.acceptedAnswers.map((answer,answerIndex)=><div key={answerIndex} className={styles.answerVariant}>
              <input value={answer} required maxLength={500} disabled={disabled} aria-label={`Câu ${index+1}: đáp án thay thế ${answerIndex+1}`} onChange={event=>update(index,{acceptedAnswers:question.acceptedAnswers.map((item,itemIndex)=>itemIndex===answerIndex?event.target.value:item)})}/>
              <button type="button" className={styles.iconButton} disabled={disabled} aria-label={`Xóa đáp án thay thế ${answerIndex+1} câu ${index+1}`} onClick={()=>update(index,{acceptedAnswers:question.acceptedAnswers.filter((_,itemIndex)=>itemIndex!==answerIndex)})}><Icon name="trash"/></button>
            </div>)}
            <button type="button" className={styles.textButton} disabled={disabled||question.acceptedAnswers.length>=10} onClick={()=>update(index,{acceptedAnswers:[...question.acceptedAnswers,""]})}>+ Thêm đáp án thay thế</button>
          </div>
        </>}
        <label className={styles.field}>Giải thích ngữ pháp & gợi ý<textarea value={question.explanation??""} onChange={event=>update(index,{explanation:event.target.value})} rows={3} maxLength={2000} disabled={disabled} placeholder="Nêu quy tắc áp dụng và lý do chọn đáp án này…"/></label>
      </div>)}
      <div className={styles.questionTypes}>{Object.entries(questionTypes).map(([type,label])=><button key={type} type="button" className={styles.addButton} disabled={disabled||value.questions.length>=30} onClick={()=>onChange(previous=>({...previous,questions:[...previous.questions,newGrammarQuestion(type as GrammarQuestion["type"])]}))}><Icon name="plus"/>{label}</button>)}</div>
    </section>
  </>;
}
