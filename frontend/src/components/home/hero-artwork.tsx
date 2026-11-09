import styles from "./landing.module.css";

export function HeroBackdrop() {
  return <svg className={styles.heroBackdrop} viewBox="0 0 1440 660" preserveAspectRatio="none" aria-hidden="true">
    <path fill="#f5f8ff" fillOpacity=".75" d="M0 18Q75-29 151 24T312 36Q337 19 354 0H0Z" />
    <path fill="#c7dbfa" fillOpacity=".66" d="M0 491Q103 419 192 548Q270 511 304 580Q394 547 489 597T772 660H0ZM1440 456Q1304 439 1241 554Q1149 510 1070 597Q976 569 817 660H1440Z" />
    <path fill="#b4d0fa" fillOpacity=".52" d="M0 580Q89 547 193 610T399 660H0ZM1440 605Q1344 561 1277 616T1155 660H1440Z" />
    <path fill="#fff" fillOpacity=".86" d="M120 76q-5 15-19 19 14 4 19 19 4-15 19-19-15-4-19-19Zm1246 39q-4 12-16 16 12 4 16 16 4-12 16-16-12-4-16-16Z" />
  </svg>;
}

export function HeroCrown() {
  return <svg className={styles.heroCrown} viewBox="0 0 100 72" fill="none" aria-hidden="true">
    <g strokeLinejoin="round">
      <path d="m12 20 19 17 19-28 19 28 19-17-10 42H22Z" fill="#fff2bb" stroke="white" strokeWidth="10" />
      <path d="m12 20 19 17 19-28 19 28 19-17-10 42H22Z" stroke="#f8ab27" strokeWidth="4" />
      <path d="M22 53h56" stroke="#ffd269" strokeWidth="4" />
    </g>
    <g fill="#fff4c5" stroke="#ffb628" strokeWidth="3.5">
      <circle cx="12" cy="20" r="7" /><circle cx="50" cy="10" r="7" /><circle cx="88" cy="20" r="7" />
    </g>
  </svg>;
}

export function HeroStickers() {
  return <div className={styles.heroStickers} aria-hidden="true">
    <svg className={styles.heroPlane} viewBox="0 0 220 104" fill="none">
      <path d="M2 94c38 16 93-9 82-43-7-21-39-17-33 3 9 28 65 28 111-16" stroke="#8bb8fd" strokeWidth="2" strokeLinecap="round" strokeDasharray="7 8" />
      <path d="m150 7 65 3-40 39-12-17-10 10 3-21Z" fill="#d9ecff" stroke="#fff" strokeWidth="6" strokeLinejoin="round" />
      <path d="m150 7 65 3-40 39-12-17-10 10 3-21Z" stroke="#70aafa" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="m156 21 59-11-52 22-10 10Z" fill="#91c2ff" stroke="#70aafa" strokeWidth="2" strokeLinejoin="round" />
    </svg>
    <svg className={styles.heroTape} viewBox="0 0 94 40" fill="none">
      <path d="m4 4 86-1-2 8 3 6-3 7 3 9-87 3 2-8-3-8 3-8Z" fill="#8dbbfc" stroke="#f7fbff" strokeWidth="2" strokeLinejoin="round" />
      <path d="m6 22 83-2-2 5 3 7-85 3 2-7Z" fill="#77adfb" fillOpacity=".6" />
    </svg>
    <svg className={styles.heroBooks} viewBox="0 0 156 120" fill="none">
      <g strokeLinecap="round" strokeLinejoin="round">
        <path d="m22 75 91-12 32 13-9 6-2 19 10 3-80 13-44-10C7 104 8 81 22 75Z" fill="#fff4d7" stroke="#fff" strokeWidth="8" />
        <path d="m22 75 91-12 32 13-9 6-2 19 10 3-80 13-44-10C7 104 8 81 22 75Z" stroke="#ffc35d" strokeWidth="4" />
        <path d="m22 78 45 10 69-6M66 89q-11 12-2 27" stroke="#f2aa42" strokeWidth="3" />
        <path d="m31 49 79-13 33 13-9 6-2 19 7 4-75 13-37-8C11 79 15 55 31 49Z" fill="#b4d9ff" stroke="#fff" strokeWidth="8" />
        <path d="m31 49 79-13 33 13-9 6-2 19 7 4-75 13-37-8C11 79 15 55 31 49Z" stroke="#5399f5" strokeWidth="4" />
        <path d="m30 51 41 9 63-5-2 19-68 13-35-7c-12-2-12-24 1-29Z" fill="#e5f2ff" stroke="#5399f5" strokeWidth="2.5" />
        <path d="M71 60q-11 13-7 27" stroke="#5399f5" strokeWidth="3" />
        <path d="M110 47c-1-10 1-17 6-25" stroke="#7dad44" strokeWidth="4" />
        <path d="M113 30C93 30 85 16 88 6c11-1 22 9 25 24Zm0 0c2-13 16-21 27-19 1 13-12 21-27 19Z" fill="#b7dc75" stroke="#80b747" strokeWidth="3" />
      </g>
    </svg>
  </div>;
}
