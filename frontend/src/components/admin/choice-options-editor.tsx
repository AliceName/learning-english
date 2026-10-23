"use client";
import {useId} from "react";
import Icon from "@/components/site-icon";
import styles from "./admin.module.css";

type Choices={options:string[];correctOptionIndex:number|null};
export default function ChoiceOptionsEditor({options,correctOptionIndex,onChange,disabled,questionNumber,legend="Chọn đáp án đúng"}:Choices&{
  onChange:(choices:Choices)=>void;disabled:boolean;questionNumber:number;legend?:string;
}) {
  const id=useId();
  function remove(index:number) {
    if(disabled||options.length<=2)return;
    onChange({options:options.filter((_,optionIndex)=>optionIndex!==index),correctOptionIndex:
      correctOptionIndex===index?null:correctOptionIndex!==null&&correctOptionIndex>index?correctOptionIndex-1:correctOptionIndex});
  }
  return <fieldset className={`${styles.options} ${styles.editableOptions}`} disabled={disabled} aria-describedby={`${id}-help`}>
    <legend>{legend}</legend>
    {options.map((option,index)=>{
      const letter=String.fromCharCode(65+index);
      return <div key={index} className={styles.choiceOptionRow}>
        <input type="radio" name={`${id}-correct`} aria-label={`Câu ${questionNumber}: đáp án đúng ${letter}`} checked={correctOptionIndex===index} required onChange={()=>onChange({options,correctOptionIndex:index})}/>
        <span>{letter}.</span><input type="text" aria-label={`Câu ${questionNumber}: lựa chọn ${letter}`} value={option} maxLength={500} required onChange={event=>onChange({options:options.map((item,optionIndex)=>optionIndex===index?event.target.value:item),correctOptionIndex})}/>
        <button type="button" className={styles.iconButton} aria-label={`Câu ${questionNumber}: xóa lựa chọn ${letter}`} disabled={disabled||options.length<=2} onClick={()=>remove(index)}><Icon name="trash"/></button>
      </div>;
    })}
    <div className={styles.choiceOptionsFooter}><span className={styles.hint} id={`${id}-help`}>{options.length}/4 lựa chọn · Tối thiểu 2, tối đa 4.</span><button type="button" className={styles.textButton} disabled={disabled||options.length>=4} onClick={()=>onChange({options:[...options,""],correctOptionIndex})}><Icon name="plus"/>Thêm lựa chọn</button></div>
    {correctOptionIndex===null&&<p className={styles.notice} role="status">Chọn một đáp án đúng trước khi lưu.</p>}
    {options.length>4&&<p className={styles.notice} role="status">Câu hỏi này có hơn 4 lựa chọn. Xóa bớt để lưu theo giới hạn mới.</p>}
  </fieldset>;
}
