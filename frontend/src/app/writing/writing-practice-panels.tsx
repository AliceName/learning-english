import Icon from "@/components/site-icon";
import { cefrLevels, cefrSeries, revisionChecklist, taskPromptParts, versionProgress } from "@/lib/writing-practice";
import type { WritingResult } from "@/lib/writing";
import { InfoTip } from "./info-tip";
import styles from "./writing.module.css";

export function VersionProgressCard({ previous, current }: { previous: WritingResult; current: WritingResult }) {
  const progress = versionProgress(previous, current);
  const from = previous.versionNumber ? `phiên bản ${previous.versionNumber}` : `bài #${previous.submissionId}`;
  return <section className={styles.progressCard} aria-labelledby="writing-progress-heading">
    <div className={styles.sectionHeading}><span className={styles.icon}><Icon name="trend" /></span>
      <h2 id="writing-progress-heading">So với {from}{progress.caveats.length > 0 && <InfoTip label="Lưu ý khi so sánh">
        {progress.caveats.map(caveat => <span key={caveat}>{caveat}</span>)}</InfoTip>}</h2></div>
    <p className={styles.progressHeadline}>{progress.headline}</p>
    <ul className={styles.progressFacts}>
      <li>CEFR: <strong>{progress.cefr === "unknown" ? "không so trực tiếp" : `${progress.from} → ${progress.to}`}</strong></li>
      <li>Số câu AI còn gợi ý: <strong>{progress.suggestions ? `${progress.suggestions.before} → ${progress.suggestions.after}` : "không so được"}</strong></li>
      <li>Độ dài: <strong>{progress.wordsBefore} → {progress.wordsAfter} từ</strong></li>
    </ul>
  </section>;
}

export function RevisionChecklistPanel({ noneReturned, onContinue, disabled }: { noneReturned: boolean; onContinue: () => void; disabled: boolean }) {
  return <section className={styles.exhausted} aria-labelledby="writing-exhausted-heading">
    <h3 id="writing-exhausted-heading">{noneReturned ? "AI không có gợi ý cho bài này" : "Bạn đã xem hết gợi ý của AI"}</h3>
    <p>AI chỉ đưa gợi ý khi đủ chắc chắn và có thể bỏ sót lỗi. Hãy tự rà soát bài theo danh sách dưới đây, sửa trong bản nháp rồi nộp lại.</p>
    <ol>{revisionChecklist.map(line => <li key={line}>{line}</li>)}</ol>
    <button type="button" className={styles.secondaryButton} onClick={onContinue} disabled={disabled}><Icon name="writing" /> Tự rà soát trong bản nháp</button>
  </section>;
}

const chart = { width: 320, height: 150, left: 34, right: 12, top: 12, bottom: 26 };

export function CefrProgressChart({ items }: { items: readonly { submissionId: number; cefrLevel: string; versionNumber?: number | null }[] }) {
  const points = cefrSeries(items).slice(-10);
  if (points.length < 2) return null;
  const plotW = chart.width - chart.left - chart.right, plotH = chart.height - chart.top - chart.bottom;
  const x = (i: number) => chart.left + (points.length === 1 ? plotW / 2 : i * plotW / (points.length - 1));
  const y = (level: number) => chart.top + plotH - level * plotH / (cefrLevels.length - 1);
  const summary = points.map(p => `${p.label}: ${p.level}`).join(", ");
  return <figure className={styles.cefrChart}>
    <figcaption>CEFR ước lượng qua các lần nộp của lượt này (tối đa 10 lần gần nhất)<InfoTip label="Đọc biểu đồ thế nào?">Chỉ hiện bậc CEFR đo được, không phải điểm liên tục. Bậc giữ nguyên không có nghĩa là không tiến bộ.</InfoTip></figcaption>
    <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`Biểu đồ CEFR: ${summary}`}>
      {cefrLevels.map((level, i) => <g key={level}>
        <line x1={chart.left} x2={chart.width - chart.right} y1={y(i)} y2={y(i)} className={styles.chartGrid} />
        <text x={chart.left - 6} y={y(i) + 4} textAnchor="end" className={styles.chartLabel}>{level}</text>
      </g>)}
      <polyline fill="none" className={styles.chartLine} points={points.map((p, i) => `${x(i)},${y(p.index)}`).join(" ")} />
      {points.map((p, i) => <g key={p.submissionId}>
        <circle cx={x(i)} cy={y(p.index)} r={4} className={styles.chartDot} />
        <text x={x(i)} y={chart.height - 8} textAnchor="middle" className={styles.chartLabel}>{p.label}</text>
      </g>)}
    </svg>
  </figure>;
}

/** Library prompt with its inline "*" points shown as a list. */
export function TaskPrompt({ prompt }: { prompt: string }) {
  const { intro, bullets, outro } = taskPromptParts(prompt);
  return <div className={styles.promptText} lang="en">
    {intro && <p>{intro}</p>}
    {bullets.length > 0 && <ul>{bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>}
    {outro && <p>{outro}</p>}
  </div>;
}

/** Questions to ask oneself before submitting; nothing to tick, since nothing is checked automatically. */
export function SelfCheck({ requirements }: { requirements: readonly string[] }) {
  if (!requirements.length) return null;
  return <section className={styles.selfCheck} aria-labelledby="writing-self-check-heading">
    <h3 id="writing-self-check-heading">Trước khi nộp, tự hỏi<InfoTip label="Vì sao phải tự kiểm?">LEWA chưa tự kiểm tra được bài có trả lời đủ các ý này hay không.</InfoTip></h3>
    <ul>{requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul>
  </section>;
}
