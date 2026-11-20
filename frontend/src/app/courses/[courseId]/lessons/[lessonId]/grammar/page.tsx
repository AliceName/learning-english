import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import MemberShell from "@/components/navigation/member-shell";
import GrammarPractice from "@/components/grammar/grammar-practice";
import { getCurrentUser } from "@/lib/server-auth";
import { getGrammarLesson } from "@/lib/server-grammar";
import { grammarLoginHref } from "@/lib/grammar";
import styles from "@/components/grammar/grammar.module.css";

export const metadata: Metadata = { title: "Luyện ngữ pháp | LEWA" };
export const instant = false;

async function LessonPage({ params }: PageProps<"/courses/[courseId]/lessons/[lessonId]/grammar">) {
  const { courseId, lessonId } = await params;
  if (![courseId, lessonId].every(value => /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647)) notFound();
  const session = await getCurrentUser();
  const login = grammarLoginHref(Number(courseId), Number(lessonId));
  if (session.status === "anonymous") redirect(login);
  const response = session.status === "authenticated" ? await getGrammarLesson(Number(courseId), Number(lessonId)) : null;
  if (response?.status === "anonymous") redirect(login);
  if (response?.status === "not_found") notFound();
  return <MemberShell user={session.status === "authenticated" ? session.user : undefined} contentClassName={styles.shellContent}>
    {session.status === "authenticated" && response?.status === "ok" ? <GrammarPractice
      key={`${session.user.userId}:${courseId}:${lessonId}:${response.data.contentVersion}`} userId={session.user.userId} lesson={response.data} />
      : <main id="main-content" tabIndex={-1} className={styles.page}><section className={styles.card}>
        <h1>{response?.status === "unsupported" ? "Bài ngữ pháp đang được hoàn thiện" : "Chưa thể tải bài ngữ pháp"}</h1>
        <p>{response?.status === "unsupported" ? "Nội dung bài học chưa sẵn sàng. Vui lòng chọn bài khác hoặc quay lại sau." : "Kiểm tra kết nối và tải lại trang để tiếp tục."}</p>
        <Link href={`/courses/${courseId}`} className={styles.secondary}>← Quay về khóa học</Link>
      </section></main>}
  </MemberShell>;
}

export default function GrammarPage(props: PageProps<"/courses/[courseId]/lessons/[lessonId]/grammar">) {
  return <Suspense fallback={<main className={styles.page}><p role="status">Đang tải bài ngữ pháp…</p></main>}><LessonPage {...props} /></Suspense>;
}
