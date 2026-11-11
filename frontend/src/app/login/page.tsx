import type { Metadata } from "next";
import { Suspense } from "react";
import AuthScreen from "@/components/auth/auth-screen";
import { safeWritingReturnTo } from "@/lib/writing-return";
import styles from "@/components/auth/auth-screen.module.css";

export const metadata: Metadata = {
  title: "Đăng nhập | LEWA",
  description: "Đăng nhập để tiếp tục hành trình học tiếng Anh cùng LEWA.",
};

async function LoginContent({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { returnTo } = await searchParams;
  return <AuthScreen initialMode="login" returnTo={safeWritingReturnTo(returnTo)} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return <Suspense fallback={<div className={`${styles.shell} ${styles.loading}`} role="status">Đang tải biểu mẫu đăng nhập…</div>}><LoginContent searchParams={searchParams} /></Suspense>;
}
