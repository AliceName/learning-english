"use client";
import {useEffect,useLayoutEffect,useId,useRef,useState} from "react";
import Icon from "@/components/site-icon";
import CourseCover from "@/components/courses/course-cover";
import {adminRequest} from "@/lib/admin-courses";
import styles from "./admin.module.css";
export default function MediaField({kind,value,onChange,onBusy,disabled=false,label,onTimeChange}:{kind:"cover"|"audio";value:string|null;onChange:(value:string|null)=>void;onBusy?:(value:boolean)=>void;disabled?:boolean;label:string;onTimeChange?:(seconds:number)=>void}) {
  const id=useId();const input=useRef<HTMLInputElement>(null);const abort=useRef<AbortController|null>(null);
  const latestOnChange=useRef(onChange);
  useLayoutEffect(()=>{latestOnChange.current=onChange;},[onChange]);
  const[busy,setBusy]=useState(false);const[error,setError]=useState("");
  useEffect(()=>()=>abort.current?.abort(),[]);
  async function upload(file?:File){
    if(!file||busy||disabled)return;setError("");
    if(file.size>(kind==="cover"?5:25)*1024*1024){setError(`Tệp tối đa ${kind==="cover"?5:25} MB.`);return;}
    setBusy(true);onBusy?.(true);abort.current=new AbortController();
    try {const form=new FormData();form.set("file",file);form.set("kind",kind);const result=await adminRequest<{url:string}>("uploads",{method:"POST",body:form,signal:abort.current.signal});latestOnChange.current(result.url);}
    catch(error){if(!abort.current?.signal.aborted)setError(error instanceof Error?error.message:"Không thể tải tệp.");}
    finally{setBusy(false);onBusy?.(false);if(input.current)input.current.value="";}
  }
  return <div className={styles.mediaField}><label htmlFor={id}>{label}</label><div className={styles.uploadGrid}>
    <div className={styles.dropzone} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void upload(event.dataTransfer.files[0]);}}>
      <Icon name={kind==="cover"?"upload":"wave"}/><strong>{busy?"Đang tải tệp…":"Kéo thả tệp vào đây"}</strong><span>{kind==="cover"?"JPG, PNG, WebP · tối đa 5 MB · khuyến nghị 16:9":"MP3, WAV, AAC, M4A · tối đa 25 MB"}</span>
      <input ref={input} id={id} type="file" accept={kind==="cover"?"image/jpeg,image/png,image/webp":"audio/mpeg,audio/wav,audio/aac,audio/mp4,.m4a"} onChange={event=>void upload(event.target.files?.[0])} className={styles.fileInput} disabled={disabled||busy}/>
      <button type="button" className={styles.secondaryButton} disabled={disabled||busy} onClick={()=>input.current?.click()}>{value?"Thay tệp mới":"Duyệt từ máy tính"}</button>
    </div>
    {kind==="cover"?<div className={styles.mediaPreview}><CourseCover url={value} title="Xem trước ảnh bìa" eager/></div>:<div className={styles.audioPreview}><Icon name="headphones"/>{value?<audio controls src={value} preload="metadata" aria-label={label} onTimeUpdate={event=>onTimeChange?.(event.currentTarget.currentTime)}/>:<p>Audio nghe thử sẽ xuất hiện sau khi tải tệp.</p>}</div>}
  </div><div className={styles.urlRow}><input key={value??""} type="text" aria-label={`${label}: URL`} defaultValue={value??""} onBlur={event=>{if(event.target.value!==(value??""))onChange(event.target.value||null);}} placeholder="Hoặc nhập URL https://…" maxLength={500} disabled={disabled||busy}/>{value&&<button type="button" className={styles.iconButton} onClick={()=>onChange(null)} aria-label={`Gỡ ${label}`} disabled={disabled||busy}><Icon name="trash"/></button>}</div>{busy&&<p role="status" className={styles.hint}>Đang tải lên, vui lòng chờ trước khi lưu.</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}</div>;
}
