import type { Metadata } from "next";
import { Suspense } from "react";
import RegistrationForm from "./registration-form";
import styles from "./register.module.css";

export const metadata: Metadata = {
  title: "Đăng ký tài khoản | LinguaAI",
  description: "Tạo tài khoản LinguaAI và bắt đầu hành trình học tiếng Anh của bạn.",
};

async function RegistrationContent({ searchParams }: Pick<PageProps<"/register">, "searchParams">) {
  const { email } = await searchParams;
  return <RegistrationForm initialEmail={typeof email === "string" ? email.slice(0, 255) : ""} />;
}

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return <Suspense fallback={<div className={`${styles.shell} ${styles.loading}`} role="status">Đang tải biểu mẫu đăng ký…</div>}><RegistrationContent searchParams={searchParams} /></Suspense>;
}
