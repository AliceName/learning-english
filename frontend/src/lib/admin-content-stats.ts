export type CategoryCount = { category: string; count: number };

export type AdminWritingTaskStats = {
  taskId: string; title: string; genre: string; level: string; topic: string; inCatalogue: boolean;
  learners: number; rounds: number; revisedRounds: number; wordsChecked: number; errors: number; errorsPer100Words: number | null;
  relevanceChecked: number; offTopic: number; lastWrittenAt: string | null; topCategories: CategoryCount[];
};
export type AdminWritingTaskReport = {
  countedLearners: number; excludedAccounts: number; submissionsRead: number; catalogueLoaded: boolean;
  tasks: AdminWritingTaskStats[]; categories: CategoryCount[];
};

export type AdminLessonStats = {
  lessonId: number; title: string; skillType: string; orderIndex: number; isActive: boolean;
  learners: number; attempts: number; averageScore: number | null; averageSeconds: number | null; passRate: number | null;
  notStarted: number; currentVersionAttempts: number;
  mostMissed: { questionId: number; prompt: string | null; misses: number; attempts: number }[];
};
export type AdminCourseStats = { courseId: number; title: string; isPublished: boolean; enrolled: number; lessons: AdminLessonStats[] };

/** Below this many learners a rate is shown faded: one or two essays say nothing about a task. */
export const MIN_LEARNERS = 3;

export const lessonSkillLabels: Record<string, string> = {
  reading: "Đọc", grammar: "Ngữ pháp", listening: "Nghe", speaking: "Nói", writing: "Viết",
};

export const levelLabels: Record<string, string> = { Beginner: "Cơ bản", Intermediate: "Trung cấp", Advanced: "Nâng cao" };

export function percent(part: number, whole: number) {
  return whole > 0 ? `${Math.round(part * 100 / whole)}%` : "—";
}

export function duration(seconds: number | null) {
  if (seconds === null) return "—";
  return seconds < 60 ? `${seconds} giây` : `${Math.floor(seconds / 60)} phút ${seconds % 60 ? `${seconds % 60} giây` : ""}`.trim();
}
