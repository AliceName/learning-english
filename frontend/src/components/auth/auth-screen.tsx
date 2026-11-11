"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Brand from "@/components/navigation/brand";
import LoginForm from "@/app/login/login-form";
import RegistrationForm from "@/app/register/registration-form";
import { safeWritingReturnTo, writingAuthHref } from "@/lib/writing-return";
import AuthMascot, { type AuthReaction, type MascotReaction } from "./auth-mascot";
import styles from "./auth-screen.module.css";

type Mode = "login" | "register";

export default function AuthScreen({ initialMode, initialEmail = "", returnTo = "/account" }: { initialMode: Mode; initialEmail?: string; returnTo?: string }) {
  const destination = safeWritingReturnTo(returnTo);
  const pathname = usePathname();
  const mode = pathname === "/register" ? "register" : pathname === "/login" ? "login" : initialMode;
  const [reaction, setReaction] = useState<MascotReaction | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    document.title = mode === "login" ? "Đăng nhập | LEWA" : "Đăng ký tài khoản | LEWA";
  }, [mode]);

  function react(expression: AuthReaction) {
    if (timer.current) clearTimeout(timer.current);
    setReaction({ expression, sequence: ++sequence.current });
    timer.current = setTimeout(() => setReaction(null), 1800);
  }

  function switchMode(next: Mode) {
    if (busy) return;
    react(next === "register" ? "sparkle" : "heart");
    if (next !== mode) window.history.pushState(null, "", writingAuthHref(next, destination));
  }

  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "login" : event.key === "End" ? "register" : mode === "login" ? "register" : "login";
    switchMode(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Brand />
        <Link href="/" className={styles.backLink}>← <span>Quay lại trang chủ</span></Link>
      </header>
      <main className={styles.main}>
        <div className={styles.card}>
          <aside className={styles.story}>
            <AuthMascot reaction={reaction} />
            <h2>Học tiếng Anh thông minh</h2>
            <p>Người bạn đồng hành AI giúp bạn tự tin giao tiếp mỗi ngày</p>
          </aside>
          <section className={styles.formPanel} aria-label="Tài khoản LEWA">
            <div className={styles.panelTop}>
              <div className={styles.tabs} role="tablist" aria-label="Đăng nhập hoặc tạo tài khoản" onKeyDown={navigateTabs}>
                <button id="tab-login" type="button" role="tab" aria-selected={mode === "login"} aria-controls="login-panel" tabIndex={mode === "login" ? 0 : -1} disabled={busy} onClick={() => switchMode("login")}>Đăng nhập</button>
                <button id="tab-register" type="button" role="tab" aria-selected={mode === "register"} aria-controls="register-panel" tabIndex={mode === "register" ? 0 : -1} disabled={busy} onClick={() => switchMode("register")}>Tạo tài khoản</button>
              </div>
              <span className={styles.language}>Tiếng Việt</span>
            </div>
            <div id="login-panel" role="tabpanel" aria-labelledby="tab-login" hidden={mode !== "login"}>
              {mode === "login" && <LoginForm returnTo={destination} onReaction={react} onBusyChange={setBusy} />}
            </div>
            <div id="register-panel" role="tabpanel" aria-labelledby="tab-register" hidden={mode !== "register"}>
              {mode === "register" && <RegistrationForm initialEmail={initialEmail} onReaction={react} onBusyChange={setBusy} onLogin={() => switchMode("login")} />}
            </div>
            <div className={styles.switcher}>
              <span>{mode === "login" ? "Bạn chưa có tài khoản LEWA?" : "Đã có tài khoản LEWA?"}</span>
              <button type="button" disabled={busy} onClick={() => switchMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Đăng ký ngay miễn phí" : "Đăng nhập ngay"} <span aria-hidden="true">›</span></button>
            </div>
          </section>
        </div>
      </main>
      <footer className={styles.footer}>LEWA · Học tiếng Anh theo cách của bạn.</footer>
    </div>
  );
}
