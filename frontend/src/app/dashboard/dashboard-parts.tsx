import type { ReactNode } from "react";
import Icon, { type SiteIconName } from "@/components/site-icon";
import styles from "./dashboard.module.css";

/** A titled panel. `busy` marks the region while its data loads. */
export function Panel({ id, title, icon, action, busy, className, children }: {
  id: string; title: string; icon: SiteIconName; action?: ReactNode; busy?: boolean; className?: string; children: ReactNode;
}) {
  return <section className={`${styles.panel} ${className ?? ""}`} aria-labelledby={id} aria-busy={busy || undefined}>
    <header className={styles.panelHead}>
      <h2 id={id}><span className={styles.panelIcon}><Icon name={icon} /></span>{title}</h2>
      {action}
    </header>
    {children}
  </section>;
}

/** Grey placeholder lines shown instead of text while a section loads. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className={styles.skeleton} aria-hidden="true">{Array.from({ length: lines }, (_, index) => <span key={index} />)}</div>;
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <p className={styles.loadError} role="alert">{message} <button type="button" onClick={onRetry}>Thử lại</button></p>;
}

/** A stat tile: icon chip, value and label (value rendered by the caller so it can carry units). */
export function Stat({ icon, tone, label, children, footer }: {
  icon: SiteIconName; tone?: "blue" | "purple" | "green" | "orange"; label: string; children: ReactNode; footer?: ReactNode;
}) {
  return <article className={styles.stat}>
    <span className={styles.statIcon} data-tone={tone ?? "blue"}><Icon name={icon} /></span>
    <div className={styles.statBody}>
      <h3>{label}</h3>
      <div className={styles.statValue}>{children}</div>
      {footer}
    </div>
  </article>;
}
