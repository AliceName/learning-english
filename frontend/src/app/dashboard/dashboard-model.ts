import type { Deck } from "@/lib/flashcards";
import { DAY_MS, VIETNAM_OFFSET, type LearningCalendar } from "@/lib/learning-activity";
import type { SiteIconName } from "@/components/site-icon";
import type { NextStep } from "@/lib/writing-practice";
import type { WritingData } from "./use-dashboard-data";

const weekdays = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export type PlanItem = { key: string; icon: SiteIconName; title: string; detail: string; href: string; cta: string };
export type Day = { date: string; label: string; today: boolean; activities: LearningCalendar["days"][number]["activities"] };

export function greetingNow() {
  const hour = new Date(Date.now() + VIETNAM_OFFSET).getUTCHours();
  return hour < 11 ? "Chào buổi sáng" : hour < 18 ? "Chào buổi chiều" : "Chào buổi tối";
}

/** The last seven days (Vietnam time) ending today, with the activities recorded on each. */
export function lastSevenDays(calendar: LearningCalendar): Day[] {
  const byDate = new Map(calendar.days.map(day => [day.date, day.activities]));
  const today = Date.parse(`${calendar.today}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const time = today - (6 - index) * DAY_MS;
    const date = new Date(time).toISOString().slice(0, 10);
    return { date, today: index === 6, label: weekdays[new Date(time).getUTCDay()], activities: byDate.get(date) ?? [] };
  });
}

/**
 * Sentences with suggestions in the latest round, first version → latest version. Both versions are the
 * same essay, so a drop reflects the learner's revisions, unlike CEFR, which moves with each task.
 */
export function revisionChange(writing: WritingData): { value: string; unit: string; note: string } {
  const round = writing.rounds[0];
  const first = writing.firstVersion, latest = writing.latest;
  if (!round) return { value: "—", unit: "", note: "Nộp bài đầu tiên để bắt đầu" };
  if (!latest || !first) return { value: "—", unit: "", note: "Chưa tải được chi tiết bài" };
  if (latest.correctedText === null || first.correctedText === null)
    return { value: "—", unit: "", note: "Bài nộp không bật gợi ý sửa lỗi" };
  if (round.submissionCount < 2 || first.submissionId === latest.submissionId)
    return { value: String(latest.errors.length), unit: " câu cần xem", note: "Nộp bản sửa để thấy số này giảm" };
  const before = first.errors.length, after = latest.errors.length;
  return { value: `${before} → ${after}`, unit: " câu", note: after < before ? `Bớt ${before - after} câu có gợi ý sau ${round.submissionCount} bản`
    : after === before ? `Chưa giảm sau ${round.submissionCount} bản` : `Tăng ${after - before} câu ở bản mới; bài dài hơn cũng có thể có thêm gợi ý` };
}

/**
 * Up to three things to do today, most useful first. Built only from recorded data:
 * cards due, the latest essay's next steps, and whether the learner wrote recently.
 */
export function todayPlan(decks: Deck[] | null, writing: WritingData | null, steps: NextStep[], now = Date.now()): PlanItem[] {
  const plan: PlanItem[] = [];
  const due = decks?.reduce((sum, deck) => sum + deck.dueCount, 0) ?? 0;
  if (due > 0) plan.push({ key: "cards", icon: "cards", title: `Ôn ${due} thẻ đến lịch`, href: "/flashcards", cta: "Ôn ngay",
    detail: "Ôn đúng hạn giúp nhớ lâu hơn học dồn." });
  const round = writing?.rounds[0];
  if (round && steps.length > 0) plan.push({ key: "revise", icon: "writing", href: `/writing?submissionId=${round.latestSubmissionId}`, cta: "Sửa tiếp",
    title: `Sửa tiếp bài “${writing?.latest?.task?.title ?? round.topic ?? `Lượt #${round.practiceRootId}`}”`, detail: `Bắt đầu với: ${steps[0].title.toLowerCase()}.` });
  const wroteThisWeek = round ? now - Date.parse(round.createdAt) < 7 * DAY_MS : false;
  if (!wroteThisWeek) plan.push({ key: "write", icon: "writing", href: "/writing", cta: "Chọn đề",
    title: round ? "Viết một bài mới" : "Viết bài đầu tiên", detail: round ? "Tuần này bạn chưa có lượt luyện viết nào." : "Chọn một đề trong thư viện và nhận gợi ý sửa lỗi." });
  if (decks && !decks.some(deck => deck.canEdit && !deck.isAdminDeck)) plan.push({ key: "deck", icon: "plus", href: "/flashcards", cta: "Tạo bộ thẻ",
    title: "Tạo bộ thẻ đầu tiên", detail: "Lưu từ mới từ bài viết vào bộ thẻ để ôn lại." });
  return plan.slice(0, 3);
}
