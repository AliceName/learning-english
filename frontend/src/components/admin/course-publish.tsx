"use client";
import Link from "next/link";
import {useRef,useState} from "react";
import Icon from "@/components/site-icon";
import {adminRequest,type AdminCourse} from "@/lib/admin-courses";
import {useWorkspace} from "./course-workspace";
import styles from "./admin.module.css";
export default function CoursePublish(){
  const{course,drafts,generalDraft,replaceCourse}=useWorkspace();const[pending,setPending]=useState(false);const[error,setError]=useState("");const inFlight=useRef(false);
  const checks=[{label:"Tên và mô tả khóa học",done:!!course.title&&!!course.description},{label:"Ảnh bìa khóa học",done:!!course.coverImageUrl},{label:"Có bài học được kích hoạt",done:course.lessons.some(item=>item.isActive)},{label:"Không có thay đổi chưa lưu",done:Object.keys(drafts).length===0&&!generalDraft}];
  const grammarLessons=course.lessons.filter(item=>item.isActive&&item.skillType==="grammar");
  if(grammarLessons.length)checks.push({label:"Grammar: chủ điểm, quy tắc và bài tập",done:grammarLessons.every(item=>!!item.grammar?.topic.trim()&&!!item.grammar?.rules.trim()&&!!item.grammar?.questions.length)});
  const writingLessons=course.lessons.filter(item=>item.isActive&&item.skillType==="writing");
  if(writingLessons.length)checks.push({label:"Writing: đề bài, giới hạn từ và tiêu chí đánh giá",done:writingLessons.every(item=>!!item.writing?.prompt.trim()&&item.writing.minWords>=1&&item.writing.maxWords>=item.writing.minWords&&!!item.writing.rubric.length&&item.writing.rubric.reduce((sum,criterion)=>sum+criterion.weight,0)===100)});
  const readingLessons=course.lessons.filter(item=>item.isActive&&item.skillType==="reading");
  if(readingLessons.length)checks.push({label:"Reading: bài đọc và câu hỏi",done:readingLessons.every(item=>!!item.reading?.passage.trim()&&!!item.reading.questions.length)});
  async function publish(){if(inFlight.current)return;inFlight.current=true;setPending(true);setError("");try{replaceCourse(await adminRequest<AdminCourse>(`courses/${course.courseId}/publish`,{method:"POST"}));}catch(error){setError(error instanceof Error?error.message:"Không thể xuất bản.");}finally{inFlight.current=false;setPending(false);}}
  return <section className={styles.publishPanel}><span className={styles.publishIcon}><Icon name={course.isPublished?"check":"globe"}/></span><span className={styles.eyebrow}>{course.isPublished?"READY TO LEARN":"FINAL REVIEW"}</span><h2>{course.isPublished?"Khóa học đã được xuất bản":"Sẵn sàng chia sẻ kiến thức?"}</h2><p>{course.isPublished?"Khóa học đã hiển thị trong danh mục của học viên.":"Kiểm tra lại nội dung. Máy chủ sẽ xác thực các bài học đang kích hoạt trước khi xuất bản."}</p>
    <ul className={styles.checklist}>{checks.map(item=><li key={item.label}><Icon name={item.done?"check":"clock"}/>{item.label}<span>{item.done?"Sẵn sàng":"Cần bổ sung"}</span></li>)}</ul>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    <div className={styles.publishActions}><Link href={`/admin/courses/${course.courseId}/preview`} className={styles.secondaryButton}><Icon name="eye"/>Xem trước</Link>{course.isPublished?<Link href={`/courses/${course.courseId}`} className={styles.primaryButton}>Xem trang khóa học <Icon name="arrow"/></Link>:<button type="button" onClick={publish} className={styles.primaryButton} disabled={pending||checks.some(item=>!item.done)}><Icon name="globe"/>{pending?"Đang xuất bản…":"Xuất bản khóa học"}</button>}</div>
  </section>;
}
