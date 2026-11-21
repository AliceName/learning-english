"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminRequest } from "@/lib/admin-courses";
import { roleLabels, type AdminUserDetail } from "@/lib/admin-users";
import Icon from "@/components/site-icon";
import styles from "./admin.module.css";

type Action = { kind: "lock" | "unlock" | "role"; title: string; confirm: string; danger: boolean };

/**
 * Lock/unlock and role change for one account. Each action opens an inline confirmation that requires a reason
 * (5–500 characters); the API enforces the same rules and the safety checks (self, last admin).
 */
export default function UserActions({ user }: { user: AdminUserDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const id = useId();
  const nextRole = user.role === "admin" ? "user" : "admin";
  const actions: Action[] = [
    user.isActive
      ? { kind: "lock", title: "Khóa tài khoản", confirm: "Khóa tài khoản", danger: true }
      : { kind: "unlock", title: "Mở khóa tài khoản", confirm: "Mở khóa", danger: false },
    { kind: "role", title: nextRole === "admin" ? "Cấp quyền quản trị" : "Bỏ quyền quản trị", confirm: `Đổi thành ${roleLabels[nextRole]}`, danger: nextRole === "admin" },
  ];
  const trimmed = reason.trim();

  function submit() {
    if (!open || inFlight.current || trimmed.length < 5) return;
    inFlight.current = true; setError("");
    const action = open;
    startTransition(async () => {
      try {
        await adminRequest(`users/${user.userId}/${action.kind}`, {
          method: action.kind === "role" ? "PUT" : "POST",
          body: JSON.stringify(action.kind === "role" ? { role: nextRole, reason: trimmed } : { reason: trimmed }),
        });
        setDone(`Đã ${action.title.toLowerCase()}.`); setOpen(null); setReason(""); router.refresh();
      } catch (problem) { setError(problem instanceof Error ? problem.message : "Không thể thực hiện thao tác."); }
      finally { inFlight.current = false; }
    });
  }

  if (user.isSelf) return <p className={styles.hint}>Đây là tài khoản của bạn. Bạn không thể tự khóa hay tự bỏ quyền quản trị.</p>;
  return <div className={styles.userActions}>
    {!open && <div className={styles.filterActions}>{actions.map(action =>
      <button key={action.kind} type="button" className={`${styles.secondaryButton} ${action.danger ? styles.dangerAction : ""}`}
        onClick={() => { setOpen(action); setReason(""); setError(""); setDone(""); }}>
        <Icon name={action.kind === "role" ? "shield" : action.kind === "lock" ? "close" : "check"} />{action.title}</button>)}</div>}
    {open && <div className={styles.confirmDelete} role="alertdialog" aria-labelledby={`${id}-title`}>
      <p id={`${id}-title`}><strong>{open.title}: {user.fullName}</strong></p>
      {open.kind === "lock" && <p>Người này sẽ bị đăng xuất ngay và không thể đăng nhập cho đến khi được mở khóa. Dữ liệu học tập vẫn được giữ.</p>}
      {open.kind === "role" && <p>Người này sẽ phải đăng nhập lại để vai trò mới có hiệu lực.</p>}
      <label className={styles.field}>Lý do (bắt buộc, 5–500 ký tự)
        <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3} autoFocus
          aria-describedby={`${id}-count`} /></label>
      <small id={`${id}-count`}>{trimmed.length}/500 ký tự{trimmed.length > 0 && trimmed.length < 5 ? " · cần ít nhất 5 ký tự" : ""}</small>
      <div><button type="button" className={`${styles.secondaryButton} ${open.danger ? styles.dangerAction : ""}`} onClick={submit}
        disabled={pending || trimmed.length < 5}>{pending ? "Đang lưu…" : open.confirm}</button>
        <button type="button" className={styles.secondaryButton} onClick={() => setOpen(null)} disabled={pending}>Hủy</button></div>
    </div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {done && <p className={styles.success} role="status">{done}</p>}
  </div>;
}
