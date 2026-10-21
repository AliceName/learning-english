import Link from "next/link";
import Icon from "@/components/site-icon";
import { durationLabel, skillLabel, type CourseItem } from "@/lib/course-catalog";
import CourseCover from "./course-cover";
import styles from "./courses.module.css";

export default function CourseCard({ course, eager = false }: { course: CourseItem; eager?: boolean }) {
  const enrollment = course.enrollment;
  const progress = Math.max(0, Math.min(100, enrollment?.progressPercent ?? 0));
  const state = enrollment?.status === "in_progress" ? "Đang học" : enrollment?.status === "completed" ? "Đã hoàn thành" : enrollment?.status === "abandoned" ? "Đã tạm dừng" : null;
  return <article className={styles.card}>
    <Link href={`/courses/${course.courseId}`} className={styles.coverLink} tabIndex={-1} aria-hidden="true"><CourseCover url={course.coverImageUrl} title={course.title} personal={course.sourceType === "user_upload"} eager={eager} /></Link>
    <div className={styles.coverBadges}>{state && <span className={enrollment?.status === "completed" ? styles.completedBadge : styles.learningBadge}><span />{state}</span>}<span className={styles.levelBadge}>{course.levels.join(" · ") || "Chưa phân cấp"}</span></div>
    <div className={styles.cardBody}>
      <span className={styles.source}><Icon name={course.sourceType === "system" ? "shield" : "file"} />{course.sourceType === "system" ? "KHÓA HỌC HỆ THỐNG" : "KHÓA HỌC CỦA BẠN"}</span>
      <h2><Link href={`/courses/${course.courseId}`}>{course.title}</Link></h2>
      <p className={styles.description}>{course.description || "Khám phá nội dung và danh sách bài học của khóa học này."}</p>
      <div className={styles.skillTags}>{course.skills.map(skill => <span key={skill}>{skillLabel(skill)}</span>)}</div>
      <div className={styles.cardBottom}>
        {enrollment && <div className={styles.progress}><div><span>Tiến độ của bạn</span><strong>{progress}%</strong></div><progress value={progress} max={100} aria-label={`Tiến độ ${course.title}`} /></div>}
        <div className={styles.cardMeta}><span><Icon name="book" />{course.lessonCount} bài học</span><span><Icon name="clock" />{durationLabel(course)}</span></div>
        <div className={styles.cardFooter}><span><Icon name="users" />{course.enrollmentCount.toLocaleString("vi-VN")} học viên</span><Link href={`/courses/${course.courseId}`} className={styles.cardAction}>Xem khóa học <Icon name="arrow" /></Link></div>
      </div>
    </div>
  </article>;
}
