import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import CourseFlashcards from "@/components/courses/course-flashcards";
import { getCurrentUser } from "@/lib/server-auth";
import { getCourseDecks, getCourseVocabulary } from "@/lib/server-courses";

export const metadata = { title: "Bộ thẻ từ vựng khóa học" };
export const instant = false;
async function Content({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  if (!/^[1-9]\d*$/.test(courseId) || Number(courseId) > 2147483647) notFound();
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect("/login");
  if (session.status === "authenticated" && session.user.role !== "admin") redirect("/account");
  const [vocabulary, decks] = await Promise.all([getCourseVocabulary(Number(courseId)), getCourseDecks(Number(courseId))]);
  if ([vocabulary, decks].some(result => result.status === "not_found")) notFound();
  if (session.status !== "authenticated" || vocabulary.status !== "ok")
    return <div role="alert"><h2>Chưa tải được bộ thẻ</h2><Link href={`/admin/courses/${courseId}/flashcards`}>Thử lại</Link></div>;
  if (decks.status === "anonymous") redirect("/login");
  return <CourseFlashcards key={`${session.user.userId}:${courseId}`} data={{ vocabulary: vocabulary.data, decks: decks.status === "ok" ? decks.data : null }} account={`${session.user.userId}:${session.user.createdAt}`} isAdmin />;
}
export default function Page(props: { params: Promise<{ courseId: string }> }) { return <Suspense fallback={<p role="status">Đang tải bộ thẻ…</p>}><Content {...props} /></Suspense>; }
