"use client";

import { Mascot } from "page-mascot";
import styles from "./landing.module.css";

export default function BearMascot({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? styles.coachAvatar : styles.bearOrb}>
    <Mascot directions="/mascots/bear-directions.webp" reactions="/mascots/bear-reactions.webp"
      size={compact ? 64 : 320} label={compact ? "Gấu Coach" : "Gấu LEWA"} className={styles.bear} />
  </div>;
}
