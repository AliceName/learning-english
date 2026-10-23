"use client";
import {useId,useState} from "react";
import type {Question,GrammarQuestion,ReadingQuestion} from "@/lib/admin-courses";
import styles from "./admin.module.css";

export default function QuestionPreview({question,formatBlanks,onChecked}:{question:Question|GrammarQuestion|ReadingQuestion;formatBlanks:boolean;onChecked?:(correct:boolean|undefined)=>void}) {
  const name=useId();
  const [value,setValue]=useState("");
  const [pairs,setPairs]=useState<Record<number,string>>({});
  const [result,setResult]=useState("");
  const choice=question.type==="multiple_choice"||question.type==="error_correction";
  const prompt=formatBlanks&&question.type==="fill_blank"?question.prompt.replaceAll("[blank]","....."):question.prompt;
  function check() {
    let correct=false;
    if(choice) correct=value!==""&&Number(value)===question.correctOptionIndex;
    else if(question.type==="fill_blank"||question.type==="short_answer") {
      const normalize=(text:string)=>question.caseSensitive?text.trim():text.trim().toLowerCase();
      const answers=[question.answer??"",...("acceptedAnswers" in question?question.acceptedAnswers:[])].filter(answer=>answer.trim());
      correct=!!value.trim()&&answers.some(answer=>normalize(value)===normalize(answer));
    } else if(question.type==="true_false_not_given") correct=value!==""&&value===question.answer;
    else if(question.type==="matching") correct=question.pairs.length>0&&question.pairs.every((pair,index)=>pairs[index]===pair.right);
    setResult(correct?"Chính xác!":"Chưa chính xác. Hãy thử lại.");
    onChecked?.(correct);
  }
  return <div className={styles.questionPreview}>
    {"tag" in question&&question.tag&&<span className={styles.eyebrow}>{question.tag}</span>}
    <h4>{prompt||"Nhập nội dung câu hỏi để xem trước"}</h4>
    {question.type==="error_correction"&&<p>Chọn phần chứa lỗi ngữ pháp:</p>}
    {choice?question.options.map((option,index)=><label key={index} className={styles.previewOption}>
      <input type="radio" name={`${name}-choice`} value={index} checked={value===String(index)} onChange={()=>{setValue(String(index));setResult("");onChecked?.(undefined);}}/>{String.fromCharCode(65+index)}. {option||"Lựa chọn…"}
    </label>):(question.type==="fill_blank"||question.type==="short_answer")?<input value={value} onChange={event=>{setValue(event.target.value);setResult("");onChecked?.(undefined);}} maxLength={500} placeholder="Nhập câu trả lời…" aria-label="Câu trả lời xem trước"/>:
      question.type==="true_false_not_given"?[["true","True"],["false","False"],["not_given","Not Given"]].map(([answer,label])=><label key={answer} className={styles.previewOption}><input type="radio" name={`${name}-tfng`} checked={value===answer} onChange={()=>{setValue(answer);setResult("");onChecked?.(undefined);}}/>{label}</label>):question.type==="matching"?question.pairs.map((pair,index)=><label key={index} className={styles.matchingPreview}>
        <span>{pair.left||"Ý chính"}</span><select aria-label={`Nối ý ${index+1}`} value={pairs[index]??""} onChange={event=>{setPairs(previous=>({...previous,[index]:event.target.value}));setResult("");onChecked?.(undefined);}}><option value="">Chọn ý tương ứng</option>{[...question.pairs].reverse().map((option,optionIndex)=><option key={optionIndex} value={option.right}>{option.right||"Nội dung…"}</option>)}</select>
      </label>):null}
    <button type="button" className={styles.secondaryButton} onClick={check}>Kiểm tra đáp án</button>
    {result&&<div role="status"><p>{result}</p>{question.explanation&&<p>{question.explanation}</p>}{"reference" in question&&question.reference&&<p>Dẫn chứng: {question.reference}</p>}{question.type==="error_correction"&&<p>Cách sửa đúng: <strong>{question.correction}</strong></p>}</div>}
  </div>;
}

