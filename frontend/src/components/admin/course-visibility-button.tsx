"use client";
import {useRef,useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {adminRequest,type AdminCourse} from "@/lib/admin-courses";
import Icon from "@/components/site-icon";
import styles from "./admin.module.css";

export default function CourseVisibilityButton({courseId,isPublished,disabled=false,onChanged}:{
  courseId:number;isPublished:boolean;disabled?:boolean;onChanged?:(course:AdminCourse)=>void;
}) {
  const router=useRouter();
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState("");
  const inFlight=useRef(false);
  function toggle() {
    if(inFlight.current||pending||disabled)return;
    inFlight.current=true;setError("");
    startTransition(async()=>{
      try {
        const course=await adminRequest<AdminCourse>(`courses/${courseId}/${isPublished?"hide":"publish"}`,{method:"POST"});
        if(onChanged)onChanged(course);else router.refresh();
      } catch(error) {setError(error instanceof Error?error.message:"Không thể thay đổi hiển thị khóa học.");}
      finally {inFlight.current=false;}
    });
  }
  return <div className={styles.visibilityControl}>
    <button type="button" onClick={toggle} className={styles.secondaryButton} disabled={disabled||pending}><Icon name={isPublished?"eye":"globe"}/>{pending?"Đang cập nhật…":isPublished?"Ẩn khóa học":"Hiện khóa học"}</button>
    {error&&<p className={styles.error} role="alert">{error}</p>}
  </div>;
}
