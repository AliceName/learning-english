"use client";
import Link from "next/link";
import {useState} from "react";
import {isAuthoringSkill,lessonKinds,lessonDraft} from "@/lib/admin-courses";
import Icon from "@/components/site-icon";
import CourseCover from "@/components/courses/course-cover";
import {useWorkspace} from "./course-workspace";
import LessonPreview from "./lesson-preview";
import styles from "./admin.module.css";
export default function CoursePreview(){
  const{course,drafts,generalDraft}=useWorkspace();const[selected,setSelected]=useState<number|null>(null);
  const lesson=course.lessons.find(item=>item.lessonId===selected)??course.lessons[0];
  return <><div className={styles.builderToolbar}><div><h2>Xem trước khóa học</h2><p>Kiểm tra nội dung đã lưu trước khi xuất bản.</p></div><Link href={`/admin/courses/${course.courseId}/publish`} className={styles.primaryButton}>Tiếp tục: Xuất bản <Icon name="arrow"/></Link></div>{Object.keys(drafts).length>0&&<p className={styles.notice}>Bạn còn thay đổi chưa lưu. Bản xem trước dưới đây dùng nội dung đã lưu trên máy chủ.</p>}
    {generalDraft&&<p className={styles.notice}>Thông tin chung có thay đổi chưa lưu. Quay lại bước 1 để lưu.</p>}<section className={styles.coursePreviewHero}><CourseCover url={course.coverImageUrl} title={course.title} eager/><div><span className={styles.eyebrow}>BẢN XEM TRƯỚC</span><h2>{course.title}</h2><p>{course.description||"Chưa có mô tả khóa học."}</p><div className={styles.previewStats}><span><Icon name="book"/>{course.lessons.length} bài học</span><span><Icon name="clock"/>{course.lessons.reduce((total,item)=>total+(item.estimatedMinutes??0),0)} phút dự kiến</span></div></div></section>
    <div className={styles.previewColumns}><section className={styles.panel}><h2>Nội dung khóa học</h2><div className={styles.previewLessonList}>{course.lessons.map(item=><button type="button" key={item.lessonId} onClick={()=>setSelected(item.lessonId)} aria-pressed={lesson?.lessonId===item.lessonId}><Icon name={isAuthoringSkill(item.skillType)?lessonKinds[item.skillType].icon:"book"}/><span><strong>{item.title}</strong><small>{item.difficultyLevel} · {item.estimatedMinutes} phút · {item.isActive?"Đang kích hoạt":"Đã tắt"}</small></span><Icon name="chevron"/></button>)}</div></section><section className={styles.panel}>{lesson&&isAuthoringSkill(lesson.skillType)?<LessonPreview key={lesson.lessonId} lesson={lessonDraft(lesson,lesson.skillType)}/>:<p>Chưa có bài học hỗ trợ xem trước.</p>}</section></div>
  </>;
}
