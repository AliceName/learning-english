import type { Metadata } from "next";
import { Suspense } from "react";
import HomeNavbar, { NavbarFallback } from "@/components/navigation/home-navbar";
import LandingPage from "@/components/home/landing-page";
import styles from "@/components/home/landing.module.css";

export const metadata: Metadata = {
  title: "LEWA | Nền tảng Học Tiếng Anh Thông Minh",
  description: "Luyện Speaking, Reading, Writing, Listening và Grammar cùng người bạn đồng hành AI. Khám phá lộ trình học tiếng Anh phù hợp với bạn.",
};

export default function Home() {
  return (
    <div className={styles.page}>
      <Suspense fallback={<NavbarFallback />}><HomeNavbar /></Suspense>
      <LandingPage />
    </div>
  );
}
