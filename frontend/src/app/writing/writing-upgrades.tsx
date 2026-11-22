import Icon from "@/components/site-icon";
import type { WritingUpgrade } from "@/lib/writing";
import { InfoTip } from "./info-tip";
import styles from "./writing.module.css";

const kindLabels: Record<WritingUpgrade["kind"], string> = { grammar: "Cấu trúc câu", vocabulary: "Từ vựng", cohesion: "Liên kết ý" };

/** Plan B: ways to write already-correct parts better. Advice only — never applied to the draft, never counted as errors. */
export default function WritingUpgrades({ upgrades }: { upgrades: WritingUpgrade[] }) {
  return <section className={`${styles.feedback} ${styles.writingCards}`} aria-labelledby="writing-upgrades-heading">
    <div className={styles.sectionHeading}><span className={styles.icon}><Icon name="sparkles" /></span>
      <h2 id="writing-upgrades-heading">Gợi ý nâng cấp<InfoTip kind="help" label="Gợi ý nâng cấp là gì?">
        <span>Đây không phải lỗi: những phần này đã đúng, AI gợi ý cách viết hay hơn để hướng tới trình độ cao hơn.</span>
        <span>Gợi ý không tự áp dụng vào bài. Bạn tự quyết định có dùng khi sửa bài hay không.</span></InfoTip></h2></div>
    <div className={styles.writingCardGrid}>
      {upgrades.map(item => <article className={styles.change} key={`${item.sourceStart}:${item.suggestion}`}>
        <div className={styles.toolbar}>
          <h3>{kindLabels[item.kind]}</h3>
          {item.level && <span className={styles.pill}>Hướng tới {item.level}</span>}
        </div>
        <div className={`${styles.suggestionPair} ${styles.upgradePair}`}>
          <div><h4>Bạn đã viết</h4><p lang="en">{item.original}</p></div>
          <div><h4>Cách viết hay hơn</h4><p lang="en">{item.suggestion}</p></div>
        </div>
        <div className={styles.explanation}><Icon name="bulb" /><p>{item.message}</p></div>
      </article>)}
    </div>
  </section>;
}
