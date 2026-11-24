import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { readAdmin } from "@/lib/server-admin";
import { duration, lessonSkillLabels, MIN_LEARNERS, type AdminCourseStats, type AdminLessonStats } from "@/lib/admin-content-stats";
import AdminRetry from "@/components/admin/admin-retry";
import styles from "@/components/admin/admin.module.css";

export const metadata = { title: "Thống kê khóa học" };
export const instant = false;
type Params = Promise<{ courseId: string }>;

function Faded({ lesson, children }: { lesson: AdminLessonStats; children: string }) {
  const thin = lesson.learners > 0 && lesson.learners < MIN_LEARNERS;
  return <span className={thin ? styles.thinData : undefined}>{children}</span>;
}

async function CourseStats({ params }: { params: Params }) {
  const { courseId } = await params;
  if (!/^[1-9]\d{0,9}$/u.test(courseId)) notFound();
  const result = await readAdmin<AdminCourseStats>(`courses/${courseId}/stats`);
  if (result.status === "anonymous") redirect("/login");
  if (result.status === "forbidden") redirect("/account");
  if (result.status === "not_found") notFound();
  if (result.status !== "ok") return <div className={styles.empty} role="alert"><h2>Chưa tải được thống kê</h2><AdminRetry /></div>;
  const data = result.data;
  const anyAttempt = data.lessons.some(lesson => lesson.attempts > 0);

  return <section className={styles.panel} aria-labelledby="course-stats-heading">
    <h2 id="course-stats-heading" className={styles.panelTitle}>Thống kê học viên</h2>
    <p className={styles.hint}>{data.enrolled} học viên đã ghi danh (không tính quản trị viên và tài khoản thử nghiệm). Chỉ là số đếm; không hiển thị câu trả lời của học viên.</p>
    {data.lessons.length === 0 ? <p className={styles.hint}>Khóa học chưa có bài học.</p>
      : <>
        {!anyAttempt && <p className={styles.notice}>Chưa có học viên nào làm bài trong khóa học này. Số liệu sẽ xuất hiện khi có người học.</p>}
        <div className={styles.tableWrap}><table className={`${styles.table} ${styles.statsTable}`}>
          <caption className={styles.srOnly}>Thống kê theo bài học</caption>
          <thead><tr><th>BÀI HỌC</th><th>NGƯỜI LÀM</th><th>LƯỢT</th><th>ĐIỂM TB</th><th>ĐẠT ≥ 80</th><th>THỜI GIAN TB</th><th>CHƯA LÀM</th></tr></thead>
          <tbody>{data.lessons.map(lesson => <tr key={lesson.lessonId}>
            <td><strong className={styles.courseTitle}>{lesson.orderIndex + 1}. {lesson.title}</strong>
              <small>{lessonSkillLabels[lesson.skillType] ?? lesson.skillType}{!lesson.isActive && " · đang tắt"}</small>
              {lesson.mostMissed.length > 0 && <details className={styles.missed}><summary>Câu hay sai ({lesson.currentVersionAttempts} lượt trên nội dung hiện tại)</summary>
                <ol>{lesson.mostMissed.map(item => <li key={item.questionId}>
                  <span>Câu {item.questionId + 1}{item.prompt ? `: ${item.prompt}` : ""}</span><strong>{item.misses}/{item.attempts} lượt sai</strong></li>)}</ol>
              </details>}</td>
            <td>{lesson.learners}</td><td>{lesson.attempts}</td>
            <td><Faded lesson={lesson}>{lesson.averageScore === null ? "—" : lesson.averageScore.toLocaleString("vi-VN")}</Faded></td>
            <td><Faded lesson={lesson}>{lesson.passRate === null ? "—" : `${lesson.passRate}%`}</Faded></td>
            <td><Faded lesson={lesson}>{duration(lesson.averageSeconds)}</Faded></td>
            <td>{lesson.notStarted}</td>
          </tr>)}</tbody></table></div>
        <p className={styles.hint}>Bài Viết không có điểm số nên chỉ đếm người làm và lượt nộp. “Câu hay sai” chỉ tính các lượt làm trên nội dung hiện tại của bài; sửa bài thì số đếm bắt đầu lại.
          Số in mờ: dưới {MIN_LEARNERS} người làm.</p>
      </>}
  </section>;
}

export default function CourseStatsPage({ params }: { params: Params }) {
  return <Suspense fallback={<section className={styles.panel}><p className={styles.hint} role="status">Đang tải thống kê…</p></section>}>
    <CourseStats params={params} /></Suspense>;
}
