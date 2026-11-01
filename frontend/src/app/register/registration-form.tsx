"use client";

import Icon from "@/components/auth-icon";
import { useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { AuthReaction } from "@/components/auth/auth-mascot";
import styles from "@/components/auth/auth-screen.module.css";

type Field = "fullName" | "email" | "password" | "confirmPassword" | "targetLevel";
type FieldErrors = Partial<Record<Field, string>>;
type ApiResponse = { detail?: string; title?: string; errors?: Record<string, string[]>; user?: { fullName: string; email: string } };

export default function RegistrationForm({ initialEmail = "", onReaction, onBusyChange, onLogin }: {
  initialEmail?: string;
  onReaction: (reaction: AuthReaction) => void;
  onBusyChange: (busy: boolean) => void;
  onLogin: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState("");
  const [password, setPassword] = useState("");
  const [registered, setRegistered] = useState<ApiResponse["user"]>();
  const inFlight = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    onReaction("sparkle");
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
    onBusyChange(true);
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
      onBusyChange(false);
    }
  }

  function fieldError(field: Field) {
    return errors[field] ? <p className={styles.fieldError} id={`${field}-error`}>{errors[field]}</p> : null;
  }

  const strength = !password ? 0 : password.length < 8 ? 1 : Math.min(4, 1 + Number(/[a-z]/.test(password) && /[A-Z]/.test(password)) + Number(/[0-9]/.test(password)) + Number(/[^A-Za-z0-9]/.test(password)));
  const strengthLabel = ["Chưa nhập", "Yếu", "Trung bình", "Khá mạnh", "Mạnh"][strength];
  const strengthColor = ["#e2e7ff", "#ba1a1a", "#b77900", "#2563eb", "#00668a"][strength];

  if (registered) return (
    <div className={styles.success} role="status">
      <span className={styles.successIcon}><Icon name="check" /></span>
      <h1>Tạo tài khoản thành công!</h1>
      <p>Xin chào <strong>{registered.fullName}</strong>. Tài khoản với email <strong>{registered.email}</strong> của bạn đã được tạo.</p>
      <button type="button" onClick={onLogin} className={styles.submit}>Đăng nhập ngay <Icon name="arrow" /></button>
    </div>
  );

  return (
    <>
      <div className={styles.formHeading}><h1>Khởi đầu miễn phí</h1><p>Đánh giá phát âm chuẩn AI và trải nghiệm lộ trình cá nhân hóa</p></div>
      {notice && <div className={styles.notice} role="alert">{notice}</div>}
      <form onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <fieldset className={styles.fields} disabled={submitting}>
          <div><label htmlFor="fullName">Họ và tên</label><div className={styles.inputWrap}><input id="fullName" name="fullName" autoComplete="name" placeholder="Nguyễn Văn A" maxLength={150} required aria-invalid={!!errors.fullName} aria-describedby={errors.fullName ? "fullName-error" : undefined} /></div>{fieldError("fullName")}</div>
          <div><label htmlFor="email">Địa chỉ email</label><div className={styles.inputWrap}><input id="email" name="email" type="email" autoComplete="email" placeholder="name@example.com" defaultValue={initialEmail} maxLength={255} required aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} /></div>{fieldError("email")}</div>
          <div>
            <label htmlFor="password">Mật khẩu mới</label>
            <div className={styles.inputWrap}><input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Tối thiểu 8 ký tự" minLength={8} maxLength={128} onChange={event => setPassword(event.target.value)} required aria-invalid={!!errors.password} aria-describedby={errors.password ? "password-error password-hint" : "password-hint"} className={styles.passwordInput} /><button type="button" className={styles.reveal} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}><Icon name={showPassword ? "hidden" : "eye"} /></button></div>
            {fieldError("password")}
            <div className={styles.strength} style={{ "--strength-color": strengthColor } as CSSProperties}>
              <div className={styles.strengthBars} role="meter" aria-label="Độ mạnh mật khẩu" aria-valuemin={0} aria-valuemax={4} aria-valuenow={strength} aria-valuetext={strengthLabel}>{[1, 2, 3, 4].map(level => <i key={level} data-filled={level <= strength} />)}</div>
              <span>{strengthLabel}</span>
            </div>
            <p id="password-hint" className={styles.hint}>Sử dụng từ 8 đến 128 ký tự.</p>
          </div>
          <div><label htmlFor="confirmPassword">Xác nhận lại mật khẩu</label><div className={styles.inputWrap}><input id="confirmPassword" name="confirmPassword" type={showConfirmation ? "text" : "password"} autoComplete="new-password" placeholder="Nhập lại mật khẩu" maxLength={128} required aria-invalid={!!errors.confirmPassword} aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined} className={styles.passwordInput} /><button type="button" className={styles.reveal} aria-label={showConfirmation ? "Ẩn mật khẩu xác nhận" : "Hiện mật khẩu xác nhận"} aria-pressed={showConfirmation} onClick={() => setShowConfirmation(!showConfirmation)}><Icon name={showConfirmation ? "hidden" : "eye"} /></button></div>{fieldError("confirmPassword")}</div>
          <div><label htmlFor="targetLevel">Mục tiêu trình độ CEFR <span className={styles.optional}>(không bắt buộc)</span></label><select id="targetLevel" name="targetLevel" defaultValue="" aria-invalid={!!errors.targetLevel} aria-describedby={errors.targetLevel ? "targetLevel-error" : undefined}><option value="">Tôi sẽ chọn sau</option>{["A1", "A2", "B1", "B2", "C1", "C2"].map(level => <option value={level} key={level}>{level}</option>)}</select>{fieldError("targetLevel")}</div>
          <button type="submit" className={styles.submit}>{submitting ? "Đang tạo tài khoản…" : "Tạo tài khoản miễn phí"}</button>
        </fieldset>
      </form>
      <p className={styles.privacy}><Icon name="lock" /> Mật khẩu của bạn được bảo vệ và không hiển thị công khai.</p>
    </>
  );
}
