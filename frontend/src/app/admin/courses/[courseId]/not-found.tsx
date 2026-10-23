import Link from "next/link";
import styles from "@/components/admin/admin.module.css";
export default function NotFound(){return <div className={styles.empty}><h1>Không tìm thấy khóa học hệ thống</h1><Link href="/admin/courses">← Quay về danh sách</Link></div>;}
