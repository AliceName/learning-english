"use client";

import Link from "next/link";
import { useId, useRef } from "react";
import Icon from "@/components/site-icon";
import type { FeaturedCourse } from "./courses";
import styles from "./home.module.css";

export default function CourseDetails({ course }: { course: FeaturedCourse }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  return (
    <>
      <button type="button" className={styles.courseButton} onClick={() => dialog.current?.showModal()} aria-haspopup="dialog" aria-label={`Xem chi tiết ${course.title}`}>Xem chi tiết <Icon name="arrow" /></button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby={headingId} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
        <div className={styles.dialogBody}>
          <button type="button" className={styles.dialogClose} onClick={() => dialog.current?.close()} aria-label="Đóng chi tiết khóa học"><Icon name="close" /></button>
          <span className={styles.eyebrow}>{course.category}</span>
          <h2 id={headingId}>{course.title}</h2>
          <p>{course.description}</p>
          <div className={styles.courseMeta}><span>Lộ trình: {course.days} ngày</span><strong>{course.level}</strong></div>
          <ul className={styles.checklist}>{course.highlights.map(item => <li key={item}><Icon name="check" /><span>{item}</span></li>)}</ul>
          <p className={styles.demoNote}>Lộ trình minh họa. Nội dung học chi tiết đang được phát triển.</p>
          <Link href="/register" className={styles.primaryButton}>Tạo tài khoản miễn phí <Icon name="arrow" /></Link>
        </div>
      </dialog>
    </>
  );
}
