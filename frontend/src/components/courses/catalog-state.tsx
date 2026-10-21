import Link from "next/link";
import Icon from "@/components/site-icon";
import styles from "./courses.module.css";

export default function CatalogState({ error = false, filtered = false, retry = "/courses" }: { error?: boolean; filtered?: boolean; retry?: string }) {
  return <div className={styles.empty} role={error ? "alert" : "status"}><span className={styles.emptyIcon}><Icon name={error ? "replay" : "book"} /></span><h2>{error ? "Chưa thể tải khóa học" : filtered ? "Chưa tìm thấy khóa học phù hợp" : "Hành trình học tập đang được chuẩn bị"}</h2><p>{error ? "Kết nối đến hệ thống đang gián đoạn. Vui lòng thử lại sau ít phút." : filtered ? "Thử một từ khóa khác hoặc điều chỉnh bộ lọc để khám phá thêm khóa học." : "Chưa có khóa học được xuất bản. Các khóa học mới sẽ xuất hiện tại đây khi sẵn sàng."}</p>{error ? <a href={retry} className={styles.primaryButton}>Thử lại <Icon name="replay" /></a> : filtered ? <Link href="/courses" className={styles.primaryButton}>Xóa bộ lọc <Icon name="arrow" /></Link> : <Link href="/account" className={styles.primaryButton}>Xem tài khoản <Icon name="arrow" /></Link>}</div>;
}
