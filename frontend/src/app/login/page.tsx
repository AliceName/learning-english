import type { Metadata } from "next";
import AuthScreen from "@/components/auth/auth-screen";

export const metadata: Metadata = {
  title: "Đăng nhập | LEWA",
  description: "Đăng nhập để tiếp tục hành trình học tiếng Anh cùng LEWA.",
};

export default function LoginPage() {
  return <AuthScreen initialMode="login" />;
}
