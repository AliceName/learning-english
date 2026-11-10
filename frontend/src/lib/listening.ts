export type ListeningQuestion = {
  questionId: number; type: "multiple_choice" | "fill_blank" | "matching"; prompt: string;
  options: string[]; matchingLeft: string[]; matchingRight: { id: string; text: string }[]; atSeconds: number | null;
};
export type ListeningAnswer = { questionId: number; optionIndex?: number; text?: string; matches: { leftIndex: number; rightId: string }[] };
export type ListeningSummary = { resultId: number; score: number; totalQuestions: number; correctAnswers: number; timeSpentSeconds: number | null; submittedAt: string };
export type ListeningProgress = { completedLessons: number; totalLessons: number; percent: number };
export type ListeningLesson = {
  courseId: number; courseTitle: string; lessonId: number; title: string; difficultyLevel: string | null; estimatedMinutes: number | null;
  audioUrl: string; contentVersion: string; hideTranscriptFirstListen: boolean; questions: ListeningQuestion[]; positionSeconds: number;
  attemptCount: number; latestResult: ListeningSummary | null; progress: ListeningProgress;
  lessons: { lessonId: number; title: string; completed: boolean }[];
};
export type ListeningReview = {
  questionId: number; type: string; prompt: string; correct: boolean; submittedAnswer: string | null;
  correctAnswer: string; explanation: string | null; atSeconds: number | null;
  pairs: { left: string; submittedAnswer: string | null; correctAnswer: string; correct: boolean }[];
};
export type ListeningResult = { result: ListeningSummary; fullReview: boolean; review: ListeningReview[]; progress: ListeningProgress };
export type ListeningHistory = { items: ListeningSummary[]; totalCount: number; page: number; pageSize: number; totalPages: number };

export class ListeningRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export function listeningPath(courseId: number, lessonId: number) { return `courses/${courseId}/lessons/${lessonId}/listening`; }
export function listeningHref(courseId: number, lessonId: number) { return `/courses/${courseId}/lessons/${lessonId}/listening`; }
export function listeningLoginHref(courseId: number, lessonId: number) {
  return `/login?next=${encodeURIComponent(listeningHref(courseId, lessonId))}`;
}
export async function listeningRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/learning/${path}`, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ListeningRequestError(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
    : Object.values(body.errors ?? {}).flat().join(" ") || body.title || "Chưa thể xử lý bài nghe. Vui lòng thử lại.", response.status);
  return body as T;
}
export function isAnswered(question: ListeningQuestion, answer?: ListeningAnswer) {
  if (!answer) return false;
  if (question.type === "multiple_choice") return answer.optionIndex !== undefined;
  if (question.type === "fill_blank") return !!answer.text?.trim();
  return question.matchingLeft.every((_, index) => answer.matches.some(match => match.leftIndex === index && match.rightId));
}
export function audioTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
