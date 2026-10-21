import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import MemberShell from "@/components/navigation/member-shell";
import CourseCover from "@/components/courses/course-cover";
import CatalogState from "@/components/courses/catalog-state";
import Icon from "@/components/site-icon";
import { getCurrentUser } from "@/lib/server-auth";
import { getCourse } from "@/lib/server-courses";
import { durationLabel, skillLabel } from "@/lib/course-catalog";
import styles from "@/components/courses/courses.module.css";

export const metadata: Metadata = { title: "Chi tiết khóa học | LinguaAI" };
async function Detail({ params }: PageProps<"/courses/[courseId]">) {
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect("/login");
  const { courseId } = await params;
  if (!/^[1-9]\d*$/.test(courseId) || Number(courseId) > 2147483647) notFound();
  const result = session.status === "authenticated" ? await getCourse(Number(courseId)) : null;
  if (result?.status === "anonymous") redirect("/login");
  if (result?.status === "not_found") notFound();
  const data = result?.status === "ok" ? result.data : null;
  return <MemberShell user={session.status === "authenticated" ? session.user : undefined}><main id="main-content" tabIndex={-1} className={styles.catalog}>
    <Link href="/courses" className={styles.backLink}>← Danh mục khóa học</Link>
    {!data ? <CatalogState error retry={`/courses/${courseId}`} /> : <>
      <section className={styles.detailHero}><div><span className={styles.eyebrow}>{data.course.sourceType === "system" ? "KHÓA HỌC HỆ THỐNG" : "KHÓA HỌC CỦA BẠN"}</span><h1>{data.course.title}</h1><p>{data.course.description || "Khám phá các bài học trong khóa học này."}</p><div className={styles.skillTags}>{data.course.levels.map(level => <span key={level}>{level}</span>)}{data.course.skills.map(skill => <span key={skill}>{skillLabel(skill)}</span>)}</div><div className={styles.cardMeta}><span><Icon name="book" />{data.course.lessonCount} bài học</span><span><Icon name="clock" />{durationLabel(data.course)}</span></div>{data.course.enrollment && <div className={styles.progress}><div><span>Tiến độ của bạn</span><strong>{data.course.enrollment.progressPercent}%</strong></div><progress value={data.course.enrollment.progressPercent} max={100} aria-label="Tiến độ khóa học" /></div>}</div><CourseCover url={data.course.coverImageUrl} title={data.course.title} personal={data.course.sourceType === "user_upload"} eager /></section>
      <section className={styles.lessonSection}><div className={styles.resultsHeading}><h2>Nội dung khóa học</h2><span>{data.lessons.length} bài học</span></div>{data.lessons.length === 0 ? <p className={styles.lessonEmpty}>Nội dung bài học đang được chuẩn bị.</p> : <ol className={styles.lessons}>{data.lessons.map((lesson, index) => <li key={lesson.lessonId}><span className={styles.lessonIndex}>{String(index + 1).padStart(2, "0")}</span><div><h3>{lesson.title}</h3><span>{skillLabel(lesson.skillType)}{lesson.difficultyLevel && ` · ${lesson.difficultyLevel}`}</span></div><small>{lesson.estimatedMinutes === null ? "Chưa có thời lượng" : `${lesson.estimatedMinutes} phút`}</small></li>)}</ol>}<p className={styles.lessonNote}>Bạn đang xem danh sách nội dung. Chức năng vào học và đăng ký khóa học sẽ được bổ sung sau.</p></section>
    </>}
  </main></MemberShell>;
}
export default function CourseDetailPage(props: PageProps<"/courses/[courseId]">) { return <Suspense fallback={<div className={styles.loading} role="status">Đang tải khóa học…</div>}><Detail {...props} /></Suspense>; }
