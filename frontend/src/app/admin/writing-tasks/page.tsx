import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/site-icon";
import { readAdmin } from "@/lib/server-admin";
import { formatDate } from "@/lib/admin-users";
import { writingCategoryLabels } from "@/lib/writing-review";
import { levelLabels, MIN_LEARNERS, percent, type AdminWritingTaskReport, type AdminWritingTaskStats } from "@/lib/admin-content-stats";
import AdminRetry from "@/components/admin/admin-retry";
import styles from "@/components/admin/admin.module.css";

export const metadata = { title: "Thống kê đề viết" };
export const instant = false;
type Params = Promise<Record<string, string | string[] | undefined>>;

const sorts = {
  learners: { label: "Nhiều người viết", compare: (a: AdminWritingTaskStats, b: AdminWritingTaskStats) => b.learners - a.learners || b.rounds - a.rounds },
  offtopic: { label: "Tỉ lệ lạc đề cao", compare: (a: AdminWritingTaskStats, b: AdminWritingTaskStats) => rate(b.offTopic, b.relevanceChecked) - rate(a.offTopic, a.relevanceChecked) },
  errors: { label: "Nhiều lỗi / 100 từ", compare: (a: AdminWritingTaskStats, b: AdminWritingTaskStats) => (b.errorsPer100Words ?? -1) - (a.errorsPer100Words ?? -1) },
  recent: { label: "Viết gần đây", compare: (a: AdminWritingTaskStats, b: AdminWritingTaskStats) => (b.lastWrittenAt ?? "").localeCompare(a.lastWrittenAt ?? "") },
  unused: { label: "Chưa ai viết trước", compare: (a: AdminWritingTaskStats, b: AdminWritingTaskStats) => a.learners - b.learners },
} as const;
type Sort = keyof typeof sorts;
const rate = (part: number, whole: number) => whole > 0 ? part / whole : -1;
const categoryName = (category: string) => writingCategoryLabels[category] ?? (category === "OTHER" ? "Khác" : category);

function Rate({ task, children }: { task: AdminWritingTaskStats; children: string }) {
  const thin = task.learners < MIN_LEARNERS && task.learners > 0;
  return <span className={thin ? styles.thinData : undefined} title={thin ? `Mới có ${task.learners} người viết, chưa đủ để kết luận` : undefined}>{children}</span>;
}

async function TaskStats({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const sort: Sort = typeof params.sort === "string" && params.sort in sorts ? params.sort as Sort : "learners";
  const result = await readAdmin<AdminWritingTaskReport>("stats/writing-tasks");
  if (result.status === "anonymous") redirect("/login");
  if (result.status === "forbidden") redirect("/account");
  if (result.status !== "ok") return <section className={styles.panel}><div className={styles.empty} role="alert"><h2>Chưa tải được thống kê</h2><AdminRetry /></div></section>;
  const data = result.data;
  const genres = [...new Set(data.tasks.map(task => task.genre).filter(Boolean))].sort();
  const genre = typeof params.genre === "string" && genres.includes(params.genre) ? params.genre : "";
  const tasks = data.tasks.filter(task => !genre || task.genre === genre).toSorted(sorts[sort].compare);
  const written = data.tasks.filter(task => task.learners > 0).length;

  return <>
    <section className={styles.panel} aria-labelledby="summary-heading">
      <h2 id="summary-heading" className={styles.panelTitle}>Tóm tắt</h2>
      <p className={styles.hint}>Tính trên {data.countedLearners} học viên, không tính {data.excludedAccounts} tài khoản quản trị viên hoặc thử nghiệm.
        Chỉ dùng bản viết đầu tiên của mỗi lượt; không hiển thị nội dung bài viết.{!data.catalogueLoaded && " Không đọc được thư viện đề nên chỉ hiện các đề đã có người viết."}</p>
      <dl className={styles.userStats}>
        <div><dt>Đề có người viết</dt><dd>{written}<small> / {data.tasks.length}</small></dd></div>
        <div><dt>Lượt luyện (bản đầu)</dt><dd>{data.tasks.reduce((sum, task) => sum + task.rounds, 0)}</dd></div>
        <div><dt>Lượt có viết lại</dt><dd>{data.tasks.reduce((sum, task) => sum + task.revisedRounds, 0)}</dd></div>
      </dl>
      {data.categories.length > 0 && <>
        <h3 className={styles.subTitle}>Nhóm lỗi hay gặp nhất (mọi đề)</h3>
        <ul className={styles.skillList}>{data.categories.map(item => <li key={item.category}><span>{categoryName(item.category)}</span><strong>{item.count}</strong></li>)}</ul>
      </>}
    </section>

    <section className={styles.panel} aria-labelledby="tasks-heading">
      <div className={styles.listHeading}><h2 id="tasks-heading">Các đề viết <small>({tasks.length})</small></h2></div>
      <form action="/admin/writing-tasks" className={styles.userFilters}>
        <label className={styles.field}>Loại đề<select name="genre" defaultValue={genre}><option value="">Tất cả</option>
          {genres.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className={styles.field}>Sắp xếp<select name="sort" defaultValue={sort}>
          {Object.entries(sorts).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
        <div className={styles.filterActions}><button className={styles.secondaryButton}>Lọc</button>
          {(genre || sort !== "learners") && <Link href="/admin/writing-tasks" className={styles.rowAction}>Xóa bộ lọc</Link>}</div>
      </form>
      {tasks.length === 0 ? <div className={styles.empty}><Icon name="writing" /><h2>Chưa có đề nào</h2></div>
        : <div className={styles.tableWrap}><table className={`${styles.table} ${styles.statsTable}`}>
          <caption className={styles.srOnly}>Thống kê theo đề viết</caption>
          <thead><tr><th>ĐỀ</th><th>NGƯỜI VIẾT</th><th>LƯỢT</th><th>VIẾT LẠI</th><th>LỖI / 100 TỪ</th><th>LẠC ĐỀ</th><th>LẦN CUỐI</th></tr></thead>
          <tbody>{tasks.map(task => <tr key={task.taskId} className={task.learners === 0 ? styles.unusedRow : undefined}>
            <td><strong className={styles.courseTitle}>{task.title}</strong>
              <small>{[task.genre, levelLabels[task.level] ?? task.level, task.topic].filter(Boolean).join(" · ")}{!task.inCatalogue && " · không còn trong thư viện"}</small>
              {task.topCategories.length > 0 && <small>Lỗi hay gặp: {task.topCategories.map(item => `${categoryName(item.category)} (${item.count})`).join(", ")}</small>}</td>
            <td>{task.learners}</td><td>{task.rounds}</td>
            <td><Rate task={task}>{task.rounds ? percent(task.revisedRounds, task.rounds) : "—"}</Rate></td>
            <td><Rate task={task}>{task.errorsPer100Words === null ? "—" : task.errorsPer100Words.toLocaleString("vi-VN")}</Rate></td>
            <td><Rate task={task}>{task.relevanceChecked ? `${percent(task.offTopic, task.relevanceChecked)} (${task.offTopic}/${task.relevanceChecked})` : "—"}</Rate></td>
            <td>{task.lastWrittenAt ? formatDate(task.lastWrittenAt) : "Chưa ai viết"}</td>
          </tr>)}</tbody></table></div>}
      <p className={styles.hint}>Số in mờ: đề có dưới {MIN_LEARNERS} người viết, chưa đủ để kết luận. “Lạc đề” chỉ tính các bài đã được kiểm tra mức bám đề.
        Bài cũ và bài mới có thể được chấm bởi các phiên bản bộ sửa lỗi khác nhau nên số lỗi chỉ để tham khảo.</p>
    </section>
  </>;
}

export default function WritingTaskStatsPage({ searchParams }: { searchParams: Params }) {
  return <>
    <div className={styles.breadcrumb}>Quản trị hệ thống <span>›</span> Thống kê đề viết</div>
    <div className={styles.pageHeader}><div><span className={styles.eyebrow}>NỘI DUNG</span><h1>Thống kê đề viết</h1>
      <p>Đề nào được viết nhiều, đề nào bị bỏ qua, đề nào dễ lạc đề hoặc nhiều lỗi.</p></div></div>
    <Suspense fallback={<section className={styles.panel}><p className={styles.hint} role="status">Đang tải thống kê…</p></section>}>
      <TaskStats searchParams={searchParams} /></Suspense>
  </>;
}
