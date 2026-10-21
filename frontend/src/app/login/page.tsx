import type { Metadata } from "next";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Đăng nhập | LinguaAI",
  description: "Đăng nhập để tiếp tục hành trình học tiếng Anh cùng LinguaAI.",
};

export default function LoginPage() {
  return <LoginForm />;
}
