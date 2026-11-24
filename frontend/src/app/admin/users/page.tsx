import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import Icon from "@/components/site-icon";
import { readAdmin } from "@/lib/server-admin";
import { auditLabel, formatDate, formatDateTime, roleLabels, type AdminAuditEntry, type AdminUserList } from "@/lib/admin-users";
import AdminRetry from "@/components/admin/admin-retry";
import styles from "@/components/admin/admin.module.css";

export const metadata = { title: "Quản lý người dùng" };
type Params = Promise<Record<string, string | string[] | undefined>>;
const pick = (value: unknown, allowed: readonly string[]) => typeof value === "string" && allowed.includes(value) ? value : "";

async function UserList({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const search = typeof params.search === "string" ? params.search.slice(0, 200) : "";
  const role = pick(params.role, ["admin", "user"]), status = pick(params.status, ["active", "locked"]);
  const sort = pick(params.sort, ["newest", "oldest", "recent_study", "name"]) || "newest";
  const rawPage = Number(params.page); const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 10000 ? rawPage : 1;
  const query = new URLSearchParams({ page: String(page), sort });
  if (search) query.set("search", search); if (role) query.set("role", role); if (status) query.set("status", status);
  const [result, audit] = await Promise.all([readAdmin<AdminUserList>(`users?${query}`), readAdmin<AdminAuditEntry[]>("users/audit")]);
  if (result.status === "anonymous") redirect("/login");
  if (result.status === "forbidden") redirect("/account");
  const data = result.status === "ok" ? result.data : null;
  const filtered = Boolean(search || role || status);
  const pageHref = (next: number) => `/admin/users?${new URLSearchParams({ ...Object.fromEntries(query), page: String(next) })}`;

  return <>
    <div className={styles.breadcrumb}>Quản trị hệ thống <span>›</span> Quản lý người dùng</div>
    <div className={styles.pageHeader}><div><span className={styles.eyebrow}>TÀI KHOẢN</span><h1>Quản lý người dùng</h1>
      <p>Tìm tài khoản, khóa hoặc mở khóa và đổi vai trò. Mọi thay đổi đều cần lý do và được ghi nhật ký.</p></div></div>
    <section className={styles.panel} aria-labelledby="users-heading">
      <div className={styles.listHeading}><h2 id="users-heading">Người dùng {data && <small>({data.totalCount})</small>}</h2></div>
      <form action="/admin/users" className={styles.userFilters} role="search">
        <label className={styles.field}>Tìm theo tên hoặc email<input name="search" defaultValue={search} maxLength={200} placeholder="Ví dụ: nguyen@…" /></label>
        <label className={styles.field}>Vai trò<select name="role" defaultValue={role}><option value="">Tất cả</option><option value="user">Học viên</option><option value="admin">Quản trị viên</option></select></label>
        <label className={styles.field}>Trạng thái<select name="status" defaultValue={status}><option value="">Tất cả</option><option value="active">Đang hoạt động</option><option value="locked">Đã khóa</option></select></label>
        <label className={styles.field}>Sắp xếp<select name="sort" defaultValue={sort}><option value="newest">Mới tham gia</option><option value="oldest">Tham gia lâu nhất</option><option value="recent_study">Học gần đây</option><option value="name">Tên A–Z</option></select></label>
        <div className={styles.filterActions}><button className={styles.secondaryButton}>Lọc</button>{filtered && <Link href="/admin/users" className={styles.rowAction}>Xóa bộ lọc</Link>}</div>
      </form>
      {!data ? <div className={styles.empty} role="alert"><h2>Chưa thể tải danh sách</h2><AdminRetry /></div>
        : data.items.length === 0 ? <div className={styles.empty}><Icon name="users" /><h2>{filtered ? "Không có người dùng phù hợp" : "Chưa có người dùng"}</h2>
          {filtered && <p>Điều chỉnh từ khóa hoặc bộ lọc.</p>}</div>
        : <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>NGƯỜI DÙNG</th><th>VAI TRÒ</th><th>TRẠNG THÁI</th><th>THAM GIA</th><th>HỌC GẦN NHẤT</th><th>CHUỖI</th><th><span className={styles.srOnly}>Thao tác</span></th></tr></thead>
          <tbody>{data.items.map(user => <tr key={user.userId}>
            <td><Link href={`/admin/users/${user.userId}`} className={styles.courseTitle}>{user.fullName}</Link><small>{user.email}</small></td>
            <td><span className={user.role === "admin" ? styles.roleAdmin : styles.draft}>{roleLabels[user.role]}</span></td>
            <td><span className={user.isActive ? styles.published : styles.lockedBadge}>{user.isActive ? "Đang hoạt động" : "Đã khóa"}</span></td>
            <td>{formatDate(user.createdAt)}</td><td>{formatDate(user.lastStudyDate)}</td><td>{user.currentStreak} ngày</td>
            <td><Link href={`/admin/users/${user.userId}`} className={styles.rowAction} aria-label={`Xem chi tiết ${user.fullName}`}>Chi tiết<Icon name="arrow" /></Link></td>
          </tr>)}</tbody></table></div>}
      {data && data.totalPages > 1 && <nav aria-label="Phân trang người dùng" className={styles.pagination}>
        {page > 1 && <Link href={pageHref(page - 1)}>← Trang trước</Link>}<span>Trang {data.page}/{data.totalPages}</span>
        {page < data.totalPages && <Link href={pageHref(page + 1)}>Trang sau →</Link>}</nav>}
    </section>
    <section className={`${styles.panel} ${styles.auditPanel}`} aria-labelledby="audit-heading">
      <h2 id="audit-heading">Thao tác gần đây</h2>
      {audit.status !== "ok" ? <p className={styles.hint}>Chưa tải được nhật ký thao tác.</p>
        : audit.data.length === 0 ? <p className={styles.hint}>Chưa có thao tác nào.</p>
        : <ol className={styles.auditList}>{audit.data.map((entry, index) => <li key={index}>
          <strong>{auditLabel(entry)}</strong> · <Link href={`/admin/users/${entry.targetId}`}>người dùng #{entry.targetId}</Link>
          <small>{formatDateTime(entry.at)} · bởi {entry.actorName ?? `#${entry.actorId}`} · Lý do: {entry.reason}</small></li>)}</ol>}
    </section>
  </>;
}

export default function AdminUsersPage({ searchParams }: { searchParams: Params }) {
  return <Suspense fallback={<div className={styles.loading} role="status">Đang tải danh sách người dùng…</div>}><UserList searchParams={searchParams} /></Suspense>;
}
