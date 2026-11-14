import type { PublicUser } from "./server-auth";
import { isProfileAvatar } from "./profile-avatar";

export const levels = [
  ["A1", "Sơ cấp"], ["A2", "Cơ bản"], ["B1", "Trung cấp"],
  ["B2", "Trung cao cấp"], ["C1", "Nâng cao"], ["C2", "Chuyên sâu"],
] as const;
export const purposes = [["communication", "Giao tiếp hằng ngày"], ["work", "Công việc"], ["study", "Học tập"], ["exam", "Thi chứng chỉ"]] as const;
export const skills = [["speaking", "Speaking — Luyện nói"], ["listening", "Listening — Luyện nghe"], ["writing", "Writing — Luyện viết"], ["reading", "Reading — Đọc hiểu"], ["grammar", "Grammar — Ngữ pháp"]] as const;
export type ProfileDraft = {
  fullName: string; targetLevel: string; avatarUrl: string | null;
  phoneNumber: string; dateOfBirth: string; address: string;
  learningPurpose: string; preferredSkill: string; dailyGoalMinutes: string;
};
export type ProfileErrors = Record<string, string[]>;

export function profileDraft(user: PublicUser): ProfileDraft {
  return {
    fullName: user.fullName, targetLevel: user.targetLevel ?? "",
    avatarUrl: isProfileAvatar(user.avatarUrl) ? user.avatarUrl! : null,
    phoneNumber: user.personalDetails?.phoneNumber ?? "", dateOfBirth: user.personalDetails?.dateOfBirth ?? "",
    address: user.personalDetails?.address ?? "", learningPurpose: user.learningPreferences?.learningPurpose ?? "",
    preferredSkill: user.learningPreferences?.preferredSkill ?? "",
    dailyGoalMinutes: user.learningPreferences?.dailyGoalMinutes?.toString() ?? "",
  };
}
export function profilePayload(draft: ProfileDraft) {
  const clean = (value: string) => value.trim() || null;
  return { fullName: draft.fullName.trim(), targetLevel: clean(draft.targetLevel), avatarUrl: draft.avatarUrl,
    personalDetails: { phoneNumber: clean(draft.phoneNumber), dateOfBirth: clean(draft.dateOfBirth), address: clean(draft.address) },
    learningPreferences: { learningPurpose: clean(draft.learningPurpose), preferredSkill: clean(draft.preferredSkill),
      dailyGoalMinutes: draft.dailyGoalMinutes ? Number(draft.dailyGoalMinutes) : null },
  };
}
export function localToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function validateProfile(draft: ProfileDraft, today = localToday()): ProfileErrors {
  const errors: ProfileErrors = {};
  const control = /[\u0000-\u001f\u007f-\u009f]/;
  if (!draft.fullName.trim() || draft.fullName.trim().length > 150 || control.test(draft.fullName)) errors.FullName = ["Nhập họ và tên hợp lệ, tối đa 150 ký tự."];
  if (draft.targetLevel && !levels.some(([value]) => value === draft.targetLevel)) errors.TargetLevel = ["Chọn mục tiêu từ A1 đến C2."];
  if (draft.avatarUrl !== null && !isProfileAvatar(draft.avatarUrl)) errors.AvatarUrl = ["Chọn ảnh đại diện trong danh sách."];
  const phone = draft.phoneNumber.trim();
  if (phone && (phone.length > 25 || !/^\+?[0-9 ()-]+$/.test(phone) || !/^\+?[0-9]{8,15}$/.test(phone.replace(/[ ()-]/g, "")))) errors["PersonalDetails.PhoneNumber"] = ["Nhập số điện thoại gồm 8–15 chữ số, có thể bắt đầu bằng +."];
  const birth = draft.dateOfBirth;
  if (birth && (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || Number.isNaN(Date.parse(birth)) || new Date(birth).toISOString().slice(0, 10) !== birth || birth < "1900-01-01" || birth > today)) errors["PersonalDetails.DateOfBirth"] = ["Ngày sinh phải từ năm 1900 đến hôm nay."];
  if (draft.address.trim().length > 500 || control.test(draft.address)) errors["PersonalDetails.Address"] = ["Nhập địa chỉ hợp lệ, tối đa 500 ký tự."];
  if (draft.learningPurpose && !purposes.some(([value]) => value === draft.learningPurpose)) errors["LearningPreferences.LearningPurpose"] = ["Chọn mục đích học trong danh sách."];
  if (draft.preferredSkill && !skills.some(([value]) => value === draft.preferredSkill)) errors["LearningPreferences.PreferredSkill"] = ["Chọn kỹ năng trong danh sách."];
  const minutes = Number(draft.dailyGoalMinutes);
  if (draft.dailyGoalMinutes && (!Number.isInteger(minutes) || minutes < 5 || minutes > 180)) errors["LearningPreferences.DailyGoalMinutes"] = ["Mục tiêu mỗi ngày từ 5 đến 180 phút."];
  return errors;
}
export function optionLabel(options: readonly (readonly [string, string])[], value: string) {
  return options.find(([key]) => key === value)?.[1] ?? "Chưa chọn";
}
