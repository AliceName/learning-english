"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/site-icon";
import styles from "./navbar.module.css";

export default function LogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Chưa thể đăng xuất. Vui lòng thử lại.");
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.logoutWrap}>
      <button type="button" className={styles.logout} onClick={logout} disabled={submitting}><Icon name="logout" /><span>{submitting ? "Đang đăng xuất…" : "Đăng xuất"}</span></button>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
