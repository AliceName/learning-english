import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import MemberShell from "@/components/navigation/member-shell";
import { CourseReadingPractice, CourseWritingPractice } from "@/components/course-text/text-lesson";
import { getCurrentUser } from "@/lib/server-auth";
import { getCourseTextLesson } from "@/lib/server-course-text";
import type { ReadingLesson, WritingLesson } from "@/lib/course-text";

export const metadata: Metadata = { title: "Bài học Reading & Writing | LEWA" };
export const instant = false;
type Props = { params: Promise<{ courseId: string; lessonId: string; textSkill: string }> };
async function Content({ params }: Props) {
  const { courseId, lessonId, textSkill } = await params;
  if (textSkill !== "reading" && textSkill !== "writing" || ![courseId, lessonId].every(id => /^[1-9]\d*$/.test(id) && Number(id) <= 2147483647)) notFound();
  const path = `/courses/${courseId}/lessons/${lessonId}/${textSkill}`;
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect(`/login?next=${encodeURIComponent(path)}`);
  const result = session.status === "authenticated" ? await getCourseTextLesson(Number(courseId), Number(lessonId), textSkill) : null;
  if (result?.status === "anonymous") redirect(`/login?next=${encodeURIComponent(path)}`);
  if (result?.status === "not_found") notFound();
  return <MemberShell user={session.status === "authenticated" ? session.user : undefined}>
    {result?.status === "ok" && session.status === "authenticated" ? textSkill === "reading"
      ? <CourseReadingPractice key={`${session.user.userId}:${lessonId}:${result.data.contentVersion}`} userId={session.user.userId} lesson={result.data as ReadingLesson} />
      : <CourseWritingPractice key={`${session.user.userId}:${lessonId}:${result.data.contentVersion}`} lesson={result.data as WritingLesson} />
      : <main id="main-content" tabIndex={-1}><h1>{result?.status === "unsupported" ? "Bài học đang được hoàn thiện" : "Chưa thể tải bài học"}</h1><p>Hãy tải lại trang hoặc chọn bài học khác.</p><Link href={`/courses/${courseId}`}>← Về khóa học</Link></main>}
  </MemberShell>;
}
export default function Page(props: Props) { return <Suspense fallback={<p role="status">Đang tải bài học…</p>}><Content {...props} /></Suspense>; }
