"use client";

import Link from "next/link";
import Icon from "@/components/auth-icon";
import { useRef, useState, type FormEvent } from "react";
import styles from "./register.module.css";

type Field = "fullName" | "email" | "password" | "confirmPassword" | "targetLevel";
type FieldErrors = Partial<Record<Field, string>>;
type ApiResponse = { detail?: string; title?: string; errors?: Record<string, string[]>; user?: { fullName: string; email: string } };

export default function RegistrationForm({ initialEmail = "" }: { initialEmail?: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState("");
  const [registered, setRegistered] = useState<ApiResponse["user"]>();
  const inFlight = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const fullName = String(values.get("fullName") ?? "").trim();
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    const confirmPassword = String(values.get("confirmPassword") ?? "");
    const targetLevel = String(values.get("targetLevel") ?? "");
    const invalid: FieldErrors = {};
    if (!fullName || fullName.length > 150) invalid.fullName = "Nhập họ và tên từ 1 đến 150 ký tự.";
    if (!email || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid.email = "Vui lòng nhập địa chỉ email hợp lệ.";
    if (!password.trim() || password.length < 8 || password.length > 128) invalid.password = "Mật khẩu phải có từ 8 đến 128 ký tự.";
    if (!confirmPassword || confirmPassword !== password) invalid.confirmPassword = "Mật khẩu xác nhận không khớp.";
    setErrors(invalid);
    setNotice("");
    if (Object.keys(invalid).length) {
      document.getElementById(Object.keys(invalid)[0])?.focus();
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, password, confirmPassword, targetLevel: targetLevel || null }),
      });
      const result: ApiResponse = await response.json();
      if (!response.ok) {
        const fieldErrors: FieldErrors = {};
        for (const [key, messages] of Object.entries(result.errors ?? {})) {
          const field = (key.charAt(0).toLowerCase() + key.slice(1)) as Field;
          if (["fullName", "email", "password", "confirmPassword", "targetLevel"].includes(field)) fieldErrors[field] = messages[0];
        }
        setErrors(fieldErrors);
        setNotice(result.detail ?? result.title ?? "Chưa thể tạo tài khoản. Vui lòng thử lại.");
        const field = Object.keys(fieldErrors)[0];
        if (field) document.getElementById(field)?.focus();
        return;
      }
      if (!result.user) throw new Error("Invalid registration response");
      form.reset();
      setRegistered(result.user);
    } catch {
      setNotice("Kết nối bị gián đoạn. Vui lòng thử lại sau ít phút.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function fieldError(field: Field) {
    return errors[field] ? <p className={styles.fieldError} id={`${field}-error`}>{errors[field]}</p> : null;
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="LinguaAI — Trang chủ"><span className={styles.brandMark}><Icon name="book" /></span>LinguaAI</Link>
        <Link href="/" className={styles.backLink}>← <span>Quay lại trang chủ</span></Link>
      </header>
      <main className={styles.main}>
        <div className={styles.card}>
          <aside className={styles.story}>
            <div>
              <span className={styles.eyebrow}>MỖI NGÀY MỘT BƯỚC TIẾN</span>
              <h1>Khởi đầu hành trình.<br /><span>Bứt phá cùng tiếng Anh.</span></h1>
              <p className={styles.intro}>Một tài khoản, một hành trình học tập dành riêng cho bạn. Bắt đầu từ mục tiêu hôm nay.</p>
              <div className={styles.features}>
                <div className={styles.feature}><span className={styles.featureIcon}><Icon name="sound" /></span><div><h2>Tự tin với bốn kỹ năng</h2><p>Nói, nghe, đọc và viết trên cùng một nền tảng.</p></div></div>
                <div className={styles.feature}><span className={styles.featureIcon}><Icon name="target" /></span><div><h2>Đặt mục tiêu rõ ràng</h2><p>Chọn trình độ CEFR bạn muốn chinh phục, từ A1 đến C2.</p></div></div>
                <div className={styles.feature}><span className={styles.featureIcon}><Icon name="book" /></span><div><h2>Học theo nhịp của bạn</h2><p>Dành thời gian mỗi ngày cho một điều mới.</p></div></div>
              </div>
            </div>
            <div className={styles.quote}><span className={styles.quoteMark}>“</span><p>Hành trình ngàn dặm bắt đầu<br />từ một bước chân.</p><span className={styles.quoteCaption}>BƯỚC ĐẦU TIÊN LÀ CỦA BẠN</span></div>
          </aside>
          <section className={styles.formPanel} aria-labelledby="register-heading">
            {registered ? (
              <div className={styles.success} role="status">
                <span className={styles.successIcon}><Icon name="check" /></span>
                <span className={styles.eyebrow}>CHÀO MỪNG BẠN ĐẾN VỚI LINGUAAI</span>
                <h2 id="register-heading">Tạo tài khoản thành công!</h2>
                <p>Xin chào <strong>{registered.fullName}</strong>. Tài khoản với email <strong>{registered.email}</strong> của bạn đã được tạo.</p>
                <Link href="/login" className={styles.submit}>Đăng nhập ngay <Icon name="arrow" /></Link>
              </div>
            ) : (
              <>
                <div className={styles.formHeading}><span className={styles.eyebrow}>BẮT ĐẦU CÙNG LINGUAAI</span><h2 id="register-heading">Tạo tài khoản miễn phí<span aria-hidden="true"> ✨</span></h2><p>Chỉ một bước nhỏ cho hành trình học tập mới.</p></div>
                {notice && <div className={styles.notice} role="alert">{notice}</div>}
                <form onSubmit={handleSubmit} noValidate aria-busy={submitting}>
                  <fieldset className={styles.fields} disabled={submitting}>
                    <div><label htmlFor="fullName">Họ và tên</label><div className={styles.inputWrap}><Icon name="person" /><input id="fullName" name="fullName" autoComplete="name" placeholder="Nguyễn Minh Anh" maxLength={150} required aria-invalid={!!errors.fullName} aria-describedby={errors.fullName ? "fullName-error" : undefined} /></div>{fieldError("fullName")}</div>
                    <div><label htmlFor="email">Địa chỉ email</label><div className={styles.inputWrap}><Icon name="mail" /><input id="email" name="email" type="email" autoComplete="email" placeholder="ban@example.com" defaultValue={initialEmail} maxLength={255} required aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} /></div>{fieldError("email")}</div>
                    <div><label htmlFor="password">Mật khẩu</label><div className={styles.inputWrap}><Icon name="lock" /><input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Tạo mật khẩu của bạn" minLength={8} maxLength={128} required aria-invalid={!!errors.password} aria-describedby={errors.password ? "password-error" : "password-hint"} className={styles.passwordInput} /><button type="button" className={styles.reveal} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}><Icon name={showPassword ? "hidden" : "eye"} /></button></div>{fieldError("password")}<p id="password-hint" className={styles.hint}>Sử dụng từ 8 đến 128 ký tự.</p></div>
                    <div><label htmlFor="confirmPassword">Xác nhận mật khẩu</label><div className={styles.inputWrap}><Icon name="lock" /><input id="confirmPassword" name="confirmPassword" type={showConfirmation ? "text" : "password"} autoComplete="new-password" placeholder="Nhập lại mật khẩu" maxLength={128} required aria-invalid={!!errors.confirmPassword} aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined} className={styles.passwordInput} /><button type="button" className={styles.reveal} aria-label={showConfirmation ? "Ẩn mật khẩu xác nhận" : "Hiện mật khẩu xác nhận"} aria-pressed={showConfirmation} onClick={() => setShowConfirmation(!showConfirmation)}><Icon name={showConfirmation ? "hidden" : "eye"} /></button></div>{fieldError("confirmPassword")}</div>
                    <div><label htmlFor="targetLevel">Mục tiêu trình độ CEFR <span className={styles.optional}>(không bắt buộc)</span></label><select id="targetLevel" name="targetLevel" defaultValue="" aria-invalid={!!errors.targetLevel}><option value="">Tôi sẽ chọn sau</option>{["A1", "A2", "B1", "B2", "C1", "C2"].map(level => <option value={level} key={level}>{level}</option>)}</select>{fieldError("targetLevel")}</div>
                    <button type="submit" className={styles.submit}>{submitting ? "Đang tạo tài khoản…" : "Tạo tài khoản"}{!submitting && <Icon name="arrow" />}</button>
                  </fieldset>
                </form>
                <p className={styles.authLink}>Đã có tài khoản? <Link href="/login">Đăng nhập</Link></p>
                <p className={styles.privacy}><Icon name="lock" /> Mật khẩu của bạn được bảo vệ và không hiển thị công khai.</p>
              </>
            )}
          </section>
        </div>
      </main>
      <footer className={styles.footer}>LinguaAI · Học tiếng Anh theo cách của bạn.</footer>
    </div>
  );
}
