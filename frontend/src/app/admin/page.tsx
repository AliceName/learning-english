import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import Icon from "@/components/site-icon";
import { readAdmin } from "@/lib/server-admin";
import { auditLabel, formatDateTime } from "@/lib/admin-users";
import { attentionText, shortDay, skillLabels, statusLabels, type AdminOverview, type AdminServiceReport } from "@/lib/admin-overview";
import AdminRetry from "@/components/admin/admin-retry";
import styles from "@/components/admin/admin.module.css";

export const metadata = { title: "Tổng quan" };
export const instant = false;
type Params = Promise<Record<string, string | string[] | undefined>>;

function Unavailable({ title }: { title: string }) {
  return <div className={styles.empty} role="alert"><h2>{title}</h2><AdminRetry /></div>;
}

async function Services({ searchParams }: { searchParams: Params }) {
  const refresh = (await searchParams).check === "services";
  const result = await readAdmin<AdminServiceReport>(`overview/services${refresh ? "?refresh=true" : ""}`);
  if (result.status === "anonymous") redirect("/login");
  if (result.status === "forbidden") redirect("/account");
  if (result.status !== "ok") return <Unavailable title="Chưa kiểm tra được dịch vụ" />;
  const { services, checkedAt } = result.data;
  const down = services.filter(service => service.status === "down").length;
  return <>
    <div className={styles.listHeading}>
      <h2 id="services-heading" className={styles.panelTitle}>Tình trạng dịch vụ {down > 0 && <span className={styles.lockedBadge}>{down} không hoạt động</span>}</h2>
      <form action="/admin"><input type="hidden" name="check" value="services" />
        <button className={styles.secondaryButton}>Kiểm tra lại</button></form>
    </div>
    <ul className={styles.serviceGrid}>{services.map(service => <li key={service.key} className={styles[`service_${service.status}`]}>
      <span className={styles.serviceState}><Icon name={service.status === "ok" ? "check" : service.status === "down" ? "close" : "shield"} />
        {statusLabels[service.status]}</span>
      <strong>{service.name}</strong>
      <small>{service.detail}{service.latencyMs !== null && service.status === "ok" ? ` · ${service.latencyMs} ms` : ""}</small>
    </li>)}</ul>
    <p className={styles.hint}>Kiểm tra lúc {formatDateTime(checkedAt)}. Kết quả được giữ 30 giây. AI bên ngoài (Gemini) không được gọi thử để tránh tốn lượt.</p>
  </>;
}

function Stat({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return <div><dt>{label}</dt><dd>{value ?? "—"}</dd>{note && <small>{note}</small>}</div>;
}

async function Overview() {
  const result = await readAdmin<AdminOverview>("overview");
  if (result.status === "anonymous") redirect("/login");
  if (result.status === "forbidden") redirect("/account");
  if (result.status !== "ok") return <section className={styles.panel}><Unavailable title="Chưa tải được số liệu tổng quan" /></section>;
  const data = result.data, a = data.activity;
  const peak = Math.max(1, ...data.daily.map(day => day.learners));
  const studied = data.daily.filter(day => day.learners > 0).length;

  return <>
    <section className={styles.panel} aria-labelledby="activity-heading">
      <h2 id="activity-heading" className={styles.panelTitle}>Hoạt động học viên</h2>
      <p className={styles.hint}>Tính trên {data.countedLearners} học viên; không tính {data.excludedAccounts} tài khoản quản trị viên hoặc thử nghiệm
        (email .test, @example., hoặc tên có chữ “test”).</p>
      <dl className={styles.userStats}>
        <Stat label="Học hôm nay" value={a.learnersToday} />
        <Stat label="Học trong 7 ngày" value={a.learners7Days} />
        <Stat label="Học trong 30 ngày" value={a.learners30Days} />
        <Stat label="Tài khoản mới trong 7 ngày" value={a.newAccounts7Days} note={`${a.newAccounts30Days} trong 30 ngày`} />
        <Stat label="Bài viết nộp trong 7 ngày" value={a.essays7Days} note={`${a.revisions7Days} bản sửa lại · ${a.essays30Days} trong 30 ngày`} />
        <Stat label="Lượt gọi AI tạo khóa học (7 ngày)" value={a.aiCalls7Days} note={a.aiErrors7Days ? `${a.aiErrors7Days} lỗi` : a.aiCalls7Days === null ? "Chưa đọc được dữ liệu AI" : undefined} />
      </dl>

      <h3 className={styles.subTitle} id="daily-heading">Số người học mỗi ngày (14 ngày)</h3>
      {studied === 0 ? <p className={styles.hint}>Chưa có học viên nào học trong 14 ngày qua.</p>
        : <figure className={styles.dailyChart} aria-labelledby="daily-heading">
          <ol aria-hidden="true">{data.daily.map(day => <li key={day.date} title={`${shortDay(day.date)}: ${day.learners} người học`}>
            <span className={styles.dailyValue}>{day.learners > 0 ? day.learners : ""}</span>
            <span className={styles.dailyBar} style={{ height: `${Math.max(day.learners / peak * 100, day.learners > 0 ? 8 : 0)}%` }} />
            <span className={day.date === data.today ? styles.dailyToday : undefined}>{day.date === data.today ? "Nay" : shortDay(day.date)}</span>
          </li>)}</ol>
          <table className={styles.srOnly}><caption>Số người học mỗi ngày</caption><thead><tr><th>Ngày</th><th>Người học</th></tr></thead>
            <tbody>{data.daily.map(day => <tr key={day.date}><td>{shortDay(day.date)}</td><td>{day.learners}</td></tr>)}</tbody></table>
        </figure>}

      <h3 className={styles.subTitle}>Kỹ năng được học trong 30 ngày</h3>
      {data.skills.length === 0 ? <p className={styles.hint}>Chưa có dữ liệu.</p>
        : <ul className={styles.skillList}>{data.skills.map(skill => <li key={skill.kind}>
          <span>{skillLabels[skill.kind] ?? skill.kind}</span><strong>{skill.learners} người</strong></li>)}</ul>}
    </section>

    <div className={styles.overviewColumns}>
      <section className={styles.panel} aria-labelledby="attention-heading">
        <h2 id="attention-heading" className={styles.panelTitle}>Việc cần chú ý</h2>
        {data.attention.length === 0 ? <p className={styles.hint}>Không có việc cần xử lý.</p>
          : <ul className={styles.attentionList}>{data.attention.map(item => <li key={item.kind}>
            <Link href={item.href} className={styles.rowAction}>{attentionText(item.kind, item.count)} <Icon name="arrow" /></Link></li>)}</ul>}
      </section>
      <section className={`${styles.panel} ${styles.auditPanel}`} aria-labelledby="recent-heading">
        <h2 id="recent-heading" className={styles.panelTitle}>Thao tác quản trị gần đây</h2>
        {data.recent.length === 0 ? <p className={styles.hint}>Chưa có thao tác nào.</p>
          : <ol className={styles.auditList}>{data.recent.map((entry, index) => <li key={index}>
            <strong>{auditLabel(entry)}{entry.targetId ? <> · <Link href={`/admin/users/${entry.targetId}`}>#{entry.targetId}</Link></> : null}</strong>
            <small>{formatDateTime(entry.at)} · bởi {entry.actorName ?? `#${entry.actorId}`}</small></li>)}</ol>}
      </section>
    </div>
  </>;
}

export default function AdminOverviewPage({ searchParams }: { searchParams: Params }) {
  return <>
    <div className={styles.breadcrumb}>Quản trị hệ thống <span>›</span> Tổng quan</div>
    <div className={styles.pageHeader}><div><span className={styles.eyebrow}>TỔNG QUAN</span><h1>Tổng quan hệ thống</h1>
      <p>Dịch vụ có chạy đủ không, có ai đang học không và việc gì cần xử lý.</p></div></div>
    <section className={styles.panel} aria-labelledby="services-heading">
      <Suspense fallback={<p className={styles.hint} role="status">Đang kiểm tra dịch vụ…</p>}><Services searchParams={searchParams} /></Suspense>
    </section>
    <Suspense fallback={<section className={styles.panel}><p className={styles.hint} role="status">Đang tải số liệu…</p></section>}><Overview /></Suspense>
  </>;
}
