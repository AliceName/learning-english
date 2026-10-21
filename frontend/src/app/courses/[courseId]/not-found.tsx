import Link from "next/link";
import styles from "@/components/courses/courses.module.css";

export default function CourseNotFound() { return <main className={styles.loading}><h1>Không tìm thấy khóa học</h1><p>Khóa học chưa được xuất bản hoặc bạn chưa có quyền truy cập.</p><Link href="/courses" className={styles.primaryButton}>← Về danh mục khóa học</Link></main>; }
