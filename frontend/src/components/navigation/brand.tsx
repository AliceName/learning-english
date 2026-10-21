import Link from "next/link";
import Icon from "@/components/site-icon";
import styles from "./navbar.module.css";

export default function Brand() {
  return (
    <Link href="/" className={styles.brand} aria-label="LinguaAI — Trang chủ">
      <span className={styles.brandMark}><Icon name="brain" /></span>
      <span><strong>LinguaAI</strong><span className={styles.tagline}>Adaptive Learning</span></span>
    </Link>
  );
}
