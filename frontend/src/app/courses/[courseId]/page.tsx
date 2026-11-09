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
import { listeningHref } from "@/lib/listening";
import styles from "@/components/courses/courses.module.css";

export const metadata: Metadata = { title: "Chi tiết khóa học | LEWA" };
async function Detail({ params }: PageProps<"/courses/[courseId]">) {
  const { courseId } = await params;
  if (!/^[1-9]\d*$/.test(courseId) || Number(courseId) > 2147483647) notFound();
  const loginHref = `/login?next=${encodeURIComponent(`/courses/${courseId}`)}`;
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect(loginHref);
  const result = session.status === "authenticated" ? await getCourse(Number(courseId)) : null;
  if (result?.status === "anonymous") redirect(loginHref);
  if (result?.status === "not_found") notFound();
  const data = result?.status === "ok" ? result.data : null;
  return <MemberShell user={session.status === "authenticated" ? session.user : undefined}><main id="main-content" tabIndex={-1} className={styles.catalog}>
    <Link href="/courses" className={styles.backLink}>← Danh mục khóa học</Link>
    {!data ? <CatalogState error retry={`/courses/${courseId}`} /> : <>
      <section className={styles.detailHero}><div><span className={styles.eyebrow}>{data.course.sourceType === "system" ? "KHÓA HỌC HỆ THỐNG" : "KHÓA HỌC CỦA BẠN"}</span><h1>{data.course.title}</h1><p>{data.course.description || "Khám phá các bài học trong khóa học này."}</p><div className={styles.skillTags}>{data.course.levels.map(level => <span key={level}>{level}</span>)}{data.course.skills.map(skill => <span key={skill}>{skillLabel(skill)}</span>)}</div><div className={styles.cardMeta}><span><Icon name="book" />{data.course.lessonCount} bài học</span><span><Icon name="clock" />{durationLabel(data.course)}</span></div>{data.course.enrollment && <div className={styles.progress}><div><span>Tiến độ của bạn</span><strong>{data.course.enrollment.progressPercent}%</strong></div><progress value={data.course.enrollment.progressPercent} max={100} aria-label="Tiến độ khóa học" /></div>}</div><CourseCover url={data.course.coverImageUrl} title={data.course.title} personal={data.course.sourceType === "user_upload"} eager /></section>
      <section className={styles.lessonSection}><div className={styles.resultsHeading}><h2>Nội dung khóa học</h2><span>{data.lessons.length} bài học</span></div>
        {data.listeningProgress && <div className={styles.listeningProgress}><span>Tiến độ luyện nghe</span><strong>{data.listeningProgress.completedLessons}/{data.listeningProgress.totalLessons} bài</strong><progress value={data.listeningProgress.completedLessons} max={data.listeningProgress.totalLessons} aria-label="Tiến độ luyện nghe" /></div>}
        {data.lessons.length === 0 ? <p className={styles.lessonEmpty}>Nội dung bài học đang được chuẩn bị.</p> : <ol className={styles.lessons}>{data.lessons.map((lesson, index) => <li key={lesson.lessonId}><span className={styles.lessonIndex}>{String(index + 1).padStart(2, "0")}</span><div><h3>{lesson.title}</h3><span>{skillLabel(lesson.skillType)}{lesson.difficultyLevel && ` · ${lesson.difficultyLevel}`}</span>{lesson.listeningStatus && <p className={styles.listeningStatus}>Đã làm {lesson.listeningStatus.attemptCount} lần · Gần nhất {lesson.listeningStatus.latestScore}/100 điểm</p>}</div><div className={styles.lessonAction}><small>{lesson.estimatedMinutes === null ? "Chưa có thời lượng" : `${lesson.estimatedMinutes} phút`}</small>{lesson.skillType === "listening" && <Link className={styles.cardAction} href={listeningHref(data.course.courseId, lesson.lessonId)}>{lesson.listeningStatus ? "Làm lại" : "Làm bài nghe"}<Icon name="headphones" /></Link>}{lesson.skillType === "speaking" && <Link className={styles.practiceLink} href={`/courses/${courseId}/speaking/${lesson.lessonId}`}>Luyện nói →</Link>}</div></li>)}</ol>}
        {data.lessons.some(lesson => lesson.skillType === "speaking") && <p className={styles.lessonNote}>Chọn Luyện nói ở bài Speaking để ghi âm, xem điểm và luyện lại.</p>}
      </section>
    </>}
  </main></MemberShell>;
}
export default function CourseDetailPage(props: PageProps<"/courses/[courseId]">) { return <Suspense fallback={<div className={styles.loading} role="status">Đang tải khóa học…</div>}><Detail {...props} /></Suspense>; }
