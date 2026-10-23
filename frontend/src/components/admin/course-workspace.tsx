"use client";
import Link from "next/link";
import {createContext,useContext,useState,useEffect,type ReactNode,type Dispatch,type SetStateAction} from "react";
import {isAuthoringSkill,type AdminCourse,type LessonDraft} from "@/lib/admin-courses";
import CourseSteps from "./course-steps";
import styles from "./admin.module.css";
type GeneralDraft={title:string;description:string;coverImageUrl:string|null};
type Workspace={course:AdminCourse;replaceCourse:(course:AdminCourse,clear?:string)=>void;drafts:Record<string,LessonDraft>;setDraft:(key:string,value:LessonDraft|((previous:LessonDraft|undefined)=>LessonDraft))=>void;generalDraft:GeneralDraft|null;setGeneralDraft:Dispatch<SetStateAction<GeneralDraft|null>>;};
const Context=createContext<Workspace|null>(null);
export function useWorkspace(){const context=useContext(Context);if(!context)throw new Error("Course workspace missing");return context;}
export function useOptionalWorkspace(){return useContext(Context);}
export default function CourseWorkspace({initialCourse,children}:{initialCourse:AdminCourse;children:ReactNode}) {
  const[course,setCourse]=useState(initialCourse);const[drafts,setDrafts]=useState<Record<string,LessonDraft>>({});
  const[generalDraft,setGeneralDraft]=useState<GeneralDraft|null>(null);
  const dirty=Object.keys(drafts).length>0||!!generalDraft;
  useEffect(()=>{if(!dirty)return;const prevent=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener("beforeunload",prevent);return()=>window.removeEventListener("beforeunload",prevent);},[dirty]);
  function replaceCourse(value:AdminCourse,clear?:string){setCourse(value);if(clear==="general")setGeneralDraft(null);else if(clear)setDrafts(previous=>{const next={...previous};delete next[clear];return next;});}
  return <Context.Provider value={{course,replaceCourse,drafts,setDraft:(key,value)=>setDrafts(previous=>({...previous,[key]:typeof value==="function"?value(previous[key]):value})),generalDraft,setGeneralDraft}}>
    <div className={styles.breadcrumb}><Link href="/admin/courses">Quản lý khóa học</Link><span>›</span><span>CRS-{course.courseId}</span></div>
    <div className={styles.pageHeader}><div><Link href="/admin/courses" className={styles.back}>← Quay về danh sách</Link><h1>{course.title}</h1></div><span className={course.isPublished?styles.published:styles.draft}>{course.isPublished?"Đã xuất bản":dirty?"Có thay đổi chưa lưu":"Bản nháp đã lưu"}</span></div>
    <CourseSteps courseId={course.courseId} published={course.isPublished} firstSkill={course.lessons.map(item=>item.skillType).find(isAuthoringSkill)}/>{course.isPublished&&<p className={styles.notice}>Khóa học đã xuất bản. Nội dung đang ở chế độ xem.</p>}{children}
  </Context.Provider>;
}
