import Link from "next/link";
import { catalogHref, type CourseQuery } from "@/lib/course-catalog";
import styles from "./speaking-levels.module.css";

const stages = [
  { level: "A1", name: "Bắt đầu", detail: "Chào hỏi, gia đình, câu ngắn" },
  { level: "A2", name: "Cơ bản", detail: "Mua sắm, hỏi đường, cuối tuần" },
  { level: "B1", name: "Trung cấp", detail: "Kể chuyện, sở thích, kế hoạch" },
  { level: "B2", name: "Trung cao cấp", detail: "Thảo luận, so sánh, đề xuất" },
  { level: "C1", name: "Nâng cao", detail: "Ý tưởng phức tạp, từ học thuật" },
  { level: "C2", name: "Chuyên sâu", detail: "Sắc thái, phản biện, tổng hợp" },
];

export default function SpeakingLevels({ query }: { query: CourseQuery }) {
  return <section className={styles.section} aria-labelledby="speaking-levels-heading">
    <h2 id="speaking-levels-heading">Chọn cấp độ luyện nói</h2>
    <p>Mới bắt đầu? Hãy thử A1. Đã quen giao tiếp? Chọn B1 hoặc B2 và luyện từng câu theo nhịp của bạn.</p>
    <nav className={styles.grid} aria-label="Cấp độ bài luyện nói">{stages.map(stage => <Link key={stage.level} href={catalogHref(query, { level: stage.level, skill: "speaking", search: "", status: "all", source: "" })} aria-current={query.level === stage.level ? "page" : undefined}>
      <strong>{stage.level}</strong><span>{stage.name}</span><small>{stage.detail}</small>
    </Link>)}</nav>
    <p className={styles.note}>Cấp độ tham khảo cho độ khó nội dung. Điểm phát âm chưa đánh giá trình độ CEFR, độ trôi chảy hay ngữ điệu.</p>
  </section>;
}
