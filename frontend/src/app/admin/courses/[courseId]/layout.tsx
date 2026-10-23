import {Suspense,type ReactNode} from "react";
import {notFound,redirect} from "next/navigation";
import {readAdmin} from "@/lib/server-admin";
import type {AdminCourse} from "@/lib/admin-courses";
import CourseWorkspace from "@/components/admin/course-workspace";
import styles from "@/components/admin/admin.module.css";
export const instant=false;
async function LoadCourse({children,params}:{children:ReactNode;params:Promise<{courseId:string}>}) {
  const{courseId}=await params;
  if(!/^[1-9]\d*$/.test(courseId)||Number(courseId)>2147483647)notFound();
  const result=await readAdmin<AdminCourse>(`courses/${courseId}`);
  if(result.status==="anonymous")redirect("/login");
  if(result.status==="forbidden")redirect("/account");
  if(result.status==="not_found")notFound();
  if(result.status!=="ok")return <div className={styles.empty}><h1>Chưa thể tải khóa học</h1><a href={`/admin/courses/${courseId}/general`}>Thử lại</a></div>;
  return <CourseWorkspace initialCourse={result.data}>{children}</CourseWorkspace>;
}
export default function CourseLayout(props:{children:ReactNode;params:Promise<{courseId:string}>}) {return <Suspense fallback={<p role="status">Đang tải khóa học…</p>}><LoadCourse {...props}/></Suspense>;}
