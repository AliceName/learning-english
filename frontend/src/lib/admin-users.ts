// Shapes of /api/v1/admin/users. Counts only: the admin UI never receives learning content or password data.
export type AdminUserListItem = {
  userId: number; fullName: string; email: string; role: "admin" | "user"; isActive: boolean;
  createdAt: string; lastStudyDate: string | null; currentStreak: number;
};
export type AdminUserList = { items: AdminUserListItem[]; totalCount: number; page: number; pageSize: number; totalPages: number };
export type AdminAuditEntry = {
  at: string; actorId: number; actorName: string | null; targetId: number; action: "lock" | "unlock" | "role";
  from: string | null; to: string | null; reason: string;
};
export type AdminUserDetail = Omit<AdminUserListItem, never> & {
  targetLevel: string | null; updatedAt: string; longestStreak: number; isSelf: boolean;
  stats: { studyDaysThisYear: number; writingSubmissions: number; flashcardDecks: number; flashcards: number; enrolledCourses: number; aiCallsLast30Days: number | null };
  history: AdminAuditEntry[];
};

export const roleLabels = { admin: "Quản trị viên", user: "Học viên" } as const;

/** One line describing an audit entry, e.g. "Khóa tài khoản" or "Đổi vai trò: Học viên → Quản trị viên". */
export function auditLabel(entry: AdminAuditEntry): string {
  if (entry.action === "lock") return "Khóa tài khoản";
  if (entry.action === "unlock") return "Mở khóa tài khoản";
  const name = (role: string | null) => role === "admin" || role === "user" ? roleLabels[role] : role ?? "—";
  return `Đổi vai trò: ${name(entry.from)} → ${name(entry.to)}`;
}

export const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString("vi-VN") : "—";
export const formatDateTime = (value: string) => new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
