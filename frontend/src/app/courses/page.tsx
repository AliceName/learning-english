import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Icon from "@/components/site-icon";
import MemberShell from "@/components/navigation/member-shell";
import CourseCard from "@/components/courses/course-card";
import CourseFilters from "@/components/courses/course-filters";
import CatalogState from "@/components/courses/catalog-state";
import { getCurrentUser } from "@/lib/server-auth";
import { getCourses } from "@/lib/server-courses";
import { catalogHref, parseCourseQuery } from "@/lib/course-catalog";
import styles from "@/components/courses/courses.module.css";

export const metadata: Metadata = { title: "Khám phá khóa học | LinguaAI", description: "Khám phá khóa học tiếng Anh theo trình độ CEFR và kỹ năng của bạn." };

async function Catalog({ searchParams }: PageProps<"/courses">) {
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect("/login");
  const query = parseCourseQuery(await searchParams);
  const result = session.status === "authenticated" ? await getCourses(query) : null;
  if (result?.status === "anonymous") redirect("/login");
  const data = result?.status === "ok" ? result.data : null;
  const filtered = !!(query.search || query.level || query.skill || query.source || query.status !== "all" || query.page > 1);
  const pages = data ? Array.from(new Set([1, data.page - 1, data.page, data.page + 1, data.totalPages])).filter(page => page >= 1 && page <= data.totalPages).sort((a, b) => a - b) : [];
  return <MemberShell user={session.status === "authenticated" ? session.user : undefined}>
    <main id="main-content" tabIndex={-1} className={styles.catalog}>
      <div className={styles.breadcrumb}>KHÔNG GIAN HỌC TẬP <Icon name="chevron" /><span>KHÓA HỌC</span></div>
      <div className={styles.pageHeading}><div><span className={styles.eyebrow}>LEARN SOMETHING NEW EVERY DAY</span><h1>Khám phá & Danh mục <span>Khóa học</span></h1><p>Học theo cách của bạn. Khám phá lộ trình tiếng Anh từ A1 đến C2.</p></div><div className={styles.aiPromo}><Icon name="sparkles" /><div><strong>Tạo khóa học AI <small>SẮP CÓ</small></strong><span>Từ tài liệu, theo mục tiêu của bạn</span></div></div></div>
      {data && <div className={styles.summary}><span><Icon name="book" /><strong>{data.summary.totalCourses}</strong> khóa học</span><span><i className={styles.blueDot} /><strong>{data.summary.inProgress}</strong> đang học</span><span><i className={styles.greenDot} /><strong>{data.summary.completed}</strong> đã hoàn thành</span></div>}
      <CourseFilters key={catalogHref(query, { page: query.page })} query={query} />
      <div className={styles.resultsHeading}><div><h2>{query.status === "in_progress" ? "Khóa học đang học" : query.status === "completed" ? "Khóa học đã hoàn thành" : "Tất cả khóa học"}</h2>{data && <span>{data.totalCount} kết quả{query.search ? ` cho “${query.search}”` : " dành cho bạn"}</span>}</div>{filtered && <Link href="/courses" className={styles.clearFilters}>Xóa bộ lọc <Icon name="close" /></Link>}</div>
      {!data ? <CatalogState error retry={catalogHref(query, { page: query.page })} /> : data.items.length === 0 ? <CatalogState filtered={filtered} /> : <>
        <div className={styles.grid}>{data.items.map((course, index) => <CourseCard key={course.courseId} course={course} eager={index < 3} />)}</div>
        <div className={styles.paginationRow}><span>Hiển thị {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.totalCount)} trong {data.totalCount} khóa học</span><nav aria-label="Phân trang khóa học" className={styles.pagination}>
          {data.page > 1 && <Link href={catalogHref(query, { page: data.page - 1 })} aria-label="Trang trước">←</Link>}
          {pages.map((page, index) => <span key={page}>{index > 0 && page - pages[index - 1] > 1 && <span className={styles.ellipsis}>…</span>}<Link href={catalogHref(query, { page })} aria-current={data.page === page ? "page" : undefined} aria-label={`Trang ${page}`}>{page}</Link></span>)}
          {data.page < data.totalPages && <Link href={catalogHref(query, { page: data.page + 1 })} aria-label="Trang sau">→</Link>}
        </nav></div>
      </>}
      <div className={styles.catalogNote}><Icon name="shield" /><p>Chọn cấp độ phù hợp, học theo nhịp độ của bạn.<br /><span>Thông tin khóa học và tiến độ luôn được cập nhật từ tài khoản của bạn.</span></p><Icon name="sparkles" /></div>
    </main>
  </MemberShell>;
}

export default function CoursesPage(props: PageProps<"/courses">) {
  return <Suspense fallback={<div className={styles.loading} role="status">Đang tải danh mục khóa học…</div>}><Catalog {...props} /></Suspense>;
}
