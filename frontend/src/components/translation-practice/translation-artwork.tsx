import styles from "./translation-practice.module.css";

export function TranslationScenery() {
  return <div className={styles.scenery} aria-hidden="true">
    <span className={styles.heroClouds} />
    <svg className={styles.bottomClouds} viewBox="0 0 1440 180" preserveAspectRatio="none">
      <path d="M0 80q77 0 112 69 70-35 132 31H0ZM1440 81q-81-24-132 45-72-34-144 54h276Z" fill="#c7dfff" />
      <path d="M0 166q112-71 235 14H0Zm481 14q72-83 140-4 63-51 143 4Zm959-15q-95-57-198 15h198Z" fill="#d8e9ff" />
      <path d="M271 132q-2-19 17-20 4-24 28-18 18-13 31 6 25-2 23 24Z" fill="#fff" fillOpacity=".72" />
      <path d="M407 180q60-67 123-2" fill="none" stroke="#fff" strokeWidth="4" strokeOpacity=".85" />
    </svg>
  </div>;
}

export function ResultIllustration() {
  return <svg className={styles.emptyIllustration} viewBox="0 0 160 130" fill="none" aria-hidden="true">
    <ellipse cx="82" cy="116" rx="44" ry="6" fill="#dceaff" />
    <g transform="rotate(-7 82 69)" strokeLinecap="round" strokeLinejoin="round">
      <rect x="44" y="31" width="75" height="83" rx="9" fill="#daeaff" stroke="#a4c9ff" strokeWidth="2" />
      <rect x="42" y="27" width="75" height="83" rx="8" fill="#fff" stroke="#0759d2" strokeWidth="2.5" />
      <rect x="49" y="34" width="61" height="70" rx="4" fill="#f1f7ff" />
      <path d="M68 27v-5a5 5 0 0 1 5-5h13a5 5 0 0 1 5 5v5Z" fill="#fff" stroke="#0759d2" strokeWidth="2.5" />
      <path d="m57 54 4 4 8-9m-12 28 4 4 8-9" stroke="#188ae9" strokeWidth="4" />
      <path d="M78 54h22M78 77h22M57 96h40" stroke="#aacdfb" strokeWidth="4" />
    </g>
    <path d="m20 64 3 8 8 3-8 3-3 8-3-8-8-3 8-3ZM139 45l3 9 9 3-9 3-3 9-3-9-9-3 9-3Z"
      fill="#fff9d6" stroke="#ffb62e" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>;
}
