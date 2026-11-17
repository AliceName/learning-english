import type { Reading } from "./admin-courses";
import type { ListeningAnswer, ListeningQuestion, ListeningReview } from "./listening";
import type { WritingResult } from "./writing";

export type TextLessonBase = { courseId: number; courseTitle: string; lessonId: number; title: string; difficultyLevel: string | null; contentVersion: string };
export type ReadingLesson = TextLessonBase & {
  passageTitle: string; passage: string; instructions: string; vocabulary: Reading["vocabulary"];
  imageUrl?: string | null; imageAlt?: string; imageCaption?: string; category?: string; estimatedMinutes?: number | null;
  questions: (Omit<ListeningQuestion, "type" | "atSeconds"> & { type: string; focus: string; points: number })[];
  translation: string | null; latestResult: { score: number; correctAnswers: number; totalQuestions: number } | null;
};
export type ReadingResult = { result: { score: number; correctAnswers: number; totalQuestions: number }; review: ListeningReview[]; translation: string };
export type CourseWritingResult = Pick<WritingResult, "submissionId" | "originalText" | "cefrLevel" | "correctedText" | "errors" | "warnings" | "feedback" | "createdAt"> & { sampleAnswer: string };
export type WritingLesson = TextLessonBase & {
  taskType: string; topic: string; prompt: string; instructions: string; minWords: number; maxWords: number;
  rubric: { name: string; description: string; weight: number }[]; latestResult: CourseWritingResult | null;
};
export type ReadingAnswer = ListeningAnswer;
export function readingAnswered(question: ReadingLesson["questions"][number], answer?: ReadingAnswer) {
  if (!answer) return false;
  if (question.options.length > 0) return Number.isInteger(answer.optionIndex) && answer.optionIndex! >= 0 && answer.optionIndex! < question.options.length;
  if (question.type === "matching") return question.matchingLeft.length > 0 && question.matchingLeft.every((_, leftIndex) =>
    answer.matches.some(match => match.leftIndex === leftIndex && question.matchingRight.some(right => right.id === match.rightId)));
  return !!answer.text?.trim();
}
export function textLessonPath(course: number, lesson: number, skill: "reading" | "writing") {
  return `/api/learning/courses/${course}/lessons/${lesson}/${skill}`;
}
export function courseWordCount(text: string) { return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0; }
