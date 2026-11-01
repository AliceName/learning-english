"use client";

import Image from "next/image";
import { useState } from "react";
import Icon from "@/components/site-icon";
import styles from "./courses.module.css";

export default function CourseCover({ url, title, personal = false, eager = false, fit = "cover" }: { url: string | null; title: string; personal?: boolean; eager?: boolean; fit?: "cover" | "contain" }) {
  const [failed, setFailed] = useState(false);
  const valid = url && (/^https?:\/\//i.test(url) || url.startsWith("/") && !url.startsWith("//"));
  return <div className={`${styles.cover} ${personal ? styles.personalCover : ""}`}>
    {valid && !failed ? <Image src={url} alt={title} fill unoptimized style={{objectFit:fit}} loading={eager ? "eager" : "lazy"} sizes="(max-width: 700px) 100vw, 33vw" onError={() => setFailed(true)} />
      : <div className={styles.coverArtwork}><span className={styles.artOrbit} /><span className={styles.artOrbitTwo} /><Icon name={personal ? "sparkles" : "book"} /><span>LEWA / {personal ? "PERSONAL LEARNING" : "LEARN & GROW"}</span></div>}
  </div>;
}
