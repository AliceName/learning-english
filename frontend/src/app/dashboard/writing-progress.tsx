import Link from "next/link";
import type { ReactNode } from "react";
import type { NextStep } from "@/lib/writing-practice";
import { LoadError, Panel, Skeleton } from "./dashboard-parts";
import type { Load, WritingData } from "./use-dashboard-data";
import styles from "./dashboard.module.css";

/**
 * The latest essay and what to work on next. A CEFR-over-time chart was dropped on purpose:
 * per-essay estimates move with task and length, so a series reads as noise, not progress.
 */
export function WritingProgress({ writing, steps, onRetry }: { writing: Load<WritingData>; steps: NextStep[]; onRetry: () => void }) {
  const action = <Link className={styles.textLink} href="/writing" prefetch={false}>Thư viện đề →</Link>;
  const panel = (body: ReactNode, busy = false) =>
    <Panel id="dashboard-writing" title="Bài viết gần nhất" icon="writing" busy={busy} action={action}>{body}</Panel>;
  if (writing.state === "loading") return panel(<Skeleton lines={4} />, true);
  if (writing.state === "error") return panel(<LoadError message="Chưa tải được lịch sử bài viết." onRetry={onRetry} />);
  const { rounds, latest } = writing.value;
  const round = rounds[0];
  if (!round) return panel(<div className={styles.empty}>
    <p><strong>Chưa có bài viết nào.</strong> Sau khi nộp bài, các việc nên sửa tiếp sẽ hiện ở đây.</p>
    <Link className={styles.primary} href="/writing" prefetch={false}>Viết bài đầu tiên</Link></div>);

  return panel(<div className={styles.latest}>
    <h3>{latest?.task?.title ?? round.topic ?? `Lượt #${round.practiceRootId}`}</h3>
    <p className={styles.muted}>{round.submissionCount} phiên bản · {new Date(round.createdAt).toLocaleDateString("vi-VN")}
      {latest && latest.correctedText !== null ? ` · ${latest.errors.length} câu có gợi ý sửa` : ""}</p>
    {steps.length > 0 ? <>
      <p className={styles.stepsLabel}>Nên làm tiếp</p>
      <ol className={styles.steps}>{steps.map(step => <li key={step.key}>
        <strong>{step.title}</strong>{step.count ? <span className={styles.count}>{step.count} {step.key === "points" ? "ý" : "chỗ"}</span> : null}
      </li>)}</ol></> : <p className={styles.muted}>Bài này không còn việc cần sửa theo gợi ý của AI.</p>}
    <Link className={styles.secondary} href={`/writing?submissionId=${round.latestSubmissionId}`} prefetch={false}>Mở bài và sửa tiếp</Link>
  </div>);
}
