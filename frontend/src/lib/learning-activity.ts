import { SESSION_CHANGED } from "./session-events";

export const activityLabels = {
  listening: "Luyện Nghe",
  speaking: "Luyện Nói",
  reading: "Luyện Đọc",
  writing: "Luyện Viết",
  grammar: "Học Ngữ pháp",
  flashcards: "Ôn Flashcards",
  translation: "Luyện phiên dịch",
  vocabulary: "Tra cứu từ vựng",
};

type LearningActivity = keyof typeof activityLabels;
export type LearningInteraction = Exclude<LearningActivity, "translation">;
export type StreakSummary = { currentStreak: number; longestStreak: number; studiedToday: boolean };
export type LearningCalendar = {
  year: number;
  today: string;
  firstDay: string;
  streak: StreakSummary;
  days: { date: string; activities: LearningActivity[] }[];
};

export const LEARNING_ACTIVITY_CHANGED = "linguaai:learning-activity";
export const VIETNAM_OFFSET = 7 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function notifyLearningActivity() {
  window.dispatchEvent(new Event(LEARNING_ACTIVITY_CHANGED));
}

const pending = new Map<LearningInteraction, Promise<boolean>>();
const recorded = new Set<LearningInteraction>();
let recordedDay: number | undefined;

if (typeof window !== "undefined") {
  window.addEventListener(SESSION_CHANGED, () => { recorded.clear(); pending.clear(); });
  window.addEventListener("focus", () => recorded.clear());
}

export function recordLearningInteraction(kind: LearningInteraction) {
  const day = Math.floor((Date.now() + VIETNAM_OFFSET) / DAY_MS);
  if (recordedDay !== day) {
    recordedDay = day;
    recorded.clear();
    pending.clear();
  }
  if (recorded.has(kind)) return Promise.resolve(true);
  const current = pending.get(kind);
  if (current) return current;
  const saving = fetch(`/api/learning-activity?kind=${kind}`, {
    method: "POST", keepalive: true, cache: "no-store", signal: AbortSignal.timeout(12_000),
  }).then(response => {
    if (response.ok && pending.get(kind) === saving) {
      recorded.add(kind);
      notifyLearningActivity();
    }
    return response.ok;
  }).catch(() => false).finally(() => {
    if (pending.get(kind) === saving) pending.delete(kind);
  });
  pending.set(kind, saving);
  return saving;
}
