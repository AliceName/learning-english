"use client";
import styles from "./admin.module.css";
export default function AdminRetry(){return <button type="button" className={styles.secondaryButton} onClick={()=>window.location.reload()}>Thử lại</button>;}
