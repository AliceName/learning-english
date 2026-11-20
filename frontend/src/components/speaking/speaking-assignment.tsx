import Icon from "@/components/site-icon";
import styles from "./speaking.module.css";

const introduction = "Luyện nói theo các câu mẫu rồi thay bằng thông tin của bạn.";

export default function SpeakingAssignment({ goals }: { goals: string }) {
  const lines = goals.split(/\r?\n/).map(line => line.trim()).filter(line => line && line !== introduction);
  if (!lines.length) return null;

  const hintIndex = lines.findIndex(line => line.startsWith("Gợi ý sử dụng") && line.endsWith(":"));
  const instructions = hintIndex < 0 ? lines : lines.slice(0, hintIndex);
  const hints = hintIndex < 0 ? [] : lines.slice(hintIndex + 1);

  return <section className={styles.assignment} aria-label="Đề bài luyện nói">
    {instructions.length > 0 && <div className={styles.assignmentText}>
      <strong>Đề bài</strong>
      <div>{instructions.map((line, index) => <p key={index}>{line.replace(/^(Yêu cầu|Đề bài):\s*/, "")}</p>)}</div>
    </div>}
    {hintIndex >= 0 && <div className={styles.assignmentHints}>
      <Icon name="sparkles" />
      <div>
        <p>{lines[hintIndex]}</p>
        {hints.length > 0 && <ul>{hints.map((hint, index) =>
          <li key={index} aria-label={hint} title={hint}><span lang="en">{hint.replace(/\s+\([^)]*\)$/, "")}</span></li>
        )}</ul>}
      </div>
    </div>}
  </section>;
}
