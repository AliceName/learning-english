import Link from "next/link";
import Icon from "@/components/site-icon";
import { durationLabel } from "@/lib/course-catalog";
import { getCurrentUser } from "@/lib/server-auth";
import { getFeaturedCourses } from "@/lib/server-courses";
import styles from "./landing.module.css";

export default async function FeaturedCourses() {
  const [courses, session] = await Promise.all([getFeaturedCourses(), getCurrentUser()]);

  if (!courses?.length) {
    return <p className={styles.courseNotice} role="status">
      {courses ? "Hiện chưa có khóa học đã xuất bản." : "Chưa thể tải khóa học. Vui lòng thử lại sau."}
    </p>;
  }

  return <div className={styles.courseGrid}>
    {courses.map((course, index) => {
      const coursePath = `/courses/${course.courseId}`;
      const href = session.status === "anonymous" ? `/login?next=${encodeURIComponent(coursePath)}` : coursePath;
      return <article key={course.courseId} className={styles.courseCard} data-tone={index}>
        <div className={styles.courseInfo}>
          {course.levels.length > 0 && <span className={styles.courseLevel}>Cấp độ {course.levels.join(" · ")}</span>}
          <h3>{course.title}</h3>
          {course.description && <p>{course.description}</p>}
          <div className={styles.courseMeta}>
            <span><Icon name="clock" />{durationLabel(course)}</span>
            <span><Icon name="book" />{course.lessonCount} bài học</span>
          </div>
          <Link href={href} prefetch={false} aria-label={`Học ngay: ${course.title}`}>Học ngay <Icon name="arrow" /></Link>
        </div>
      </article>;
    })}
  </div>;
}
