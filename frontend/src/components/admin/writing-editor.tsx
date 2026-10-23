"use client";
import {countWords,writingTaskTypes,type Writing,type WritingCriterion} from "@/lib/admin-courses";
import {lessonPlainText} from "@/lib/lesson-text";
import Icon from "@/components/site-icon";
import FormattedTextEditor from "./formatted-text-editor";
import styles from "./admin.module.css";

export default function WritingEditor({value,onChange,disabled}:{value:Writing;onChange:(update:Writing|((previous:Writing)=>Writing))=>void;disabled:boolean}) {
  const total=value.rubric.reduce((sum,item)=>sum+item.weight,0);
  function criterion(index:number,change:Partial<WritingCriterion>) {
    onChange(previous=>({...previous,rubric:previous.rubric.map((item,itemIndex)=>itemIndex===index?{...item,...change}:item)}));
  }
  return <>
    <section className={`${styles.panel} ${styles.contentFields}`}>
      <div className={styles.studioHeading}><span>01</span><div><h2>Thiết lập đề bài & yêu cầu bài viết</h2><p>Xác định bối cảnh, câu hỏi gợi ý và độ dài bài viết.</p></div></div>
      <div className={styles.twoColumns}><label className={styles.field}>Chủ đề viết (Topic Title)<input value={value.topic??""} maxLength={255} disabled={disabled} placeholder="Writing a Formal Business Proposal" onChange={event=>onChange(previous=>({...previous,topic:event.target.value}))}/></label>
      <label className={styles.field}>Dạng bài viết<select value={value.taskType} disabled={disabled} onChange={event=>onChange(previous=>({...previous,taskType:event.target.value as Writing["taskType"]}))}>{Object.entries(writingTaskTypes).map(([type,label])=><option key={type} value={type}>{label}</option>)}</select></label></div>
      <FormattedTextEditor label="Nội dung yêu cầu chi tiết (Writing Prompt)" value={value.prompt} onChange={prompt=>onChange(previous=>({...previous,prompt}))} rows={5} maxLength={10000} disabled={disabled} placeholder="You are the project manager at an IT firm. Write a formal proposal to your director…"/>
      <div className={styles.guidingTips}><div className={styles.sectionHeader}><Icon name="sparkles"/><div><h2>Gợi ý & hướng dẫn người học (Guiding Tips)</h2><p>Gợi ý mở bài, triển khai luận điểm và kết luận; mỗi ý một dòng.</p></div></div><FormattedTextEditor label="Hướng dẫn viết" value={value.instructions} onChange={instructions=>onChange(previous=>({...previous,instructions}))} rows={4} maxLength={5000} disabled={disabled} placeholder={"1. **Introduction:** State the proposal’s main purpose.\n2. **Key benefits:** Present benefits and a realistic timeline.\n3. **Conclusion:** Suggest the next steps."}/></div>
      <div className={styles.studioSectionLabel}><strong>Độ dài bài viết khuyến nghị</strong><span>{value.minWords}–{value.maxWords} từ</span></div>
      <div className={styles.twoColumns}>
        <label className={styles.field}>Số từ tối thiểu<input type="number" value={value.minWords} min={1} max={5000} required disabled={disabled} onChange={event=>onChange(previous=>({...previous,minWords:Number(event.target.value)}))}/></label>
        <label className={styles.field}>Số từ tối đa<input type="number" value={value.maxWords} min={value.minWords||1} max={5000} required disabled={disabled} onChange={event=>onChange(previous=>({...previous,maxWords:Number(event.target.value)}))}/></label>
      </div>
      {value.minWords>value.maxWords&&<p className={styles.error}>Số từ tối đa phải lớn hơn hoặc bằng số từ tối thiểu.</p>}
    </section>
    <details className={`${styles.panel} ${styles.studioDetails}`} id="writing-rubric">
      <summary>Tiêu chí đánh giá bài viết <span>{value.rubric.length}/8 tiêu chí · {total}%</span></summary>
      <p className={styles.hint}>Cấu hình trọng số và mô tả yêu cầu để người học tham khảo.</p>
      {value.rubric.map((item,index)=><div key={index} className={styles.exerciseCard}>
        <div className={styles.exerciseHeading}><span className={styles.exerciseNumber}>{index+1}</span><strong>Tiêu chí {index+1}</strong><button type="button" className={styles.iconButton} aria-label={`Xóa tiêu chí ${index+1}`} disabled={disabled} onClick={()=>onChange(previous=>({...previous,rubric:previous.rubric.filter((_,itemIndex)=>itemIndex!==index)}))}><Icon name="trash"/></button></div>
        <div className={styles.twoColumns}><label className={styles.field}>Tên tiêu chí<input value={item.name} onChange={event=>criterion(index,{name:event.target.value})} maxLength={100} required disabled={disabled}/></label><label className={styles.field}>Trọng số (%)<input type="number" value={item.weight} min={1} max={100} required disabled={disabled} onChange={event=>criterion(index,{weight:Number(event.target.value)})}/></label></div>
        <label className={styles.field}>Mô tả tiêu chí<textarea value={item.description} onChange={event=>criterion(index,{description:event.target.value})} rows={2} maxLength={2000} disabled={disabled}/></label>
      </div>)}
      {value.rubric.length>0&&total!==100&&<p className={styles.notice}>Điều chỉnh tổng trọng số về 100% trước khi lưu.</p>}
      <button type="button" className={styles.addButton} disabled={disabled||value.rubric.length>=8} onClick={()=>onChange(previous=>({...previous,rubric:[...previous.rubric,{name:"",description:"",weight:25}]}))}><Icon name="plus"/>Thêm tiêu chí đánh giá</button>
    </details>
    <details className={`${styles.panel} ${styles.studioDetails}`}>
      <summary>Bài viết mẫu <span>Không bắt buộc · {countWords(lessonPlainText(value.sampleAnswer))} từ</span></summary>
      <FormattedTextEditor label="Nội dung bài mẫu" value={value.sampleAnswer} onChange={sampleAnswer=>onChange(previous=>({...previous,sampleAnswer}))} rows={8} maxLength={30000} disabled={disabled}/>
    </details>
  </>;
}
