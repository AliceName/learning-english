"use client";

import { Mascot } from "page-mascot";
import styles from "./brand.module.css";

export default function BrandMascot() {
  return <div className={styles.mascot}>
    <Mascot directions="/mascots/cat-directions.webp" reactions="/mascots/cat-reactions.webp"
      size={68} label="Mèo LEWA" className={styles.cat} />
  </div>;
}
