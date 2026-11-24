import type { WritingDraft } from "./writing-draft";
import type { WritingEdit } from "./writing-revision";
import type { WritingExplanation, WritingSuggestion } from "./writing";

export const writingReviewTypes = {
  grammar: "Ngữ pháp", vocabulary: "Từ vựng", mechanics: "Chính tả & dấu câu", expression: "Cải thiện diễn đạt", unclassified: "Chưa phân loại",
} as const;
export const writingReviewStatuses = { pending: "Chưa xử lý", accepted: "Đã nhận", selfFixed: "Đã tự sửa", skipped: "Đã bỏ qua" } as const;
export type WritingReviewType = keyof typeof writingReviewTypes;
export type WritingReviewStatus = keyof typeof writingReviewStatuses;
export type WritingReviewDecision = { id: string; status: Exclude<WritingReviewStatus, "pending"> };
export type WritingReviewItem = {
  id: string; suggestionIndex: number; edit: WritingEdit | null; number: string;
  type: WritingReviewType; explanations: WritingExplanation[];
};

const templateVersions = new Set(["vi-edit-templates-v1", "vi-edit-templates-v2"]);
// v1 whitelist categories plus the ERRANT kinds used by vi-edit-templates-v2.
const reviewTypeByCategory: Record<string, WritingReviewType> = {
  ARTICLE: "grammar", "NOUN:NUM": "grammar", "VERB:FORM": "grammar", "VERB:SVA": "grammar", "VERB:TENSE": "grammar",
  "VERB:INFL": "grammar", "NOUN:POSS": "grammar", "NOUN:INFL": "grammar", DET: "grammar", PREP: "grammar", PRON: "grammar",
  CONJ: "grammar", PART: "grammar", "ADJ:FORM": "grammar", MORPH: "grammar", WO: "grammar",
  VERB: "vocabulary", NOUN: "vocabulary", ADJ: "vocabulary", ADV: "vocabulary",
  SPELL: "mechanics", PUNCT: "mechanics", ORTH: "mechanics", CONTR: "mechanics",
};

/** Short Vietnamese names of explanation categories, shown without revealing the answer. */
export const writingCategoryLabels: Record<string, string> = {
  ARTICLE: "Mạo từ", DET: "Mạo từ / từ hạn định", "NOUN:NUM": "Số ít / số nhiều", "NOUN:POSS": "Sở hữu cách",
  "NOUN:INFL": "Dạng số nhiều", "VERB:FORM": "Dạng động từ", "VERB:SVA": "Hòa hợp chủ ngữ – động từ", "VERB:TENSE": "Thì động từ",
  "VERB:INFL": "Chia động từ", PREP: "Giới từ", PRON: "Đại từ", CONJ: "Từ nối", PART: "Tiểu từ", "ADJ:FORM": "So sánh tính từ",
  MORPH: "Loại từ", WO: "Trật tự từ", VERB: "Chọn động từ", NOUN: "Chọn danh từ", ADJ: "Chọn tính từ", ADV: "Chọn trạng từ",
  SPELL: "Chính tả", PUNCT: "Dấu câu", ORTH: "Viết hoa / viết liền", CONTR: "Dạng rút gọn",
};

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
      const type: WritingReviewType = explanations.length === 1 && templateVersions.has(evidence.templateVersion ?? "")
        ? reviewTypeByCategory[evidence.category] ?? "unclassified" : "unclassified";
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
  const selfFixed = entries.filter(item => item.status === "selfFixed").length;
  const reviewed = accepted + skipped + selfFixed;
  const total = entries.length;
  const visible = entries.filter(item => (type === "all" || item.type === type) && (status === "all" || item.status === status));
  return { visible, visibleIds: new Set(visible.map(item => item.id)), total, accepted, skipped, selfFixed, reviewed,
    pending: total - reviewed, percent: total ? reviewed / total * 100 : null };
}

export function restoreWritingReview(draft: WritingDraft, submissionId: number | undefined, items: WritingReviewItem[]) {
  if (!submissionId || draft.baseSubmissionId !== submissionId) return [];
  const itemsById = new Map(items.map(item => [item.id, item]));
  return (draft.review ?? []).filter(decision => {
    const item = itemsById.get(decision.id);
    return item && (decision.status !== "accepted" || item.edit !== null);
  });
}
