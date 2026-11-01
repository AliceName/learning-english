"use client";
import Link from "next/link";
import Icon from "@/components/site-icon";
import {useWorkspace} from "./course-workspace";
import CourseVisibilityButton from "./course-visibility-button";
import styles from "./admin.module.css";
export default function CoursePublish(){
  const{course,drafts,generalDraft,replaceCourse}=useWorkspace();
  const checks=[{label:"Tên và mô tả khóa học",done:!!course.title&&!!course.description},{label:"Ảnh bìa khóa học",done:!!course.coverImageUrl},{label:"Có bài học được kích hoạt",done:course.lessons.some(item=>item.isActive)},{label:"Không có thay đổi chưa lưu",done:Object.keys(drafts).length===0&&!generalDraft}];
  const grammarLessons=course.lessons.filter(item=>item.isActive&&item.skillType==="grammar");
  if(grammarLessons.length)checks.push({label:"Grammar: chủ điểm, quy tắc và bài tập",done:grammarLessons.every(item=>!!item.grammar?.topic.trim()&&!!item.grammar?.rules.trim()&&!!item.grammar?.questions.length)});
  const writingLessons=course.lessons.filter(item=>item.isActive&&item.skillType==="writing");
  if(writingLessons.length)checks.push({label:"Writing: đề bài, giới hạn từ và tiêu chí đánh giá",done:writingLessons.every(item=>!!item.writing?.prompt.trim()&&item.writing.minWords>=1&&item.writing.maxWords>=item.writing.minWords&&!!item.writing.rubric.length&&item.writing.rubric.reduce((sum,criterion)=>sum+criterion.weight,0)===100)});
  const readingLessons=course.lessons.filter(item=>item.isActive&&item.skillType==="reading");
  if(readingLessons.length)checks.push({label:"Reading: bài đọc và câu hỏi",done:readingLessons.every(item=>!!item.reading?.passage.trim()&&!!item.reading.questions.length)});
  return <section className={styles.publishPanel}><span className={styles.publishIcon}><Icon name={course.isPublished?"globe":"eye"}/></span><span className={styles.eyebrow}>COURSE VISIBILITY</span><h2>{course.isPublished?"Khóa học đang hiển thị":"Khóa học đang ẩn"}</h2><p>{course.isPublished?"Học viên có thể tìm và truy cập khóa học. Bạn có thể chỉnh sửa hoặc tạm ẩn khóa học bất cứ lúc nào.":"Khóa học chưa hiển thị với học viên. Hoàn thiện và lưu nội dung trước khi bật hiển thị."}</p>
    <ul className={styles.checklist}>{checks.map(item=><li key={item.label}><Icon name={item.done?"check":"clock"}/>{item.label}<span>{item.done?"Sẵn sàng":"Cần bổ sung"}</span></li>)}</ul>
    <div className={styles.publishActions}><Link href={`/admin/courses/${course.courseId}/general`} className={styles.secondaryButton}>Chỉnh sửa khóa học</Link><Link href={`/admin/courses/${course.courseId}/preview`} className={styles.secondaryButton}><Icon name="eye"/>Xem trước</Link><CourseVisibilityButton courseId={course.courseId} isPublished={course.isPublished} disabled={!course.isPublished&&checks.some(item=>!item.done)} onChanged={replaceCourse}/>{course.isPublished&&<Link href={`/courses/${course.courseId}`} className={styles.primaryButton}>Xem trang khóa học <Icon name="arrow"/></Link>}</div>
  </section>;
}
