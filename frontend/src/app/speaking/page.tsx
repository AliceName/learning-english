import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import MemberShell from "@/components/navigation/member-shell";
import FreeSpeaking from "@/components/speaking/free-speaking";
import { getCurrentUser } from "@/lib/server-auth";

export const metadata: Metadata = { title: "Luyện nói | LEWA" };

async function SpeakingContent() {
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect("/login");
  if (session.status === "unavailable") {
    return <MemberShell variant="catalog">
      <main id="main-content" tabIndex={-1}>
        <h1>Chưa thể mở trang Luyện nói</h1>
        <p>Vui lòng tải lại trang để kết nối với tài khoản của bạn.</p>
      </main>
    </MemberShell>;
  }
  const { user } = session;
  const account = `${user.userId}:${user.createdAt}`;
  return <MemberShell user={user} variant="catalog">
    <FreeSpeaking key={account} account={account} />
  </MemberShell>;
}

export default function SpeakingPage() {
  return <Suspense fallback={<p role="status">Đang mở trang Luyện nói…</p>}><SpeakingContent /></Suspense>;
}
