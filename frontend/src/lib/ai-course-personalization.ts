import type { AiConfig } from "./ai-courses";
import { authoringSkills } from "./admin-courses";

export const learningGoals = [
  { id: "document", title: "Học sâu tài liệu", description: "Hiểu nội dung, vững cả 5 kỹ năng", icon: "book", skills: ["speaking", "listening", "reading", "writing", "grammar"], goal: "Phát triển các kỹ năng tiếng Anh theo chủ đề trong tài liệu" },
  { id: "daily", title: "Giao tiếp hằng ngày", description: "Nghe chủ động, nói tự tin hơn", icon: "users", skills: ["speaking", "listening"], goal: "Tự tin giao tiếp tiếng Anh trong cuộc sống hằng ngày, sử dụng từ vựng và tình huống từ tài liệu." },
  { id: "work", title: "Tiếng Anh công việc", description: "Họp, trao đổi và viết email", icon: "briefcase", skills: ["speaking", "reading", "writing"], goal: "Sử dụng tiếng Anh hiệu quả trong công việc, cuộc họp và email dựa trên nội dung tài liệu." },
  { id: "study", title: "Học thuật & luyện thi", description: "Đọc sâu, viết rõ, chắc nền tảng", icon: "writing", skills: ["listening", "reading", "writing", "grammar"], goal: "Củng cố từ vựng, đọc hiểu và các kỹ năng tiếng Anh cho học thuật và luyện thi theo nội dung tài liệu." },
] as const;

export const courseLevels = [
  { value: "A1", label: "Bắt đầu" }, { value: "A2", label: "Nền tảng" }, { value: "B1", label: "Trung cấp" },
  { value: "B2", label: "Khá" }, { value: "C1", label: "Nâng cao" }, { value: "C2", label: "Thành thạo" },
] as const;

export function personalizedAiConfig(targetLevel?: string | null): AiConfig {
  return { goal: learningGoals[0].goal, difficultyLevel: courseLevels.some(level => level.value === targetLevel) ? targetLevel! : "B1",
    skills: [...authoringSkills], lessonCount: 1, questionsPerLesson: 3, targetAudioSeconds: 60, voice: "Kore" };
}

export function aiConfigForGoal(config: AiConfig, goalId: string): AiConfig {
  const preset = learningGoals.find(item => item.id === goalId);
  return preset ? { ...config, goal: preset.goal, skills: authoringSkills.filter(skill => preset.skills.some(value => value === skill)) } : config;
}

export function courseFileError(file: Pick<File, "name" | "size">): string | null {
  if (!/\.(pdf|docx)$/i.test(file.name)) return "Chọn tài liệu PDF hoặc DOCX để tạo khóa học.";
  if (file.size === 0) return "Tài liệu đang trống. Hãy chọn một tệp có nội dung.";
  return file.size > 10 * 1024 * 1024 ? "Tài liệu tối đa 10 MB. Hãy chọn tệp nhỏ hơn." : null;
}
