export type GrammarQuestion = {
  questionId: number; type: "multiple_choice" | "fill_blank" | "error_correction";
  prompt: string; options: string[]; tag: string | null;
};
export type GrammarAnswer = { questionId: number; optionIndex?: number; text?: string };
export type GrammarSummary = {
  resultId: number; score: number; totalQuestions: number; correctAnswers: number;
  timeSpentSeconds: number | null; submittedAt: string;
};
export type GrammarLesson = {
  courseId: number; courseTitle: string; lessonId: number; title: string;
  difficultyLevel: string | null; estimatedMinutes: number | null; contentVersion: string;
  topic: string; rules: string; commonMistakes: string; questions: GrammarQuestion[];
  latestResult: GrammarSummary | null; lessons: { lessonId: number; title: string }[];
};
export type GrammarReview = {
  questionId: number; correct: boolean; submittedAnswer: string | null; correctAnswer: string;
  correctOptionIndex: number | null; correction: string | null; explanation: string | null;
};
export type GrammarResult = { result: GrammarSummary; review: GrammarReview[] };
export type GrammarDraft = { answers: Record<number, GrammarAnswer>; current: number; elapsed: number; notes: string };

export const grammarPath = (courseId: number, lessonId: number) => `courses/${courseId}/lessons/${lessonId}/grammar`;
export const grammarHref = (courseId: number, lessonId: number) => `/${grammarPath(courseId, lessonId)}`;
export const grammarLoginHref = (courseId: number, lessonId: number) => `/login?next=${encodeURIComponent(grammarHref(courseId, lessonId))}`;
export const grammarDraftKey = (userId: number, lesson: GrammarLesson) =>
  `lewa:grammar:v1:${userId}:${lesson.courseId}:${lesson.lessonId}:${lesson.contentVersion}`;
export function grammarAnswered(question: GrammarQuestion, answer?: GrammarAnswer) {
  if (question.type === "fill_blank") return !!answer?.text?.trim();
  return Number.isInteger(answer?.optionIndex) && answer!.optionIndex! >= 0 && answer!.optionIndex! < question.options.length;
}
export function grammarTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

// Drafts are untrusted device data; accept only answers belonging to the current lesson version.
export function parseGrammarDraft(raw: string | null, lesson: GrammarLesson): GrammarDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || !value.answers || typeof value.answers !== "object" || Array.isArray(value.answers) ||
      !Number.isInteger(value.current) || value.current < 0 || value.current >= lesson.questions.length ||
      !Number.isInteger(value.elapsed) || value.elapsed < 0 || value.elapsed > 86400 ||
      typeof value.notes !== "string" || value.notes.length > 5000) return null;
    const answers: Record<number, GrammarAnswer> = {};
    for (const question of lesson.questions) {
      const answer = value.answers[question.questionId];
      if (!answer || answer.questionId !== question.questionId) continue;
      if (question.type === "fill_blank" && typeof answer.text === "string" && answer.text.length <= 500)
        answers[question.questionId] = { questionId: question.questionId, text: answer.text };
      else if (question.type !== "fill_blank" && grammarAnswered(question, answer))
        answers[question.questionId] = { questionId: question.questionId, optionIndex: answer.optionIndex };
    }
    return { answers, current: value.current, elapsed: value.elapsed, notes: value.notes };
  } catch { return null; }
}

export class GrammarRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function submitGrammar(lesson: GrammarLesson, answers: GrammarAnswer[], elapsed: number, signal: AbortSignal): Promise<GrammarResult> {
  const response = await fetch(`/api/learning/${grammarPath(lesson.courseId, lesson.lessonId)}/submissions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal,
    body: JSON.stringify({ contentVersion: lesson.contentVersion, answers, timeSpentSeconds: elapsed }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new GrammarRequestError(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
    : Object.values(body.errors ?? {}).flat().join(" ") || body.title || "Chưa thể nộp bài. Vui lòng thử lại.", response.status);
  return body as GrammarResult;
}
