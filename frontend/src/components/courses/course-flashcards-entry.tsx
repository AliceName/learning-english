import Link from "next/link";
import Icon from "@/components/site-icon";
import { courseFlashcardsHref } from "@/lib/course-flashcards";
import styles from "./course-flashcards.module.css";

export default function CourseFlashcardsEntry({ courseId }: { courseId: number }) {
  return <section className={styles.entry} aria-labelledby="course-vocabulary-title">
    <span className={styles.entryIcon}><Icon name="cards" /></span>
    <div><span className={styles.eyebrow}>VOCABULARY</span><h2 id="course-vocabulary-title">Từ vựng & Flashcards</h2><p>Ôn từ vựng trong bài Reading và khám phá bộ thẻ do Admin biên soạn cho khóa học.</p></div>
    <Link className={styles.primary} href={courseFlashcardsHref(courseId)}>Mở bộ thẻ<Icon name="arrow" /></Link>
  </section>;
}
