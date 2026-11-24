"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { notifySessionChanged } from "@/lib/session-events";
import styles from "./profile.module.css";

export default function SecuritySettings({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const sessionDialog = useRef<HTMLDialogElement>(null);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled || inFlight.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const body = { currentPassword: String(values.get("currentPassword") ?? ""), newPassword: String(values.get("newPassword") ?? ""), confirmPassword: String(values.get("confirmPassword") ?? "") };
    const invalid: typeof errors = {};
    if (!body.currentPassword || body.currentPassword.length > 128) invalid.CurrentPassword = ["Nhập mật khẩu hiện tại."];
    if (!body.newPassword.trim() || body.newPassword.length < 8 || body.newPassword.length > 128) invalid.NewPassword = ["Mật khẩu mới phải có từ 8 đến 128 ký tự."];
    else if (body.newPassword === body.currentPassword) invalid.NewPassword = ["Mật khẩu mới phải khác mật khẩu hiện tại."];
    if (body.confirmPassword !== body.newPassword) invalid.ConfirmPassword = ["Mật khẩu xác nhận không khớp."];
    setErrors(invalid); setNotice(""); setSuccess("");
    if (Object.keys(invalid).length) { document.getElementById(`security-${Object.keys(invalid)[0]}`)?.focus(); return; }
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch("/api/account/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setErrors(data.errors ?? {}); setNotice(data.title || "Chưa đổi được mật khẩu."); return; }
      form.reset(); notifySessionChanged(); router.replace("/login"); router.refresh();
    } catch { setNotice("Kết nối bị gián đoạn. Nếu mật khẩu đã được đổi, hãy đăng nhập bằng mật khẩu mới."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function revokeOthers() {
    if (disabled || inFlight.current) return;
    sessionDialog.current?.close(); inFlight.current = true; setBusy(true); setNotice(""); setSuccess("");
    try {
      const response = await fetch("/api/account/sessions/others", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setNotice(data.title || "Chưa đăng xuất được các phiên khác."); return; }
      setSuccess("Đã đăng xuất các phiên khác. Bạn vẫn đăng nhập trên trình duyệt này."); notifySessionChanged();
    } catch { setNotice("Kết nối bị gián đoạn. Hãy tải lại để kiểm tra phiên đăng nhập."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className={`${styles.card} ${styles.security}`} aria-labelledby="security-heading" aria-busy={busy}>
    <div className={styles.sectionHeading}><span className={`${styles.sectionNumber} ${styles.purpleNumber}`}>03</span><div><h2 id="security-heading">Bảo mật tài khoản</h2><p>Chủ động bảo vệ tài khoản của bạn.</p></div></div>
    {disabled && <p className={styles.hint}>Lưu hoặc hủy chỉnh sửa hồ sơ trước khi thay đổi bảo mật.</p>}
    <fieldset className={styles.formFields} disabled={disabled || busy}>
      <legend className={styles.srOnly}>Cài đặt bảo mật</legend>
      <div className={styles.securityRow}><div><h3>Mật khẩu đăng nhập</h3><p>Đổi mật khẩu sẽ đăng xuất tất cả các phiên. Bạn sẽ đăng nhập lại.</p></div><button type="button" aria-expanded={expanded} aria-controls="password-form" onClick={() => { setExpanded(!expanded); setErrors({}); setNotice(""); }}>{expanded ? "Đóng" : "Đổi mật khẩu"}</button></div>
      {expanded && <form id="password-form" className={styles.passwordForm} onSubmit={changePassword} noValidate>
        <p className={styles.hint}>Mật khẩu mới từ 8 đến 128 ký tự, khác mật khẩu hiện tại.</p>
        <div className={styles.inputGrid}>
          {([ ["CurrentPassword", "currentPassword", "Mật khẩu hiện tại", "current-password"], ["NewPassword", "newPassword", "Mật khẩu mới", "new-password"], ["ConfirmPassword", "confirmPassword", "Nhập lại mật khẩu mới", "new-password"] ] as const).map(([key, name, label, autocomplete]) => <div key={key} className={styles.field}><label htmlFor={`security-${key}`}>{label}</label><input id={`security-${key}`} type="password" name={name} autoComplete={autocomplete} maxLength={128} required aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${key}-error` : undefined} />{errors[key] && <p id={`${key}-error`} className={styles.fieldError}>{errors[key].join(" ")}</p>}</div>)}
        </div><button type="submit" className={styles.primary}>{busy ? "Đang cập nhật…" : "Cập nhật mật khẩu"}</button>
      </form>}
      <div className={styles.securityRow}><div><h3>Phiên đăng nhập khác</h3><p>Đăng xuất tài khoản trên các trình duyệt và thiết bị khác.</p></div><button type="button" onClick={() => sessionDialog.current?.showModal()}>Đăng xuất phiên khác</button></div>
    </fieldset>
    {notice && <p className={styles.error} role="alert">{notice}</p>}{success && <p className={styles.success} role="status">✓ {success}</p>}
    <dialog ref={sessionDialog} className={styles.dialog} aria-labelledby="sessions-title" aria-describedby="sessions-description"><h2 id="sessions-title">Đăng xuất các phiên khác?</h2><p id="sessions-description">Các phiên khác sẽ cần đăng nhập lại. Trình duyệt hiện tại vẫn tiếp tục sử dụng được.</p><div className={styles.dialogActions}><button type="button" onClick={() => sessionDialog.current?.close()} autoFocus>Hủy</button><button type="button" className={styles.primary} onClick={revokeOthers}>Đăng xuất phiên khác</button></div></dialog>
  </section>;
}
