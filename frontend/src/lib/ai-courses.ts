import type { Grammar, Listening, Reading, Speaking, Writing, Skill } from "./admin-courses";

export type AiConfig = {
  goal: string; difficultyLevel: string; lessonCount: number; questionsPerLesson: number;
  targetAudioSeconds: number; voice: string;
  skills: Skill[];
};
export type AiQuestion = {
  type: string; prompt: string; options: string[]; correctOptionIndex: number | null;
  answer: string | null; explanation: string;
};
export type AiLesson = {
  id: string; title: string; objective: string; skillType: Skill; audioUrl: string | null; audioSeconds: number | null;
  listening: Listening | null; speaking: Speaking | null; reading: Reading | null; writing: Writing | null; grammar: Grammar | null;
};
export type AiJob = {
  id: string; status: string; fileName: string; config: AiConfig; createdAt: string;
  outlineRevision: number; courseId: number | null; courseUrl: string | null; coverImageUrl: string;
  completedLessons: number; totalLessons: number; nextAttemptAt: string | null;
  error: { code: string; message: string } | null;
  outline: { summary: string; title: string; description: string; lessons: AiLesson[] } | null;
};
export const aiStatus: Record<string, string> = {
  queued: "Chờ xử lý", planning: "Đang tạo dàn ý", awaiting_outline: "Chờ duyệt dàn ý",
  generating: "Đang soạn nội dung bài học", generating_audio: "Đang tạo audio Listening",
  awaiting_review: "Sẵn sàng xem trước", completed: "Đã lưu khóa học", failed: "Cần thử lại",
};
export async function aiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để tiếp tục." : data?.title ?? "Chưa thực hiện được yêu cầu. Hãy thử lại.");
  return data as T;
}
export function aiJson(method: string, body?: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
}
