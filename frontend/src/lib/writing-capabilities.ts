export type WritingCapabilities = {
  status: "ready" | "unavailable";
  busy: boolean;
  correctionsEnabled: boolean;
  feedbackEnabled: boolean;
  feedbackStatus: "enabled" | "disabled" | "unavailable";
  cefrLimit: number | null;
  gecInputLimit: number | null;
  gecSentenceLimit: number | null;
};

export type WritingPreflight = {
  inputAssessment?: { status: "eligible" | "insufficient"; reasons: string[]; warnings: string[]; policyVersion: string } | null;
  cefrTokens: number;
  cefrLimit: number;
  canAnalyze: boolean;
  correctionsEnabled: boolean;
  gecInputLimit: number | null;
  gecSentenceLimit: number;
  sentences: { index: number; start: number; end: number; tokens: number;
    status: "ready" | "inputOverBudget" | "sentenceLimit" }[];
};

export type WritingHistory = {
  items: { submissionId: number; topic: string | null; cefrLevel: string; createdAt: string; preview: string }[];
  nextBeforeId: number | null;
};

export type WritingPractices = { items: { practiceRootId: number; latestSubmissionId: number; submissionCount: number;
  topic: string | null; cefrLevel: string; createdAt: string }[]; nextBeforeId: number | null };
export function isWritingPractices(value: unknown): value is WritingPractices {
  if (!value || typeof value !== "object") return false;
  const p = value as WritingPractices;
  let before = Infinity;
  return Array.isArray(p.items) && p.items.length <= 20 && p.items.every(i => {
    const valid = i && Number.isInteger(i.practiceRootId) && i.practiceRootId > 0
      && Number.isInteger(i.latestSubmissionId) && i.latestSubmissionId >= i.practiceRootId && i.latestSubmissionId <= 2147483647
      && i.latestSubmissionId < before && Number.isInteger(i.submissionCount) && i.submissionCount > 0
      && (i.topic === null || typeof i.topic === "string" && i.topic.length <= 500)
      && ["A1", "A2", "B1", "B2", "C1", "C2", ""].includes(i.cefrLevel) && typeof i.createdAt === "string" && Number.isFinite(Date.parse(i.createdAt));
    before = i?.latestSubmissionId; return valid;
  }) && new Set(p.items.map(i => i.practiceRootId)).size === p.items.length
    && (p.nextBeforeId === null || p.items.length > 0 && p.nextBeforeId === p.items[p.items.length - 1].latestSubmissionId);
}

const integer = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object";

export function isWritingCapabilities(value: unknown): value is WritingCapabilities {
  if (!record(value) || (value.status !== "ready" && value.status !== "unavailable")
    || typeof value.busy !== "boolean" || typeof value.correctionsEnabled !== "boolean" || typeof value.feedbackEnabled !== "boolean"
    || (value.feedbackStatus !== "enabled" && value.feedbackStatus !== "disabled" && value.feedbackStatus !== "unavailable")
    || value.feedbackEnabled !== (value.feedbackStatus === "enabled")) return false;
  if (value.status === "unavailable") return value.feedbackStatus === "unavailable" && !value.busy && !value.correctionsEnabled && !value.feedbackEnabled
    && value.cefrLimit === null && value.gecInputLimit === null && value.gecSentenceLimit === null;
  return integer(value.cefrLimit, 1, 12000) && value.gecSentenceLimit === 20
    && (value.correctionsEnabled ? integer(value.gecInputLimit, 1, 12000) : value.gecInputLimit === null);
}

export function isWritingPreflight(value: unknown, text: string, corrections: boolean): value is WritingPreflight {
  if (!record(value) || !integer(value.cefrTokens, 1, 100000) || !integer(value.cefrLimit, 1, 12000)
    || value.canAnalyze !== (value.cefrTokens <= value.cefrLimit) || typeof value.correctionsEnabled !== "boolean"
    || value.gecSentenceLimit !== 20 || !Array.isArray(value.sentences) || value.sentences.length > 12000
    || (value.correctionsEnabled ? !integer(value.gecInputLimit, 1, 12000) : value.gecInputLimit !== null)
    || ((!corrections || !value.correctionsEnabled) && value.sentences.length > 0)) return false;
  const assessment = value.inputAssessment;
  if (assessment != null && (!record(assessment) || assessment.policyVersion !== "cefr-input-v1"
    || !Array.isArray(assessment.reasons) || assessment.reasons.length > 3
    || !assessment.reasons.every((r: unknown) => typeof r === "string" && ["tooShort", "repetition", "unsupportedScript"].includes(r))
    || new Set(assessment.reasons).size !== assessment.reasons.length
    || assessment.status !== (assessment.reasons.length ? "insufficient" : "eligible")
    || !Array.isArray(assessment.warnings) || assessment.warnings.length > 5
    || !assessment.warnings.every((w: unknown) => typeof w === "string" && w.length > 0 && w.length <= 1000))) return false;
  let previousEnd = 0;
  return value.sentences.every((sentence: unknown, index: number) => {
    if (!record(sentence) || sentence.index !== index || !integer(sentence.start, previousEnd, text.length)
      || !integer(sentence.end, Number(sentence.start) + 1, text.length) || !integer(sentence.tokens, 1, 100000)
      || !text.slice(sentence.start, sentence.end).trim()) return false;
    const validBoundary = (offset: number) => offset === 0 || offset === text.length
      || !(text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
        && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);
    if (!validBoundary(sentence.start) || !validBoundary(sentence.end)) return false;
    const expected = index >= 20 ? "sentenceLimit"
      : sentence.tokens > Number(value.gecInputLimit) ? "inputOverBudget" : "ready";
    if (sentence.status !== expected) return false;
    previousEnd = sentence.end;
    return true;
  });
}

export function writingInputIssue(value: WritingPreflight["inputAssessment"]): string {
  if (value?.status !== "insufficient") return "";
  const messages: Record<string, string> = {
    tooShort: "Bài có dưới 5 từ; hãy viết thêm để có đủ thông tin ước lượng CEFR.",
    repetition: "Bài lặp cùng nội dung quá nhiều; hãy phát triển thêm ý trước khi chấm CEFR.",
    unsupportedScript: "Phần lớn chữ viết chưa phù hợp với bộ chấm tiếng Anh; hãy nộp bài bằng tiếng Anh.",
  };
  return value.reasons.map(reason => messages[reason]).join(" ");
}

export function isWritingHistory(value: unknown): value is WritingHistory {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > 20
    || !(value.nextBeforeId === null || integer(value.nextBeforeId, 1, 2147483647))) return false;
  let previousId = Infinity;
  const valid = value.items.every((item: unknown) => {
    if (!record(item) || !integer(item.submissionId, 1, 2147483647) || item.submissionId >= previousId
      || !(item.topic === null || (typeof item.topic === "string" && item.topic.length <= 500))
      || typeof item.cefrLevel !== "string" || !["", "A1", "A2", "B1", "B2", "C1", "C2"].includes(item.cefrLevel)
      || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))
      || typeof item.preview !== "string" || item.preview.length > 160) return false;
    previousId = item.submissionId;
    return true;
  });
  return valid && (value.nextBeforeId === null || (value.items.length > 0 && value.nextBeforeId === previousId));
}
