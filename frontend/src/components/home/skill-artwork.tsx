import Icon from "@/components/site-icon";
import type { SkillId } from "./skill-previews";
import styles from "./skill-artwork.module.css";

// Crop the supplied sheet in CSS so the original illustrations stay unchanged.
export default function SkillArtwork({ skill }: { skill: SkillId }) {
  if (skill === "speaking") return <span className={styles.speaking} aria-hidden="true">
    <span className={styles.speakingCat} />
    <span className={styles.microphone}><Icon name="mic" /></span>
  </span>;

  return <span aria-hidden="true" className={`${styles.artwork} ${styles[skill]}`} />;
}

export function PeekingCat() {
  return <span className={styles.peekingCat} aria-hidden="true" />;
}
