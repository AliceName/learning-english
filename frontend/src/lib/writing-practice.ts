// Learner-facing feedback policy for the writing practice loop (P0, no model change).
// Ideas follow Write & Improve's published approach: a few items per round, indirect
// feedback first, and an explicit "no more suggestions" state. See
// reports/thiet-ke-lewa-writing-cho-nguoi-hoc-2026-11-20.md.

export const WRITING_PRACTICE_POLICY = "writing-practice-p0-v1";

const cefrOrder = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** At most this many undecided suggestions are shown at once. Beginners see fewer. */
export function revealLimit(level: string | null | undefined): number {
  return level === "Beginner" ? 3 : 5;
}

type ReviewEntry = { id: string; status: "pending" | "accepted" | "skipped" | "selfFixed" };

/**
 * Suggestions with a rule-based explanation ("grammar") come first; the rest keep text order.
 * Observed on 2 local test essays (not a measurement): the rule templates cover few edits, so many correct fixes
 * (e.g. "are" -> "is") are unclassified too. The label therefore says "no rule explanation",
 * not "AI is unsure".
 * This is a proxy for reliability, not a measured confidence: GEC still over-corrects
 * (e.g. "last" -> "Last") and only the rule templates give evidence for a change.
 */
export function practiceOrder<T extends { type: string }>(entries: readonly T[]): T[] {
  return [...entries.filter(item => item.type === "grammar"), ...entries.filter(item => item.type !== "grammar")];
}

/** Ask the learner to self-fix first only when a rule explains the change. */
export function hideAnswerFirst(type: string): boolean {
  return type === "grammar";
}

/**
 * Keep every decided item and only the first `limit` undecided ones, in their original
 * (text) order. Deciding one item reveals the next. `showAll` turns the limit off.
 */
export function progressiveReview<T extends ReviewEntry>(entries: readonly T[], limit: number, showAll: boolean) {
  if (showAll) return { shown: [...entries], hidden: 0 };
  let pending = 0;
  const shown = entries.filter(item => item.status !== "pending" || ++pending <= limit);
  return { shown, hidden: entries.length - shown.length };
}

/** True once a corrections run has no undecided suggestion left (including "none returned"). */
export function reviewExhausted(correctionsRun: boolean, pending: number): boolean {
  return correctionsRun && pending === 0;
}

export const revisionChecklist = [
  "Đọc to từng câu: mỗi câu có chủ ngữ và động từ chưa?",
  "Hòa hợp chủ ngữ – động từ: he/she/it + động từ thêm -s ở hiện tại đơn; we/they/I không thêm.",
  "Thì của động từ có nhất quán không? Kể chuyện đã xảy ra thì dùng quá khứ.",
  "Mạo từ a/an/the và danh từ số nhiều (two books, many people).",
  "Giới từ chỉ thời gian, nơi chốn: in/on/at.",
  "Chính tả: tra từ điển với từ bạn chưa chắc.",
  "Viết hoa đầu câu, tên riêng; dấu chấm, dấu phẩy đúng chỗ.",
  "Đối chiếu lại checklist yêu cầu đề: đã trả lời đủ mọi ý chưa?",
] as const;

type ProgressInput = {
  submissionId: number; cefrLevel: string; correctedText: string | null; errors: readonly unknown[];
  originalText: string; versionNumber?: number | null;
  provenance?: { cefrRun: string | null; gecRun: string | null } | null;
};

export type VersionProgress = {
  cefr: "up" | "same" | "down" | "unknown"; from: string; to: string;
  suggestions: { before: number; after: number } | null; wordsBefore: number; wordsAfter: number;
  headline: string; caveats: string[];
};

const wordCount = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0;

/** Rule-based, honest comparison of a saved version with the version it came from. */
export function versionProgress(previous: ProgressInput, current: ProgressInput): VersionProgress {
  const a = cefrOrder.indexOf(previous.cefrLevel as typeof cefrOrder[number]);
  const b = cefrOrder.indexOf(current.cefrLevel as typeof cefrOrder[number]);
  const sameCefrModel = (previous.provenance?.cefrRun ?? null) === (current.provenance?.cefrRun ?? null);
  const cefr = a < 0 || b < 0 || !sameCefrModel ? "unknown" : b > a ? "up" : b < a ? "down" : "same";
  const bothCorrected = previous.correctedText !== null && current.correctedText !== null;
  const sameGecModel = (previous.provenance?.gecRun ?? null) === (current.provenance?.gecRun ?? null);
  const suggestions = bothCorrected && sameGecModel ? { before: previous.errors.length, after: current.errors.length } : null;
  const caveats: string[] = [];
  if (!sameCefrModel) caveats.push("Hai phiên bản được chấm bằng mô hình CEFR khác nhau nên không so trực tiếp mức CEFR.");
  if (bothCorrected && !sameGecModel) caveats.push("Hai phiên bản dùng mô hình gợi ý sửa lỗi khác nhau nên không so số gợi ý.");
  if (!bothCorrected) caveats.push("Một trong hai lần nộp không bật gợi ý sửa lỗi nên không so số gợi ý.");
  caveats.push("AI có thể bỏ sót lỗi: ít gợi ý hơn chưa chắc nghĩa là bài tốt hơn.");

  let headline: string;
  if (cefr === "up") headline = `Tốt lắm! Mức CEFR ước lượng tăng từ ${previous.cefrLevel} lên ${current.cefrLevel}.`;
  else if (suggestions && suggestions.after < suggestions.before)
    headline = `Bạn đã sửa được bài: số câu AI còn gợi ý giảm từ ${suggestions.before} xuống ${suggestions.after}.`;
  else if (cefr === "same") headline = `Mức CEFR ước lượng giữ ở ${current.cefrLevel}. Sửa vài lỗi thường chưa làm đổi bậc CEFR — tiến bộ đến từng bước nhỏ.`;
  else if (cefr === "down") headline = `Mức CEFR ước lượng là ${current.cefrLevel} (lần trước ${previous.cefrLevel}). Hãy xem lại các câu đã thay đổi.`;
  else headline = "Đã lưu phiên bản mới. Hãy so sánh thay đổi bên dưới.";
  return { cefr, from: previous.cefrLevel, to: current.cefrLevel, suggestions,
    wordsBefore: wordCount(previous.originalText), wordsAfter: wordCount(current.originalText), headline, caveats };
}

export type CefrPoint = { submissionId: number; label: string; level: string; index: number };

/** Discrete CEFR steps of one practice round, oldest first; unknown levels are skipped. */
export function cefrSeries(items: readonly { submissionId: number; cefrLevel: string; versionNumber?: number | null }[]): CefrPoint[] {
  return [...items]
    .sort((x, y) => (x.versionNumber ?? 0) - (y.versionNumber ?? 0) || x.submissionId - y.submissionId)
    .flatMap(item => {
      const index = cefrOrder.indexOf(item.cefrLevel as typeof cefrOrder[number]);
      return index < 0 ? [] : [{ submissionId: item.submissionId, level: item.cefrLevel, index,
        label: item.versionNumber ? `PB ${item.versionNumber}` : `#${item.submissionId}` }];
    });
}

export const cefrLevels = cefrOrder;

/**
 * Once the learner edits the draft by hand, saved edit offsets no longer match it.
 * Find the suggestion's original sentence again (the occurrence nearest its old offset);
 * null when the sentence was already rewritten.
 */
export function locateSentence(draft: string, sentence: string, near: number): { start: number; end: number } | null {
  const needle = sentence.trim();
  if (!needle) return null;
  let best: number | null = null;
  for (let at = draft.indexOf(needle); at >= 0; at = draft.indexOf(needle, at + 1)) {
    if (best === null || Math.abs(at - near) < Math.abs(best - near)) best = at;
  }
  return best === null ? null : { start: best, end: best + needle.length };
}

/**
 * Library prompts arrive as one line with inline "*" bullets. Split them so a beginner sees
 * each point to answer. A closing instruction after the last bullet ("Write about 30 words.")
 * is kept apart when it follows a sentence end and a wide gap.
 */
export function taskPromptParts(prompt: string): { intro: string; bullets: string[]; outro: string } {
  const squash = (text: string) => text.replace(/\s+/gu, " ").trim();
  const [head, ...items] = prompt.split(/(?:^|\s)\*\s+/u);
  if (!items.length) return { intro: squash(prompt), bullets: [], outro: "" };
  let outro = "";
  const last = items[items.length - 1].match(/^([\s\S]*?[.!?])\s{2,}(\S[\s\S]*)$/u)
    ?? items[items.length - 1].match(/^([\s\S]*?[.!?])\s+(Write\b[\s\S]*)$/u);
  if (last) { items[items.length - 1] = last[1]; outro = squash(last[2]); }
  return { intro: squash(head), bullets: items.map(squash).filter(Boolean), outro };
}


const taskCeiling: Record<string, number> = { Beginner: 1, Intermediate: 3, Advanced: 5 };

/** True when the profile target is above the CEFR band a task of this level can show. */
export function targetAboveTask(taskLevel: string, target: string | null | undefined): boolean {
  const ceiling = taskCeiling[taskLevel];
  const wanted = cefrOrder.indexOf(target as typeof cefrOrder[number]);
  return ceiling !== undefined && wanted > ceiling;
}
