import Link from "next/link";
import Icon from "@/components/site-icon";
import { catalogHref, levels, skills, type CourseQuery } from "@/lib/course-catalog";
import styles from "./courses.module.css";

const levelNames = ["Sơ cấp", "Cơ bản", "Trung cấp", "Trung cao cấp", "Thành thạo", "Thông thạo"];
export default function CourseFilters({ query }: { query: CourseQuery }) {
  return <section className={styles.filters} aria-label="Bộ lọc khóa học">
    <form action="/courses" role="search" aria-label="Tìm kiếm và lọc khóa học" className={styles.filterForm}>
      <div className={styles.searchInput}><Icon name="search" /><input type="search" name="search" defaultValue={query.search} maxLength={200} placeholder="Tìm kiếm theo tên khóa học, mô tả hoặc chủ đề…" aria-label="Tìm kiếm khóa học" /><button type="submit">Tìm kiếm <Icon name="arrow" /></button></div>
      <input type="hidden" name="level" value={query.level} /><input type="hidden" name="skill" value={query.skill} />
      <div className={styles.filterRow}><span className={styles.filterLabel}>CẤP ĐỘ CEFR</span><div className={styles.chips}><Link href={catalogHref(query, { level: "" })} aria-current={!query.level ? "true" : undefined}>Tất cả</Link>{levels.map((level, index) => <Link key={level} href={catalogHref(query, { level })} aria-current={query.level === level ? "true" : undefined}><strong>{level}</strong> {levelNames[index]}</Link>)}</div></div>
      <div className={styles.filterRow}><span className={styles.filterLabel}>KỸ NĂNG</span><div className={styles.chips}><Link href={catalogHref(query, { skill: "" })} aria-current={!query.skill ? "true" : undefined}>Tất cả kỹ năng</Link>{Object.entries(skills).map(([skill, label]) => <Link key={skill} href={catalogHref(query, { skill })} aria-current={query.skill === skill ? "true" : undefined}>{label}</Link>)}</div></div>
      <div className={styles.selectRow}>
        <label><Icon name="filter" /><select name="status" defaultValue={query.status} aria-label="Trạng thái học"><option value="all">Trạng thái: Tất cả</option><option value="in_progress">Đang học</option><option value="completed">Đã hoàn thành</option><option value="not_started">Chưa tham gia</option></select></label>
        <label><Icon name="book" /><select name="source" defaultValue={query.source} aria-label="Nguồn khóa học"><option value="">Mọi nguồn khóa học</option><option value="system">Khóa học hệ thống</option><option value="user_upload">Khóa học của bạn</option></select></label>
        <label className={styles.sortSelect}><select name="sort" defaultValue={query.sort} aria-label="Sắp xếp"><option value="updated">Mới cập nhật</option><option value="newest">Mới tạo</option><option value="popular">Nhiều học viên nhất</option><option value="title">Tên khóa học A–Z</option></select></label>
        <button type="submit" className={styles.applyButton}>Áp dụng</button>
      </div>
    </form>
  </section>;
}
