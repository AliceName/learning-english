import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import MemberShell from "@/components/navigation/member-shell";
import SpeakingPractice from "@/components/speaking/speaking-practice";
import { getCurrentUser } from "@/lib/server-auth";
import { getSpeakingLesson, getSpeakingHistory } from "@/lib/server-speaking";

export const metadata = { title: "Luyện nói | LinguaAI" };
export const instant = false;
async function Practice({ params }: { params: Promise<{ courseId: string; lessonId: string }> }) {
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect("/login");
  const { courseId, lessonId } = await params;
  if (![courseId, lessonId].every(id => /^[1-9]\d*$/.test(id) && Number(id) <= 2147483647)) notFound();
  const result = session.status === "authenticated" ? await getSpeakingLesson(Number(lessonId)) : null;
  if (result?.status === "anonymous") redirect("/login");
  if (result?.status === "not_found" || result?.status === "ok" && result.data.courseId !== Number(courseId)) notFound();
  if (!result || result.status !== "ok") return <MemberShell user={session.status === "authenticated" ? session.user : undefined}><main style={{ padding: 32 }}><h1>Chưa tải được bài luyện nói</h1><p>Vui lòng thử lại khi máy chủ sẵn sàng.</p><Link href={`/courses/${courseId}`}>Quay lại khóa học</Link></main></MemberShell>;
  const history = await getSpeakingHistory(Number(lessonId));
  return <MemberShell user={session.status === "authenticated" ? session.user : undefined}><SpeakingPractice key={result.data.lessonId} lesson={result.data} initialHistory={history.status === "ok" ? history.data : []} historyUnavailable={history.status !== "ok"} /></MemberShell>;
}
export default function SpeakingPage(props: { params: Promise<{ courseId: string; lessonId: string }> }) {
  return <Suspense fallback={<p style={{ padding: 32 }} role="status">Đang tải bài luyện nói…</p>}><Practice {...props} /></Suspense>;
}
