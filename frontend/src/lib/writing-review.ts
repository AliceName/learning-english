import type { WritingDraft } from "./writing-draft";
import type { WritingEdit } from "./writing-revision";
import type { WritingExplanation, WritingSuggestion } from "./writing";

export const writingReviewTypes = {
  grammar: "Ngữ pháp", vocabulary: "Từ vựng", expression: "Cải thiện diễn đạt", unclassified: "Chưa phân loại",
} as const;
export const writingReviewStatuses = { pending: "Chưa xử lý", accepted: "Đã nhận", skipped: "Đã bỏ qua" } as const;
export type WritingReviewType = keyof typeof writingReviewTypes;
export type WritingReviewStatus = keyof typeof writingReviewStatuses;
export type WritingReviewDecision = { id: string; status: Exclude<WritingReviewStatus, "pending"> };
export type WritingReviewItem = {
  id: string; suggestionIndex: number; edit: WritingEdit | null; number: string;
  type: WritingReviewType; explanations: WritingExplanation[];
};

const grammarCategories = new Set(["ARTICLE", "NOUN:NUM", "VERB:FORM", "VERB:SVA"]);

export function writingReviewItems(suggestions: WritingSuggestion[], edits: WritingEdit[]): WritingReviewItem[] {
  return suggestions.flatMap<WritingReviewItem>((suggestion, suggestionIndex) => {
    const changes = edits.filter(edit => edit.suggestionIndex === suggestionIndex);
    if (!changes.length) return [{
      id: `${suggestionIndex}:unmapped`, suggestionIndex, edit: null,
      number: String(suggestionIndex + 1), type: "unclassified", explanations: suggestion.explanations ?? [],
    }];
    return changes.map((edit, index) => {
      const before = edit.before.trim(), after = edit.after.trim();
      const explanations = changes.filter(change => change.before.trim() === before && change.after.trim() === after).length === 1
        ? (suggestion.explanations ?? []).filter(explanation => explanation.original === before && explanation.suggestion === after)
        : [];
      const evidence = explanations[0];
      const type = explanations.length === 1 && evidence.templateVersion === "vi-edit-templates-v1"
        && grammarCategories.has(evidence.category) ? "grammar" : "unclassified";
      return { id: edit.id, suggestionIndex, edit, number: `${suggestionIndex + 1}.${index + 1}`, type, explanations };
    });
  });
}

export function writingReviewView(items: WritingReviewItem[], decisions: WritingReviewDecision[],
  type: WritingReviewType | "all", status: WritingReviewStatus | "all") {
  const statuses = new Map(decisions.map(decision => [decision.id, decision.status]));
  const entries = items.map(item => ({ ...item, status: statuses.get(item.id) ?? "pending" as const }));
  const accepted = entries.filter(item => item.status === "accepted").length;
  const skipped = entries.filter(item => item.status === "skipped").length;
  const total = entries.length;
  const visible = entries.filter(item => (type === "all" || item.type === type) && (status === "all" || item.status === status));
  return { visible, visibleIds: new Set(visible.map(item => item.id)), total, accepted, skipped, pending: total - accepted - skipped,
    percent: total ? (accepted + skipped) / total * 100 : null };
}

export function restoreWritingReview(draft: WritingDraft, submissionId: number | undefined, items: WritingReviewItem[]) {
  if (!submissionId || draft.baseSubmissionId !== submissionId) return [];
  const itemsById = new Map(items.map(item => [item.id, item]));
  return (draft.review ?? []).filter(decision => {
    const item = itemsById.get(decision.id);
    return item && (decision.status === "skipped" || item.edit !== null);
  });
}
