import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import MemberShell from "@/components/navigation/member-shell";
import CourseGenerator from "@/components/ai-courses/course-generator";
import { getCurrentUser } from "@/lib/server-auth";

export const metadata: Metadata = { title: "Tạo khóa học AI | LEWA" };

async function Content() {
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect("/login");
  return <MemberShell variant="catalog" user={session.status === "authenticated" ? session.user : undefined}>
    {session.status === "authenticated" ? <CourseGenerator key={session.user.userId} fullName={session.user.fullName} targetLevel={session.user.targetLevel} /> : <main id="main-content"><h1>Chưa kết nối được tài khoản</h1><p>Hãy tải lại trang để tiếp tục.</p></main>}
  </MemberShell>;
}
export default function Page() {
  return <Suspense fallback={<p role="status">Đang mở trình tạo khóa học…</p>}><Content /></Suspense>;
}
