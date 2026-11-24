"use client";
import {useId,useRef,useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {adminRequest} from "@/lib/admin-courses";
import Icon from "@/components/site-icon";
import styles from "./admin.module.css";

/**
 * Deletes a hidden course after an explicit confirmation. The API refuses published courses and any course
 * a learner has used (results, attempts, saved decks); its message is shown so the admin knows to hide it instead.
 */
export default function CourseDeleteButton({courseId,title,isPublished}:{courseId:number;title:string;isPublished:boolean}) {
  const router=useRouter();
  const [confirming,setConfirming]=useState(false);
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState("");
  const inFlight=useRef(false);
  const id=useId();
  if(isPublished)return null;
  function remove() {
    if(inFlight.current||pending)return;
    inFlight.current=true;setError("");
    startTransition(async()=>{
      try {await adminRequest(`courses/${courseId}`,{method:"DELETE"});setConfirming(false);router.refresh();}
      catch(error) {setError(error instanceof Error?error.message:"Không thể xóa khóa học.");}
      finally {inFlight.current=false;}
    });
  }
  return <div className={styles.visibilityControl}>
    {!confirming
      ?<button type="button" className={`${styles.secondaryButton} ${styles.dangerAction}`} onClick={()=>{setError("");setConfirming(true);}}><Icon name="trash"/>Xóa</button>
      :<div className={styles.confirmDelete} role="alertdialog" aria-labelledby={id}>
        <p id={id}>Xóa vĩnh viễn “{title}” và toàn bộ bài học? Không thể hoàn tác.</p>
        <div><button type="button" className={`${styles.secondaryButton} ${styles.dangerAction}`} onClick={remove} disabled={pending}>{pending?"Đang xóa…":"Xóa vĩnh viễn"}</button>
          <button type="button" className={styles.secondaryButton} onClick={()=>setConfirming(false)} disabled={pending} autoFocus>Giữ lại</button></div>
      </div>}
    {error&&<p className={styles.error} role="alert">{error}</p>}
  </div>;
}
