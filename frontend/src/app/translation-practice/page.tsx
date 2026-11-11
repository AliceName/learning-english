import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import MemberShell from "@/components/navigation/member-shell";
import TranslationPractice from "@/components/translation-practice/translation-practice";
import { getCurrentUser } from "@/lib/server-auth";

export const metadata: Metadata = { title: "Luyện phiên dịch | LEWA" };

async function TranslationPracticeContent() {
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect("/login");
  if (session.status === "unavailable") {
    return <MemberShell variant="catalog">
      <main id="main-content" tabIndex={-1}>
        <h1>Chưa thể mở trang Luyện phiên dịch</h1>
        <p>Vui lòng tải lại trang để kết nối với tài khoản của bạn.</p>
      </main>
    </MemberShell>;
  }
  return <MemberShell user={session.user} variant="catalog">
    <TranslationPractice key={session.user.userId} />
  </MemberShell>;
}

export default function TranslationPracticePage() {
  return <Suspense fallback={<p role="status">Đang mở trang Luyện phiên dịch…</p>}><TranslationPracticeContent /></Suspense>;
}
