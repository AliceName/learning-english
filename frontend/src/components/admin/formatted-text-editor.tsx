"use client";
import {useId,useRef,useState} from "react";
import {formatLessonText,lessonPlainText,type TextFormat} from "@/lib/lesson-text";
import LessonRichText from "./lesson-rich-text";
import styles from "./admin.module.css";

const tools:[TextFormat,string,string][]=[
  ["normal","Normal","Văn bản thường"],["h2","H2","Tiêu đề cấp 2"],["h3","H3","Tiêu đề cấp 3"],
  ["bold","B","In đậm"],["italic","I","In nghiêng"],["underline","U","Gạch chân"],
  ["bullet","• List","Danh sách dấu chấm"],["number","1. List","Danh sách đánh số"],["quote","❞","Trích dẫn"],["highlight","Highlight","Tô sáng"],
];
export default function FormattedTextEditor({label,value,onChange,disabled=false,rows=8,maxLength=30000,placeholder,onGlossary}:{
  label:string;value:string;onChange:(value:string)=>void;disabled?:boolean;rows?:number;maxLength?:number;placeholder?:string;onGlossary?:(word:string)=>void;
}) {
  const id=useId();
  const input=useRef<HTMLTextAreaElement>(null);
  const [preview,setPreview]=useState(false);
  const [notice,setNotice]=useState("");
  function format(kind:TextFormat) {
    const field=input.current;if(!field)return;
    const result=formatLessonText(value,field.selectionStart,field.selectionEnd,kind);
    if(result.text.length>maxLength){setNotice(`Nội dung tối đa ${maxLength} ký tự.`);return;}
    onChange(result.text);setNotice("");
    requestAnimationFrame(()=>{field.focus();field.setSelectionRange(result.start,result.end);});
  }
  function glossary() {
    const field=input.current;if(!field||!onGlossary)return;
    const word=lessonPlainText(value.slice(field.selectionStart,field.selectionEnd)).trim();
    if(!word||!/[\p{L}\p{N}]/u.test(word)){setNotice("Bôi chọn một từ hoặc cụm từ trong văn bản trước khi chèn chú giải.");return;}
    if(word.length>100){setNotice("Chọn từ hoặc cụm từ tối đa 100 ký tự.");return;}
    onGlossary(word);
  }
  return <div className={styles.formattedEditor}>
    <div className={styles.editorLabel}><label htmlFor={id}>{label}</label><div><button type="button" aria-pressed={!preview} onClick={()=>setPreview(false)}>Soạn thảo</button><button type="button" aria-pressed={preview} onClick={()=>setPreview(true)}>Xem định dạng</button></div></div>
    {!preview&&<div className={styles.textToolbar} role="toolbar" aria-label={`Định dạng ${label}`}>{tools.map(([kind,text,title])=><button key={kind} type="button" title={title} aria-label={`${title} — ${label}`} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format(kind)}>{text}</button>)}{onGlossary&&<button type="button" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={glossary}>Chèn từ điển giải nghĩa</button>}</div>}
    {preview?<div className={styles.editorRendered}><LessonRichText text={value||"Chưa có nội dung."}/></div>:<textarea id={id} ref={input} value={value} onChange={event=>{onChange(event.target.value);setNotice("");}} disabled={disabled} rows={rows} maxLength={maxLength} placeholder={placeholder}/>}
    <p className={styles.editorHelp}>Hỗ trợ Markdown: **đậm**, *nghiêng*, ++gạch chân++, ==tô sáng==, tiêu đề, danh sách và trích dẫn.</p>
    {notice&&<p role="status" className={styles.notice}>{notice}</p>}
  </div>;
}
