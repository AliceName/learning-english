"use client";

import { useRef, useState, type FormEvent } from "react";
import Icon from "@/components/auth-icon";
import type { AuthReaction } from "@/components/auth/auth-mascot";
import styles from "@/components/auth/auth-screen.module.css";
import { notifySessionChanged } from "@/lib/session-events";
import { adoptAnonymousWritingDraft, writingDraftStorage } from "@/lib/writing-draft";
import { safeWritingReturnTo, writingReturnSubmissionId, writingReturnTaskId } from "@/lib/writing-return";

export default function LoginForm({ returnTo = "/account", onReaction, onBusyChange }: { returnTo?: string; onReaction: (reaction: AuthReaction) => void; onBusyChange: (busy: boolean) => void }) {
  const writingDestination = safeWritingReturnTo(returnTo);
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [notice, setNotice] = useState("");
  const [forgotPassword, setForgotPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    onReaction("heart");
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
    onBusyChange(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (response.ok) {
        const next = new URLSearchParams(window.location.search).get("next") ?? "";
        const returnToCourse = /^\/courses\/[1-9]\d{0,9}(?:\/lessons\/[1-9]\d{0,9}\/listening)?$/.test(next);
        const destination = writingDestination.startsWith("/writing") ? writingDestination
          : returnToCourse ? next : result.user?.role === "admin" ? "/admin/courses" : "/account";
        if (writingDestination.startsWith("/writing") && Number.isInteger(result.user?.userId)) {
          adoptAnonymousWritingDraft(writingDraftStorage(), result.user.userId, writingReturnSubmissionId(writingDestination), Date.now(), writingReturnTaskId(writingDestination));
        }
        notifySessionChanged();
        // Load the protected page with the new cookie, bypassing any cached guest redirect.
        window.location.replace(destination);
        return;
      }
      setNotice(result.detail ?? result.title ?? "Chưa thể đăng nhập. Vui lòng thử lại.");
    } catch {
      setNotice("Kết nối bị gián đoạn. Vui lòng thử lại sau ít phút.");
    }
    inFlight.current = false;
    setSubmitting(false);
    onBusyChange(false);
  }

  return (
    <>
      <div className={styles.formHeading}><h1>Chào mừng trở lại</h1><p>Tiếp tục hành trình học tiếng Anh cá nhân hóa cùng AI</p></div>
      <button type="button" className={styles.google} disabled title="Đăng nhập với Google sẽ sớm được hỗ trợ">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85Z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z" /></svg>
        Tiếp tục với Google <small>Sắp ra mắt</small>
      </button>
      <div className={styles.divider}>Hoặc bằng email</div>
      {notice && <div className={styles.notice} role="alert">{notice}</div>}
      {forgotPassword && <div id="password-help" className={styles.help} role="status">Bạn quên mật khẩu? Hãy liên hệ quản trị viên để được hỗ trợ khôi phục tài khoản. Tính năng đặt lại mật khẩu qua email chưa được hỗ trợ.</div>}
      <form onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <fieldset className={styles.fields} disabled={submitting}>
          <div>
            <label htmlFor="email">Địa chỉ email</label>
            <div className={styles.inputWrap}><input id="email" name="email" type="email" placeholder="name@example.com" autoComplete="username" maxLength={255} required aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} /></div>
            {errors.email && <p className={styles.fieldError} id="email-error">{errors.email}</p>}
          </div>
          <div>
            <div className={styles.labelRow}><label htmlFor="password">Mật khẩu</label><button type="button" className={styles.textButton} aria-expanded={forgotPassword} aria-controls="password-help" onClick={() => { setForgotPassword(true); onReaction("delighted"); }}>Quên mật khẩu?</button></div>
            <div className={styles.inputWrap}><input id="password" name="password" type={showPassword ? "text" : "password"} placeholder="Nhập mật khẩu của bạn" autoComplete="current-password" maxLength={128} required className={styles.passwordInput} aria-invalid={!!errors.password} aria-describedby={errors.password ? "password-error" : undefined} /><button type="button" className={styles.reveal} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}><Icon name={showPassword ? "hidden" : "eye"} /></button></div>
            {errors.password && <p className={styles.fieldError} id="password-error">{errors.password}</p>}
          </div>
          <button className={styles.submit} type="submit">{submitting ? "Đang đăng nhập…" : "Đăng nhập vào không gian học"}</button>
        </fieldset>
      </form>
      <p className={styles.privacy}><Icon name="lock" /> Thông tin đăng nhập của bạn được bảo vệ.</p>
    </>
  );
}
