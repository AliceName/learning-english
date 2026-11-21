import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { readAdmin } from "@/lib/server-admin";
import { auditLabel, formatDate, formatDateTime, roleLabels, type AdminUserDetail } from "@/lib/admin-users";
import AdminRetry from "@/components/admin/admin-retry";
import UserActions from "@/components/admin/user-actions";
import styles from "@/components/admin/admin.module.css";

export const metadata = { title: "Chi tiết người dùng" };
type Params = Promise<{ userId: string }>;

async function UserDetail({ params }: { params: Params }) {
  const { userId } = await params;
  if (!/^[1-9]\d{0,9}$/u.test(userId)) notFound();
  const result = await readAdmin<AdminUserDetail>(`users/${userId}`);
  if (result.status === "anonymous") redirect("/login");
  if (result.status === "forbidden") redirect("/account");
  if (result.status === "not_found") notFound();
  if (result.status !== "ok") return <div className={styles.empty} role="alert"><h2>Chưa thể tải người dùng</h2><AdminRetry /></div>;
  const user = result.data;
  const stats: [string, number | null][] = [
    ["Ngày học trong năm", user.stats.studyDaysThisYear], ["Bài viết đã nộp", user.stats.writingSubmissions],
    ["Bộ thẻ / thẻ", null], ["Khóa học đã ghi danh", user.stats.enrolledCourses], ["Lượt gọi AI (30 ngày)", user.stats.aiCallsLast30Days],
  ];
  return <>
    <div className={styles.breadcrumb}><Link href="/admin/users">Quản lý người dùng</Link> <span>›</span> #{user.userId}</div>
    <div className={styles.pageHeader}><div><span className={styles.eyebrow}>NGƯỜI DÙNG #{user.userId}</span><h1>{user.fullName}</h1>
      <p>{user.email}</p>
      <p className={styles.badgeRow}><span className={user.role === "admin" ? styles.roleAdmin : styles.draft}>{roleLabels[user.role]}</span>
        <span className={user.isActive ? styles.published : styles.lockedBadge}>{user.isActive ? "Đang hoạt động" : "Đã khóa"}</span></p></div>
      <Link href="/admin/users" className={styles.secondaryButton}>← Danh sách</Link></div>

    <section className={styles.panel} aria-labelledby="user-stats">
      <h2 id="user-stats" className={styles.panelTitle}>Hoạt động</h2>
      <p className={styles.hint}>Chỉ là số đếm; trang quản trị không hiển thị nội dung bài viết hay bản ghi âm của học viên.</p>
      <dl className={styles.userStats}>
        {stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{label === "Bộ thẻ / thẻ"
          ? `${user.stats.flashcardDecks} / ${user.stats.flashcards}` : value ?? "—"}</dd></div>)}
        <div><dt>Chuỗi ngày (kỷ lục)</dt><dd>{user.currentStreak} ({user.longestStreak})</dd></div>
      </dl>
      <dl className={styles.userFacts}>
        <div><dt>Mục tiêu CEFR</dt><dd>{user.targetLevel ?? "Chưa đặt"}</dd></div>
        <div><dt>Tham gia</dt><dd>{formatDate(user.createdAt)}</dd></div>
        <div><dt>Học gần nhất</dt><dd>{formatDate(user.lastStudyDate)}</dd></div>
        <div><dt>Cập nhật hồ sơ</dt><dd>{formatDate(user.updatedAt)}</dd></div>
      </dl>
    </section>

    <section className={styles.panel} aria-labelledby="user-actions">
      <h2 id="user-actions" className={styles.panelTitle}>Thao tác</h2>
      <UserActions user={user} />
    </section>

    <section className={`${styles.panel} ${styles.auditPanel}`} aria-labelledby="user-history">
      <h2 id="user-history" className={styles.panelTitle}>Lịch sử thao tác</h2>
      {user.history.length === 0 ? <p className={styles.hint}>Chưa có thao tác nào với tài khoản này.</p>
        : <ol className={styles.auditList}>{user.history.map((entry, index) => <li key={index}>
          <strong>{auditLabel(entry)}</strong><small>{formatDateTime(entry.at)} · bởi {entry.actorName ?? `#${entry.actorId}`} · Lý do: {entry.reason}</small></li>)}</ol>}
    </section>
  </>;
}

export default function AdminUserPage({ params }: { params: Params }) {
  return <Suspense fallback={<div className={styles.loading} role="status">Đang tải người dùng…</div>}><UserDetail params={params} /></Suspense>;
}
