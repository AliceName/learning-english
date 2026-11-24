"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { PublicUser } from "@/lib/server-auth";
import { levels, localToday, optionLabel, profileDraft, profilePayload, purposes, skills, validateProfile, type ProfileDraft, type ProfileErrors } from "@/lib/profile";
import { PROFILE_LEAVE } from "@/lib/profile-navigation";
import { notifySessionChanged } from "@/lib/session-events";
import AvatarPicker from "./avatar-picker";
import SecuritySettings from "./security-settings";
import styles from "./profile.module.css";

const fieldIds: Record<string, string> = {
  FullName: "profile-name", TargetLevel: "profile-level", AvatarUrl: "profile-avatar",
  "PersonalDetails.PhoneNumber": "profile-phone", "PersonalDetails.DateOfBirth": "profile-birth",
  "PersonalDetails.Address": "profile-address", "LearningPreferences.LearningPurpose": "profile-purpose",
  "LearningPreferences.PreferredSkill": "profile-skill", "LearningPreferences.DailyGoalMinutes": "profile-minutes",
};
const showDate = (date: string) => date ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(date)) : "Chưa cập nhật";

function Field({ id, label, error, children }: { id: string; label: string; error?: string[]; children: ReactNode }) {
  return <div className={styles.field}><label htmlFor={id}>{label}</label>{children}{error && <p id={`${id}-error`} className={styles.fieldError}>{error.join(" ")}</p>}</div>;
}
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children || <span className={styles.empty}>Chưa cập nhật</span>}</dd></div>;
}

export default function ProfileForm({ user }: { user: PublicUser }) {
  const router = useRouter();
  const [saved, setSaved] = useState(user);
  const [draft, setDraft] = useState(() => profileDraft(user));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState("");
  const [errors, setErrors] = useState<ProfileErrors>({});
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const afterConfirm = useRef<(() => void) | null>(null);
  const bypassLeave = useRef(false);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(profileDraft(saved));
  const shown = editing ? draft : profileDraft(saved);
  const initials = shown.fullName.trim().split(/\s+/).slice(-2).map(part => Array.from(part)[0]).join("").toUpperCase() || "?";

  function change<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
    setDraft(previous => ({ ...previous, [key]: value })); setSuccess("");
  }
  function confirmLeave(action: () => void) { afterConfirm.current = action; confirmDialog.current?.showModal(); }
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (bypassLeave.current) return;
      event.preventDefault(); event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (bypassLeave.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.download || link.target && link.target !== "_self") return;
      const url = new URL(link.href, location.href);
      if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
      if (!["http:", "https:"].includes(url.protocol)) return;
      event.preventDefault(); event.stopPropagation();
      confirmLeave(() => { bypassLeave.current = true; window.location.assign(link.href); });
    };
    const requested = (event: Event) => {
      event.preventDefault(); confirmLeave(() => {
        setDraft(profileDraft(saved)); setEditing(false); setErrors({}); setNotice("");
        (event as CustomEvent<() => void>).detail();
      });
    };
    const submit = (event: SubmitEvent) => {
      const form = event.target;
      if (bypassLeave.current || !(form instanceof HTMLFormElement) || form.id === "profile-edit-form") return;
      event.preventDefault(); event.stopPropagation();
      confirmLeave(() => { bypassLeave.current = true; form.requestSubmit(event.submitter); });
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", click, true); window.addEventListener(PROFILE_LEAVE, requested); document.addEventListener("submit", submit, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); window.removeEventListener(PROFILE_LEAVE, requested); document.removeEventListener("submit", submit, true); };
  }, [dirty, saved]);

  function cancel() {
    const reset = () => { setDraft(profileDraft(saved)); setEditing(false); setErrors({}); setNotice(""); };
    if (dirty) confirmLeave(reset); else reset();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current || !dirty) return;
    const invalid = validateProfile(draft); setErrors(invalid); setNotice(""); setSuccess("");
    if (Object.keys(invalid).length) { document.getElementById(fieldIds[Object.keys(invalid)[0]])?.focus(); return; }
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch("/api/account/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profilePayload(draft)) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.errors) setErrors(data.errors);
        setNotice(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : data.title || "Chưa lưu được hồ sơ.");
        document.getElementById(fieldIds[Object.keys(data.errors ?? {})[0]])?.focus(); return;
      }
      setSaved(data); setDraft(profileDraft(data)); setEditing(false);
      setSuccess("Đã lưu hồ sơ của bạn."); notifySessionChanged(); router.refresh();
    } catch { setNotice("Kết nối bị gián đoạn. Hãy tải lại để kiểm tra hồ sơ trước khi thử lại."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const invalidProps = (key: string) => ({ "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${fieldIds[key]}-error` : undefined });

  return <div id="profile" className={styles.profile}>
    <div className={styles.heading}><div><span>KHÔNG GIAN CỦA BẠN</span><h1>Hồ sơ cá nhân</h1><p>Một chút về bạn, một mục tiêu cho hành trình phía trước.</p></div>
      {!editing && <button type="button" className={styles.primary} onClick={() => { bypassLeave.current = false; setEditing(true); setSuccess(""); }}>Chỉnh sửa hồ sơ</button>}
    </div>
    <div aria-live="polite">{success && <p className={styles.success}>✓ {success}</p>}</div>
    {notice && <p className={styles.error} role="alert">{notice}</p>}
    <form id="profile-edit-form" onSubmit={submit} noValidate aria-busy={busy}>
      <fieldset className={styles.formFields} disabled={busy}>
        <legend className={styles.srOnly}>Thông tin hồ sơ</legend>
        <div className={styles.layout}>
          <aside className={`${styles.card} ${styles.identity}`}>
            <div className={styles.cover}><span>LEWA / YOUR JOURNEY</span></div>
            <div className={styles.identityBody}>
              <div className={styles.avatar}>{shown.avatarUrl ? <Image src={shown.avatarUrl} alt="Ảnh đại diện của bạn" width={112} height={112} unoptimized /> : <span>{initials}</span>}</div>
              <span className={styles.role}>{saved.role === "admin" ? "Quản trị viên" : "Thành viên LEWA"}</span>
              <h2>{shown.fullName || "Tên của bạn"}</h2><p className={styles.email}>{saved.email}</p>
              <div className={styles.joined}><span>Tham gia từ</span><strong>{showDate(saved.createdAt)}</strong></div>
              <div className={styles.target}><span>ĐÍCH ĐẾN TIẾNG ANH</span><strong>{shown.targetLevel || "Chưa chọn"}</strong><small>{shown.targetLevel ? optionLabel(levels, shown.targetLevel) : "Chọn mục tiêu khi chỉnh sửa hồ sơ"}</small></div>
              {editing && <div id="profile-avatar"><AvatarPicker value={draft.avatarUrl} onChange={value => change("avatarUrl", value)} />{errors.AvatarUrl && <p className={styles.fieldError}>{errors.AvatarUrl.join(" ")}</p>}</div>}
            </div>
          </aside>
          <div className={styles.sections}>
            <section className={styles.card} aria-labelledby="personal-heading">
              <div className={styles.sectionHeading}><span className={styles.sectionNumber}>01</span><div><h2 id="personal-heading">Thông tin cá nhân</h2><p>Thông tin liên hệ và đôi điều về bạn.</p></div>{editing && <span className={styles.editBadge}>Đang chỉnh sửa</span>}</div>
              {editing ? <div className={styles.inputGrid}>
                <Field id="profile-name" label="Họ và tên *" error={errors.FullName}><input id="profile-name" value={draft.fullName} onChange={e => change("fullName", e.target.value)} maxLength={150} autoComplete="name" required {...invalidProps("FullName")} /></Field>
                <Field id="profile-email" label="Email đăng nhập"><input id="profile-email" type="email" value={saved.email} readOnly autoComplete="email" /></Field>
                <Field id="profile-phone" label="Số điện thoại" error={errors["PersonalDetails.PhoneNumber"]}><input id="profile-phone" type="tel" value={draft.phoneNumber} onChange={e => change("phoneNumber", e.target.value)} placeholder="Ví dụ: 0912 345 678" maxLength={25} autoComplete="tel" {...invalidProps("PersonalDetails.PhoneNumber")} /></Field>
                <Field id="profile-birth" label="Ngày sinh" error={errors["PersonalDetails.DateOfBirth"]}><input id="profile-birth" type="date" min="1900-01-01" max={localToday()} value={draft.dateOfBirth} onChange={e => change("dateOfBirth", e.target.value)} onInput={e => change("dateOfBirth", e.currentTarget.value)} autoComplete="bday" {...invalidProps("PersonalDetails.DateOfBirth")} /></Field>
                <div className={styles.fullWidth}><Field id="profile-address" label="Địa chỉ nơi ở" error={errors["PersonalDetails.Address"]}><input id="profile-address" value={draft.address} onChange={e => change("address", e.target.value)} placeholder="Địa chỉ hoặc tỉnh/thành phố" maxLength={500} autoComplete="street-address" {...invalidProps("PersonalDetails.Address")} /></Field></div>
                <p className={`${styles.hint} ${styles.fullWidth}`}>Số điện thoại, ngày sinh và địa chỉ là thông tin không bắt buộc.</p>
              </div> : <dl className={styles.details}>
                <Detail label="Họ và tên">{saved.fullName}</Detail><Detail label="Email đăng nhập">{saved.email}</Detail>
                <Detail label="Số điện thoại">{shown.phoneNumber}</Detail><Detail label="Ngày sinh">{shown.dateOfBirth && showDate(shown.dateOfBirth)}</Detail>
                <div className={styles.fullWidth}><dt>Địa chỉ nơi ở</dt><dd>{shown.address || <span className={styles.empty}>Chưa cập nhật</span>}</dd></div>
              </dl>}
            </section>
            <section className={styles.card} aria-labelledby="goals-heading">
              <div className={styles.sectionHeading}><span className={`${styles.sectionNumber} ${styles.greenNumber}`}>02</span><div><h2 id="goals-heading">Mục tiêu học tập</h2><p>Bạn muốn tiếng Anh đưa mình đến đâu?</p></div></div>
              {editing ? <div className={styles.inputGrid}>
                <Field id="profile-level" label="Mục tiêu CEFR" error={errors.TargetLevel}><select id="profile-level" value={draft.targetLevel} onChange={e => change("targetLevel", e.target.value)} {...invalidProps("TargetLevel")}><option value="">Chưa chọn mục tiêu</option>{levels.map(([key, label]) => <option key={key} value={key}>{key} — {label}</option>)}</select></Field>
                <Field id="profile-purpose" label="Mục đích học" error={errors["LearningPreferences.LearningPurpose"]}><select id="profile-purpose" value={draft.learningPurpose} onChange={e => change("learningPurpose", e.target.value)} {...invalidProps("LearningPreferences.LearningPurpose")}><option value="">Chưa chọn</option>{purposes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
                <Field id="profile-skill" label="Kỹ năng ưu tiên" error={errors["LearningPreferences.PreferredSkill"]}><select id="profile-skill" value={draft.preferredSkill} onChange={e => change("preferredSkill", e.target.value)} {...invalidProps("LearningPreferences.PreferredSkill")}><option value="">Chưa chọn</option>{skills.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
                <Field id="profile-minutes" label="Số phút học mỗi ngày" error={errors["LearningPreferences.DailyGoalMinutes"]}><div className={styles.minutesInput}><input id="profile-minutes" type="number" inputMode="numeric" min={5} max={180} step={1} value={draft.dailyGoalMinutes} placeholder="15" onChange={e => change("dailyGoalMinutes", e.target.value)} {...invalidProps("LearningPreferences.DailyGoalMinutes")} /><span>phút / ngày</span></div></Field>
                <p className={`${styles.hint} ${styles.fullWidth}`}>CEFR là mục tiêu bạn tự chọn, không phải kết quả đánh giá trình độ.</p>
              </div> : <>
                <dl className={styles.details}><Detail label="Mục đích học">{optionLabel(purposes, shown.learningPurpose)}</Detail><Detail label="Kỹ năng ưu tiên">{optionLabel(skills, shown.preferredSkill)}</Detail></dl>
                <div className={styles.dailyGoal}><span className={styles.goalIcon} aria-hidden="true">◷</span><div><strong>{shown.dailyGoalMinutes ? `${shown.dailyGoalMinutes} phút mỗi ngày` : "Một thói quen nhỏ, mỗi ngày"}</strong><p>{shown.dailyGoalMinutes ? "Mục tiêu thời gian bạn đã chọn." : "Đặt thời gian phù hợp với lịch của bạn."}</p><small>CEFR là mục tiêu tự chọn của bạn.</small></div></div>
              </>}
            </section>
          </div>
        </div>
        {editing && <div className={styles.editBar}><div><strong>{dirty ? "Bạn có thay đổi chưa lưu" : "Chỉnh sửa hồ sơ của bạn"}</strong><span>Lưu để cập nhật thông tin tài khoản.</span></div><button type="button" onClick={cancel}>Hủy thay đổi</button><button type="submit" className={styles.primary} disabled={busy || !dirty}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button></div>}
      </fieldset>
    </form>
    <SecuritySettings disabled={editing} />
    <dialog ref={confirmDialog} className={styles.dialog} aria-labelledby="leave-title" aria-describedby="leave-description" onClose={() => { afterConfirm.current = null; }}>
      <h2 id="leave-title">Bạn có thay đổi chưa lưu</h2><p id="leave-description">Nếu tiếp tục, những thay đổi này sẽ bị bỏ.</p><div className={styles.dialogActions}><button type="button" onClick={() => confirmDialog.current?.close()} autoFocus>Tiếp tục chỉnh sửa</button><button type="button" className={styles.primary} onClick={() => { const action = afterConfirm.current; confirmDialog.current?.close(); action?.(); }}>Bỏ thay đổi</button></div>
    </dialog>
  </div>;
}
