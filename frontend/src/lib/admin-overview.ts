import type { AdminAuditEntry } from "./admin-users";

export type AdminOverview = {
  generatedAt: string; today: string; countedLearners: number; excludedAccounts: number;
  activity: {
    learnersToday: number; learners7Days: number; learners30Days: number;
    newAccounts7Days: number; newAccounts30Days: number;
    essays7Days: number; revisions7Days: number; essays30Days: number;
    aiCalls7Days: number | null; aiErrors7Days: number | null;
  };
  daily: { date: string; learners: number }[];
  skills: { kind: string; learners: number }[];
  attention: { kind: string; count: number; href: string }[];
  recent: AdminAuditEntry[];
};

export type ServiceStatus = "ok" | "down" | "unconfigured" | "configured";
export type AdminServiceReport = {
  checkedAt: string;
  services: { key: string; name: string; status: ServiceStatus; latencyMs: number | null; detail: string }[];
};

export const skillLabels: Record<string, string> = {
  listening: "Nghe", speaking: "Nói", reading: "Đọc", writing: "Viết", grammar: "Ngữ pháp",
  flashcards: "Flashcards", translation: "Phiên dịch", vocabulary: "Từ vựng",
};

export const statusLabels: Record<ServiceStatus, string> = {
  ok: "Hoạt động", down: "Không hoạt động", unconfigured: "Chưa cấu hình", configured: "Đã cấu hình",
};

export function attentionText(kind: string, count: number) {
  switch (kind) {
    case "locked_accounts": return `${count} tài khoản đang bị khóa`;
    case "hidden_courses": return `${count} khóa học hệ thống đang ẩn (chưa xuất bản)`;
    case "failed_ai_courses": return `${count} lượt tạo khóa học AI thất bại trong 7 ngày`;
    default: return `${count} mục cần xem`;
  }
}

/** "21/11" for a yyyy-mm-dd date, without time-zone shifts. */
export function shortDay(date: string) {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
}
