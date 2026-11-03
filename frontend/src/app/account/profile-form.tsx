"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { PublicUser } from "@/lib/server-auth";
import { isProfileAvatar } from "@/lib/profile-avatar";
import styles from "./profile.module.css";

const avatars = [
  { color: "blue", label: "Xanh dương" }, { color: "purple", label: "Tím" },
  { color: "green", label: "Xanh lá" }, { color: "orange", label: "Cam" },
  { color: "pink", label: "Hồng" }, { color: "teal", label: "Xanh ngọc" },
];
const avatarPath = (color: string) => `/avatars/profile-${color}.svg`;
type Errors = Record<string, string[]>;

export default function ProfileForm({ user }: { user: PublicUser }) {
  const router = useRouter();
  const [saved, setSaved] = useState<PublicUser>({ ...user, avatarUrl: isProfileAvatar(user.avatarUrl) ? user.avatarUrl : null });
  const [fullName, setFullName] = useState(user.fullName);
  const [targetLevel, setTargetLevel] = useState(user.targetLevel ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(isProfileAvatar(user.avatarUrl) ? user.avatarUrl! : null);
  const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const [notice, setNotice] = useState(""); const [success, setSuccess] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const dirty = fullName !== saved.fullName || targetLevel !== (saved.targetLevel ?? "") || avatarUrl !== (saved.avatarUrl ?? null);
  const displayAvatar = isProfileAvatar(avatarUrl) ? avatarUrl : null;
  const initials = fullName.trim().split(/\s+/).slice(-2).map(part => Array.from(part)[0]).join("").toUpperCase() || "?";

  function reset() {
    setFullName(saved.fullName); setTargetLevel(saved.targetLevel ?? ""); setAvatarUrl(saved.avatarUrl ?? null);
    setErrors({}); setNotice(""); setSuccess("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current || !dirty) return;
    setSuccess(""); setNotice("");
    const invalid: Errors = {};
    if (!fullName.trim() || fullName.trim().length > 150 || /[\u0000-\u001f\u007f]/.test(fullName)) invalid.FullName = ["Nhập họ và tên hợp lệ, tối đa 150 ký tự."];
    setErrors(invalid);
    if (Object.keys(invalid).length) { document.getElementById("profile-name")?.focus(); return; }
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch("/api/account/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName, targetLevel: targetLevel || null, avatarUrl }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.errors) setErrors(data.errors);
        setNotice(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : data.title || "Chưa lưu được hồ sơ."); return;
      }
      const updated = data as PublicUser;
      setSaved(updated); setFullName(updated.fullName); setTargetLevel(updated.targetLevel ?? ""); setAvatarUrl(updated.avatarUrl ?? null);
      setSuccess("Đã lưu hồ sơ của bạn."); router.refresh();
    } catch { setNotice("Kết nối bị gián đoạn. Hãy tải lại trang để kiểm tra hồ sơ trước khi thử lại."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <form id="profile" className={styles.form} onSubmit={submit} noValidate aria-busy={busy}>
    <div className={styles.heading}><span>THÔNG TIN TÀI KHOẢN</span><h1>Hồ sơ cá nhân</h1><p>Cập nhật thông tin để cá nhân hóa hành trình học tiếng Anh của bạn.</p></div>
    <fieldset disabled={busy} className={styles.fields}>
      <legend className={styles.legend}>Chỉnh sửa hồ sơ của bạn</legend>
      <div className={styles.identity}><div className={styles.avatar}>{displayAvatar ? <Image src={displayAvatar} alt="" width={88} height={88} unoptimized /> : <span>{initials}</span>}</div><div><h2>{saved.fullName}</h2><p>{saved.email}</p><span className={styles.role}>{saved.role === "admin" ? "Quản trị viên" : "Thành viên"}</span></div></div>
      <fieldset className={styles.avatarChoices}><legend>Ảnh đại diện</legend><div className={styles.choices}><label><input type="radio" name="avatar" checked={avatarUrl === null} onChange={() => setAvatarUrl(null)} /><span className={styles.initialChoice}>Chữ cái</span></label>{avatars.map(avatar => <label key={avatar.color}><input type="radio" name="avatar" checked={avatarUrl === avatarPath(avatar.color)} onChange={() => setAvatarUrl(avatarPath(avatar.color))} /><Image src={avatarPath(avatar.color)} alt={avatar.label} width={48} height={48} unoptimized /></label>)}</div><small>Chọn một ảnh có sẵn hoặc dùng chữ cái từ tên của bạn.</small></fieldset>
      <div className={styles.row}><label htmlFor="profile-name">Họ và tên <span aria-hidden="true">*</span></label><input id="profile-name" name="fullName" value={fullName} onChange={event => setFullName(event.target.value)} maxLength={150} autoComplete="name" required aria-invalid={!!errors.FullName} aria-describedby={errors.FullName ? "name-error" : undefined} />{errors.FullName && <p id="name-error" className={styles.error}>{errors.FullName.join(" ")}</p>}</div>
      <div className={styles.row}><label htmlFor="profile-email">Địa chỉ email</label><input id="profile-email" type="email" value={saved.email} readOnly autoComplete="email" /><small>Email dùng để đăng nhập tài khoản.</small></div>
      <div className={styles.row}><label htmlFor="profile-level">Mục tiêu tiếng Anh</label><select id="profile-level" value={targetLevel} onChange={event => setTargetLevel(event.target.value)} aria-invalid={!!errors.TargetLevel} aria-describedby="level-help"><option value="">Chưa chọn mục tiêu</option><option value="A1">A1 — Sơ cấp</option><option value="A2">A2 — Cơ bản</option><option value="B1">B1 — Trung cấp</option><option value="B2">B2 — Trung cao cấp</option><option value="C1">C1 — Nâng cao</option><option value="C2">C2 — Chuyên sâu</option></select><small id="level-help">Đây là mục tiêu bạn muốn đạt, không phải kết quả đánh giá trình độ.</small>{errors.TargetLevel && <p className={styles.error}>{errors.TargetLevel.join(" ")}</p>}</div>
      <div className={styles.created}><span>Ngày tham gia</span><strong>{new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(saved.createdAt))}</strong></div>
      {notice && <p className={styles.error} role="alert">{notice}</p>}
      {success && <p className={styles.success} role="status">✓ {success}</p>}
      <div className={styles.actions}><button type="submit" disabled={!dirty || busy} className={styles.save}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button><button type="button" disabled={!dirty || busy} onClick={reset}>Hủy thay đổi</button>{dirty && <small>Có thay đổi chưa lưu</small>}</div>
    </fieldset>
  </form>;
}
