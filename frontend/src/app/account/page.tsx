import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import MemberShell from "@/components/navigation/member-shell";
import { getCurrentUser } from "@/lib/server-auth";
import ProfileForm from "./profile-form";
import styles from "./account.module.css";

export const metadata: Metadata = { title: "Tài khoản của bạn | LEWA" };

async function AccountContent() {
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect("/login");
  if (session.status === "unavailable") return <MemberShell><main id="main-content" className={styles.panel}><h1>Chưa thể tải tài khoản.</h1><p>Hệ thống đang bận. Vui lòng thử lại sau.</p><a href="/account">Thử lại</a></main></MemberShell>;
  const user = session.user;
  return (
    <MemberShell user={user}>
      <main id="main-content" className={styles.panel} tabIndex={-1}>
        <ProfileForm key={user.userId} user={user} />
        <Link href="/courses" className={styles.homeLink}>Khám phá khóa học →</Link>
      </main>
    </MemberShell>
  );
}

export default function AccountPage() {
  return <Suspense fallback={<p className={styles.panel}>Đang tải tài khoản…</p>}><AccountContent /></Suspense>;
}
