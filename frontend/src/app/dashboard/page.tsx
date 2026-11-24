import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import MemberShell from "@/components/navigation/member-shell";
import { getCurrentUser } from "@/lib/server-auth";
import DashboardView from "./dashboard-view";
import styles from "./dashboard.module.css";

export const metadata: Metadata = { title: "Tổng quan học tập | LEWA" };

async function DashboardContent() {
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect("/login?next=%2Fdashboard");
  if (session.status === "unavailable") return <MemberShell><main id="main-content" className={styles.page}>
    <h1>Chưa thể tải tổng quan.</h1><p>Hệ thống đang bận. Vui lòng thử lại sau.</p><a href="/dashboard">Thử lại</a></main></MemberShell>;
  const user = session.user;
  return <MemberShell user={user}>
    <DashboardView key={user.userId} fullName={user.fullName} />
  </MemberShell>;
}

export default function DashboardPage() {
  return <Suspense fallback={<p role="status">Đang tải tổng quan…</p>}><DashboardContent /></Suspense>;
}
