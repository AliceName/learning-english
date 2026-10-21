"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import Icon from "@/components/auth-icon";
import shared from "../register/register.module.css";
import styles from "./login.module.css";

export default function LoginForm() {
  const router = useRouter();
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [notice, setNotice] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    const invalid: typeof errors = {};
    if (!email || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid.email = "Vui lòng nhập địa chỉ email hợp lệ.";
    if (!password.trim() || password.length > 128) invalid.password = "Vui lòng nhập mật khẩu hợp lệ.";
    setErrors(invalid);
    setNotice("");
    if (Object.keys(invalid).length) {
      document.getElementById(Object.keys(invalid)[0])?.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        setNotice(result.detail ?? result.title ?? "Chưa thể đăng nhập. Vui lòng thử lại.");
        return;
      }
      form.reset();
      router.replace("/account");
      router.refresh();
    } catch {
      setNotice("Kết nối bị gián đoạn. Vui lòng thử lại sau ít phút.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className={shared.shell}>
      <header className={shared.header}>
        <Link href="/" className={shared.brand} aria-label="LinguaAI — Trang chủ"><span className={shared.brandMark}><Icon name="book" /></span>LinguaAI</Link>
        <Link href="/" className={shared.backLink}>← Quay lại trang chủ</Link>
      </header>
      <main className={shared.main}>
        <div className={`${shared.card} ${styles.card}`}>
          <aside className={`${shared.story} ${styles.story}`}>
            <div>
              <span className={shared.eyebrow}>TIẾP TỤC HÀNH TRÌNH CỦA BẠN</span>
              <h1>Mỗi ngày một chút.<br /><span>Tự tin hơn mỗi ngày.</span></h1>
              <p className={shared.intro}>Một mục tiêu, một bước tiến mới. Chào mừng bạn trở lại với hành trình học tiếng Anh của mình.</p>
              <div className={styles.visual} aria-hidden="true"><Icon name="sound" /><span>LISTEN. LEARN. GROW.</span><div className={styles.wave}>{[26, 46, 68, 38, 86, 58, 100, 72, 45, 78, 50, 32].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></div>
            </div>
            <div className={styles.note}><Icon name="check" /><p>Điều quan trọng là bạn đã bắt đầu.<br />Hôm nay, hãy tiếp tục.</p></div>
          </aside>
          <section className={`${shared.formPanel} ${styles.formPanel}`} aria-labelledby="login-heading">
            <div className={shared.formHeading}><span className={shared.eyebrow}>CHÀO MỪNG BẠN TRỞ LẠI</span><h2 id="login-heading">Đăng nhập tài khoản</h2><p>Sẵn sàng cho một điều mới hôm nay?</p></div>
            {notice && <div className={shared.notice} role="alert">{notice}</div>}
            <form onSubmit={handleSubmit} noValidate aria-busy={submitting}>
              <fieldset className={shared.fields} disabled={submitting}>
                <div>
                  <label htmlFor="email">Địa chỉ email</label>
                  <div className={shared.inputWrap}><Icon name="mail" /><input id="email" name="email" type="email" placeholder="ban@example.com" autoComplete="username" maxLength={255} required aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} /></div>
                  {errors.email && <p className={shared.fieldError} id="email-error">{errors.email}</p>}
                </div>
                <div>
                  <label htmlFor="password">Mật khẩu</label>
                  <div className={shared.inputWrap}><Icon name="lock" /><input id="password" name="password" type={showPassword ? "text" : "password"} placeholder="Nhập mật khẩu của bạn" autoComplete="current-password" maxLength={128} required className={shared.passwordInput} aria-invalid={!!errors.password} aria-describedby={errors.password ? "password-error" : undefined} /><button type="button" className={shared.reveal} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}><Icon name={showPassword ? "hidden" : "eye"} /></button></div>
                  {errors.password && <p className={shared.fieldError} id="password-error">{errors.password}</p>}
                </div>
                <button className={shared.submit} type="submit">{submitting ? "Đang đăng nhập…" : "Đăng nhập"}{!submitting && <Icon name="arrow" />}</button>
              </fieldset>
            </form>
            <p className={styles.registerLink}>Chưa có tài khoản? <Link href="/register">Đăng ký miễn phí</Link></p>
            <p className={shared.privacy}><Icon name="lock" /> Thông tin đăng nhập của bạn được bảo vệ.</p>
          </section>
        </div>
      </main>
      <footer className={shared.footer}>LinguaAI · Học tiếng Anh theo cách của bạn.</footer>
    </div>
  );
}
