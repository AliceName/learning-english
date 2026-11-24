import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import MemberShell from "@/components/navigation/member-shell";
import CourseFlashcards from "@/components/courses/course-flashcards";
import { getCurrentUser } from "@/lib/server-auth";
import { getCourseDecks, getCourseVocabulary } from "@/lib/server-courses";

export const metadata = { title: "Bộ thẻ từ vựng khóa học | LEWA" };
export const instant = false;
type Props = { params: Promise<{ courseId: string }>; searchParams: Promise<{ lesson?: string }> };
async function Content({ params, searchParams }: Props) {
  const { courseId } = await params;
  if (!/^[1-9]\d*$/.test(courseId) || Number(courseId) > 2147483647) notFound();
  const session = await getCurrentUser();
  const href = `/courses/${courseId}/flashcards`;
  if (session.status === "anonymous") redirect(`/login?next=${encodeURIComponent(href)}`);
  const results = session.status === "authenticated" ? await Promise.all([getCourseVocabulary(Number(courseId)), getCourseDecks(Number(courseId))]) : null;
  if (results?.some(result => result.status === "anonymous")) redirect(`/login?next=${encodeURIComponent(href)}`);
  if (results?.some(result => result.status === "not_found")) notFound();
  const [vocabulary, decks] = results ?? [];
  const { lesson } = await searchParams;
  return <MemberShell user={session.status === "authenticated" ? session.user : undefined} bookmarks>
    {session.status === "authenticated" && vocabulary?.status === "ok"
      ? <CourseFlashcards key={`${session.user.userId}:${courseId}`} data={{ vocabulary: vocabulary.data, decks: decks?.status === "ok" ? decks.data : null }} account={`${session.user.userId}:${session.user.createdAt}`} isAdmin={false} initialLessonId={lesson && /^[1-9]\d*$/.test(lesson) ? Number(lesson) : undefined} />
      : <main id="main-content"><h1>Chưa tải được bộ thẻ khóa học</h1><p>Vui lòng thử lại sau.</p><Link href={href}>Thử lại</Link></main>}
  </MemberShell>;
}
export default function CourseFlashcardsPage(props: Props) { return <Suspense fallback={<p role="status">Đang tải bộ thẻ từ vựng…</p>}><Content {...props} /></Suspense>; }
