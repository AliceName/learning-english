import {Suspense,type ReactNode} from "react";
import {redirect} from "next/navigation";
import {connection} from "next/server";
import type {Metadata} from "next";
import {getCurrentUser} from "@/lib/server-auth";
import AdminShell from "@/components/admin/admin-shell";
import AdminRetry from "@/components/admin/admin-retry";
import styles from "@/components/admin/admin.module.css";
export const metadata:Metadata={title:{default:"Studio Admin | LinguaAI",template:"%s | LinguaAI Admin"}};
// This boundary waits for a fresh role check and may redirect; it is not an instant navigation segment.
export const instant=false;
async function AdminAccess({children}:{children:ReactNode}) {
  await connection();
  const session=await getCurrentUser();
  if(session.status==="anonymous")redirect("/login");
  if(session.status==="unavailable")return <div className={styles.loading}><h1>Chưa thể tải trang quản trị</h1><AdminRetry/></div>;
  if(session.user.role!=="admin")redirect("/account");
  return <AdminShell user={session.user}>{children}</AdminShell>;
}
export default function AdminLayout({children}:{children:ReactNode}){return <Suspense fallback={<div className={styles.loading} role="status">Đang tải không gian quản trị…</div>}><AdminAccess>{children}</AdminAccess></Suspense>;}
