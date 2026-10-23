import Link from "next/link";
import {Suspense} from "react";
import {redirect} from "next/navigation";
import Icon from "@/components/site-icon";
import {readAdmin} from "@/lib/server-admin";
import type {AdminCourseList} from "@/lib/admin-courses";
import AdminRetry from "@/components/admin/admin-retry";
import styles from "@/components/admin/admin.module.css";
export const metadata={title:"Quản lý khóa học"};
async function CourseList({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams;const search=typeof params.search==="string"?params.search.slice(0,200):"";
  const rawPage=Number(params.page);const page=Number.isInteger(rawPage)&&rawPage>=1&&rawPage<=10000?rawPage:1;
  const query=new URLSearchParams({search,page:String(page)});const result=await readAdmin<AdminCourseList>(`courses?${query}`);
  if(result.status==="anonymous")redirect("/login");if(result.status==="forbidden")redirect("/account");
  const data=result.status==="ok"?result.data:null;
  return <><div className={styles.breadcrumb}>Quản trị hệ thống <span>›</span> Quản lý khóa học</div><div className={styles.pageHeader}><div><span className={styles.eyebrow}>CONTENT STUDIO</span><h1>Quản lý khóa học</h1><p>Biên soạn, xem trước và xuất bản khóa học hệ thống.</p></div><Link href="/admin/courses/new" className={styles.primaryButton}><Icon name="plus"/>Tạo khóa học mới</Link></div>
    <section className={styles.panel}><div className={styles.listHeading}><h2>Tất cả khóa học {data&&<small>({data.totalCount})</small>}</h2><form action="/admin/courses" className={styles.listSearch}><input name="search" defaultValue={search} maxLength={200} placeholder="Tìm theo tên khóa học…" aria-label="Tìm theo tên khóa học"/><button className={styles.secondaryButton}>Tìm kiếm</button></form></div>
      {!data?<div className={styles.empty} role="alert"><h2>Chưa thể tải danh sách</h2><AdminRetry/></div>:data.items.length===0?<div className={styles.empty}><Icon name="book"/><h2>{search||page>1?"Chưa tìm thấy khóa học":"Bắt đầu với khóa học đầu tiên"}</h2><p>{search?"Điều chỉnh từ khóa hoặc xóa bộ lọc.":"Tạo bản nháp, thêm nội dung Speaking/Listening và xem trước trước khi xuất bản."}</p><Link href={search||page>1?"/admin/courses":"/admin/courses/new"} className={styles.primaryButton}>{search||page>1?"Xóa bộ lọc":"Tạo khóa học"}<Icon name="arrow"/></Link></div>:<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>KHÓA HỌC</th><th>TRẠNG THÁI</th><th>BÀI HỌC</th><th>CẬP NHẬT</th><th>THAO TÁC</th></tr></thead><tbody>{data.items.map(course=><tr key={course.courseId}><td><Link href={`/admin/courses/${course.courseId}/general`} className={styles.courseTitle}>{course.title}</Link><small>CRS-{course.courseId}</small></td><td><span className={course.isPublished?styles.published:styles.draft}>{course.isPublished?"Đã xuất bản":"Bản nháp"}</span></td><td>{course.lessonCount} bài</td><td>{new Date(course.updatedAt).toLocaleDateString("vi-VN")}</td><td><Link href={`/admin/courses/${course.courseId}/general`} className={styles.rowAction}>{course.isPublished?"Xem":"Biên soạn"}<Icon name="arrow"/></Link></td></tr>)}</tbody></table></div>}
      {data&&data.totalPages>1&&<nav aria-label="Phân trang quản trị" className={styles.pagination}>{page>1&&<Link href={`/admin/courses?${new URLSearchParams({search,page:String(page-1)})}`}>← Trang trước</Link>}<span>Trang {page}/{data.totalPages}</span>{page<data.totalPages&&<Link href={`/admin/courses?${new URLSearchParams({search,page:String(page+1)})}`}>Trang sau →</Link>}</nav>}
    </section></>;
}
export default function AdminCoursesPage(props:{searchParams:Promise<Record<string,string|string[]|undefined>>}){return <Suspense fallback={<p role="status">Đang tải danh sách…</p>}><CourseList {...props}/></Suspense>;}

export const instant=false;
