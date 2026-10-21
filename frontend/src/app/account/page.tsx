import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import MemberShell from "@/components/navigation/member-shell";
import { getCurrentUser } from "@/lib/server-auth";
import shared from "../register/register.module.css";
import styles from "./account.module.css";

export const metadata: Metadata = { title: "Tài khoản của bạn | LinguaAI" };

async function AccountContent() {
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect("/login");
  if (session.status === "unavailable") return <MemberShell><main id="main-content" className={styles.panel}><h1>Chưa thể tải tài khoản.</h1><p>Hệ thống đang bận. Vui lòng thử lại sau.</p><a href="/account">Thử lại</a></main></MemberShell>;
  const user = session.user;
  return (
    <MemberShell user={user}>
      <main id="main-content" className={styles.panel} tabIndex={-1}>
        <span className={styles.avatar} aria-hidden="true">{Array.from(user.fullName)[0]?.toUpperCase()}</span>
        <span className={shared.eyebrow}>CHÀO MỪNG BẠN TRỞ LẠI</span>
        <h1>Xin chào, {user.fullName}!</h1>
        <p>Bạn đã đăng nhập thành công. Một ngày mới, một bước tiến mới cùng tiếng Anh.</p>
        <dl id="profile" className={styles.details}><div><dt>Địa chỉ email</dt><dd>{user.email}</dd></div><div><dt>Mục tiêu CEFR</dt><dd>{user.targetLevel ?? "Chưa chọn"}</dd></div><div><dt>Ngày tạo tài khoản</dt><dd>{new Date(user.createdAt).toLocaleDateString("vi-VN")}</dd></div></dl>
        <Link href="/courses" className={styles.homeLink}>Khám phá khóa học →</Link>
      </main>
    </MemberShell>
  );
}

export default function AccountPage() {
  return <Suspense fallback={<p className={styles.panel}>Đang tải tài khoản…</p>}><AccountContent /></Suspense>;
}
