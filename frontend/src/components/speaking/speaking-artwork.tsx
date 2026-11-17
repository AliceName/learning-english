import styles from "./speaking.module.css";

export default function SpeakingScenery() {
  return <div className={styles.scenery} aria-hidden="true">
    <span className={styles.cloud} />
    <span className={styles.cloudSmall} />
    <svg className={styles.bottomClouds} viewBox="0 0 1440 170" preserveAspectRatio="none">
      <path d="M0 42q64 8 98 73 52-28 104 30 63-39 125 25H0ZM1440 55q-79-40-140 45-75-23-116 70h256Z" fill="#c9dfff" />
      <path d="M0 147q103-49 207 23H0Zm1440-21q-98-34-185 44h185Z" fill="#dbeaff" />
    </svg>
  </div>;
}
