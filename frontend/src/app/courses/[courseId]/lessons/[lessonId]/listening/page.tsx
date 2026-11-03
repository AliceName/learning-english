import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import MemberShell from "@/components/navigation/member-shell";
import ListeningPractice from "@/components/listening/listening-practice";
import { getCurrentUser } from "@/lib/server-auth";
import { getListeningLesson } from "@/lib/server-listening";
import { listeningLoginHref } from "@/lib/listening";
import styles from "@/components/listening/listening.module.css";

export const metadata: Metadata = { title: "Luyện nghe | LEWA" };
export const instant = false;

async function LessonPage({ params }: PageProps<"/courses/[courseId]/lessons/[lessonId]/listening">) {
  const { courseId, lessonId } = await params;
  if (![courseId, lessonId].every(value => /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647)) notFound();
  const session = await getCurrentUser();
  const login = listeningLoginHref(Number(courseId), Number(lessonId));
  if (session.status === "anonymous") redirect(login);
  const response = session.status === "authenticated" ? await getListeningLesson(Number(courseId), Number(lessonId)) : null;
  if (response?.status === "anonymous") redirect(login);
  if (response?.status === "not_found") notFound();
  return <MemberShell user={session.status === "authenticated" ? session.user : undefined}>
    {session.status === "authenticated" && response?.status === "ok" ? <ListeningPractice
      key={`${session.user.userId}:${courseId}:${lessonId}:${response.data.contentVersion}`} userId={session.user.userId} lesson={response.data} />
      : <main id="main-content" tabIndex={-1} className={styles.page}><section className={styles.card}>
        <h1>{response?.status === "unsupported" ? "Bài nghe đang được hoàn thiện" : "Chưa thể tải bài nghe"}</h1>
        <p className={styles.hint}>{response?.status === "unsupported" ? "Nội dung bài học chưa sẵn sàng. Vui lòng chọn bài khác hoặc quay lại sau." : "Kiểm tra kết nối và tải lại trang để tiếp tục."}</p>
        <Link href={`/courses/${courseId}`} className={styles.softButton}>← Quay về khóa học</Link>
      </section></main>}
  </MemberShell>;
}

export default function ListeningPage(props: PageProps<"/courses/[courseId]/lessons/[lessonId]/listening">) {
  return <Suspense fallback={<main className={styles.page}><p role="status">Đang tải bài nghe…</p></main>}><LessonPage {...props} /></Suspense>;
}
