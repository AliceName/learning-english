import type { Metadata } from "next";
import { Suspense } from "react";
import AuthScreen from "@/components/auth/auth-screen";
import styles from "@/components/auth/auth-screen.module.css";
import { safeWritingReturnTo } from "@/lib/writing-return";

export const metadata: Metadata = {
  title: "Đăng ký tài khoản | LEWA",
  description: "Tạo tài khoản LEWA và bắt đầu hành trình học tiếng Anh của bạn.",
};

async function RegistrationContent({ searchParams }: Pick<PageProps<"/register">, "searchParams">) {
  const { email, returnTo } = await searchParams;
  return <AuthScreen initialMode="register" initialEmail={typeof email === "string" ? email.slice(0, 255) : ""} returnTo={safeWritingReturnTo(returnTo)} />;
}

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return <Suspense fallback={<div className={`${styles.shell} ${styles.loading}`} role="status">Đang tải biểu mẫu đăng ký…</div>}><RegistrationContent searchParams={searchParams} /></Suspense>;
}
