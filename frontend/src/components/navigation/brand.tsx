import Link from "next/link";
import Image from "next/image";
import { BRAND_LOGO, BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";
import BrandMascot from "./brand-mascot";
import styles from "./brand.module.css";

export default function Brand({ href = "/", compact = false, className = "" }: {
  href?: string;
  compact?: boolean;
  className?: string;
}) {
  const logo = (
    <div className={`${styles.brand} ${compact ? styles.compact : ""}`}>
      <Link href={href} className={styles.wordmark} aria-label={`${BRAND_NAME} — ${href === "/" ? "Trang chủ" : "Quản trị khóa học"}`}>
        <Image src={BRAND_LOGO} width={680} height={260} alt={BRAND_NAME} className={styles.logo} />
        <span className={styles.caption}>{BRAND_TAGLINE}</span>
      </Link>
      <BrandMascot />
    </div>
  );
  // Keep the mascot button beside the home link so both work with keyboard and touch.
  return className ? <div className={className}>{logo}</div> : logo;
}
