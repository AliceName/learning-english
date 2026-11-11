export type WritingExplanation = {
  category: string;
  original: string;
  suggestion: string;
  message: string;
  templateVersion: string;
};

export type WritingSuggestion = {
  original: string;
  suggestion: string;
  explanations?: WritingExplanation[] | null;
  sourceStart?: number | null;
  sourceEnd?: number | null;
};

export type WritingGecCoverage = {
  totalBodySentences: number;
  changed: number;
  unchanged: number;
  rejected: number;
  inputOverBudget: number;
  incomplete: number;
  sentenceLimit: number;
};

export type WritingFeedback = {
  status: "ready" | "unavailable";
  items: {
    criterion: "content" | "organization" | "vocabulary" | "grammar";
    quote: string;
    comment: string;
    action: string;
    suggestionIndex: number | null;
  }[];
  message: string;
  modelId: string | null;
  modelSha256: string | null;
  promptVersion: string | null;
};

export type WritingTask = {
  id: string; version: string; title: string; prompt: string; level: "Beginner" | "Intermediate" | "Advanced";
  genre: string; topic: string; minWords: number; maxWords: number; wordMode: "range" | "minimum" | "about" | "metadata";
  requirements: string[]; sourceSha256: string; sourcePromptSha256: string; reviewStatus: string;
};

export function isWritingTask(value: unknown): value is WritingTask {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return typeof t.id === "string" && /^[a-f0-9-]{36}$/u.test(t.id)
    && typeof t.version === "string" && /^[a-f0-9]{64}$/u.test(t.version)
    && boundedText(t.title, 200) && boundedText(t.prompt, 8000) && boundedText(t.genre, 100) && boundedText(t.topic, 200)
    && ["Beginner", "Intermediate", "Advanced"].includes(String(t.level))
    && ["range", "minimum", "about", "metadata"].includes(String(t.wordMode))
    && Number.isInteger(t.minWords) && Number(t.minWords) >= 1 && Number.isInteger(t.maxWords)
    && Number(t.maxWords) >= Number(t.minWords) && Number(t.maxWords) <= 1000
    && Array.isArray(t.requirements) && t.requirements.length > 0 && t.requirements.length <= 12
    && t.requirements.every(r => boundedText(r, 1000)) && t.reviewStatus === "automated-reviewed-not-expert"
    && typeof t.sourceSha256 === "string" && /^[a-f0-9]{64}$/u.test(t.sourceSha256)
    && typeof t.sourcePromptSha256 === "string" && /^[a-f0-9]{64}$/u.test(t.sourcePromptSha256);
}

export function taskWordGuidance(t: WritingTask): string {
  if (t.wordMode === "about") return `Theo đề: khoảng ${t.minWords} từ`;
  if (t.wordMode === "minimum") return `Theo đề: ít nhất ${t.minWords} từ`;
  return `${t.wordMode === "metadata" ? "Độ dài gợi ý" : "Theo đề"}: ${t.minWords}–${t.maxWords} từ`;
}

export type WritingTaskCatalogue = { items: WritingTask[]; version: string; sourceCount: number };
export function isWritingTaskCatalogue(value: unknown): value is WritingTaskCatalogue {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return c.sourceCount === 50 && typeof c.version === "string" && /^[a-f0-9]{64}$/u.test(c.version)
    && Array.isArray(c.items) && c.items.length > 0 && c.items.length <= 50 && c.items.every(isWritingTask)
    && new Set(c.items.map(t => t.id)).size === c.items.length;
}

export type WritingResult = {
  task?: WritingTask | null;
  practiceRootId?: number | null;
  parentSubmissionId?: number | null;
  submissionId: number;
  topic: string | null;
  originalText: string;
  cefrLevel: string;
  correctedText: string | null;
  errors: WritingSuggestion[];
  warnings: string[];
  createdAt: string;
  gecCoverage?: WritingGecCoverage | null;
  provenance?: {
    cefrRun: string | null;
    cefrAdapterSha256: string | null;
    gecRun: string | null;
    gecAdapterSha256: string | null;
    explanationVersion: string | null;
    guardVersion?: string | null;
    inputPolicyVersion?: string | null;
  } | null;
  feedback?: WritingFeedback | null;
};

const levels = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);
const criteria = new Set(["content", "organization", "vocabulary", "grammar"]);
const boundedText = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const nullableText = (value: unknown, max: number) => value === null || boundedText(value, max);
const nullableHash = (value: unknown) => value === null || (typeof value === "string" && /^[a-f0-9]{64}$/u.test(value));

export function writingBoundary(text: string, offset: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= text.length
    && (offset === 0 || offset === text.length || !(text.charCodeAt(offset - 1) >= 0xd800
      && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff));
}

function validCoverage(value: unknown, correctedText: unknown, errors: unknown[]): boolean {
  if (value == null) return true;
  if (typeof value !== "object" || typeof correctedText !== "string") return false;
  const coverage = value as Record<string, unknown>;
  const groups = ["changed", "unchanged", "rejected", "inputOverBudget", "incomplete", "sentenceLimit"];
  const counts = groups.map(key => coverage[key]);
  return Number.isInteger(coverage.totalBodySentences) && Number(coverage.totalBodySentences) >= 0
    && Number(coverage.totalBodySentences) <= 12000
    && counts.every(count => Number.isInteger(count) && Number(count) >= 0 && Number(count) <= 12000)
    && counts.reduce<number>((sum, count) => sum + Number(count), 0) === coverage.totalBodySentences
    && coverage.sentenceLimit === Math.max(0, Number(coverage.totalBodySentences) - 20)
    && coverage.changed === errors.length;
}

export function writingCoverageSummary(coverage: WritingGecCoverage) {
  return {
    completed: coverage.changed + coverage.unchanged + coverage.rejected,
    rejected: coverage.rejected,
    unprocessed: coverage.inputOverBudget + coverage.incomplete + coverage.sentenceLimit,
  };
}

export function sameWritingCoverage(a: WritingGecCoverage | null | undefined, b: WritingGecCoverage | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.totalBodySentences === b.totalBodySentences && a.changed === b.changed && a.unchanged === b.unchanged
    && a.rejected === b.rejected && a.inputOverBudget === b.inputOverBudget
    && a.incomplete === b.incomplete && a.sentenceLimit === b.sentenceLimit;
}

function validSuggestion(value: unknown): value is WritingSuggestion {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.original !== "string" || item.original.length > 12000
    || typeof item.suggestion !== "string" || item.suggestion.length > 24000) return false;
  if ((item.sourceStart != null || item.sourceEnd != null)
    && (!Number.isInteger(item.sourceStart) || !Number.isInteger(item.sourceEnd)
      || Number(item.sourceStart) < 0 || Number(item.sourceEnd) <= Number(item.sourceStart)
      || Number(item.sourceEnd) > 12000)) return false;
  return item.explanations == null || (Array.isArray(item.explanations) && item.explanations.length <= 40
    && item.explanations.every(value => {
      if (!value || typeof value !== "object") return false;
      const explanation = value as Record<string, unknown>;
      return boundedText(explanation.category, 64) && boundedText(explanation.message, 1000)
        && boundedText(explanation.templateVersion, 100)
        && typeof explanation.original === "string" && typeof explanation.suggestion === "string"
        && (explanation.original.length > 0 || explanation.suggestion.length > 0)
        && (item.original as string).includes(explanation.original)
        && (item.suggestion as string).includes(explanation.suggestion);
    }));
}

function validFeedback(value: unknown, original: string, topic: unknown, errors: WritingSuggestion[]): boolean {
  if (value == null) return true;
  if (typeof value !== "object") return false;
  const feedback = value as Record<string, unknown>;
  if ((feedback.status !== "ready" && feedback.status !== "unavailable")
    || !boundedText(feedback.message, 1000) || !nullableText(feedback.modelId, 200)
    || !nullableHash(feedback.modelSha256) || !nullableText(feedback.promptVersion, 100)
    || !Array.isArray(feedback.items) || feedback.items.length > 4) return false;
  if (feedback.status === "unavailable") return feedback.items.length === 0;
  if (!feedback.items.length) return false;
  const seen = new Set<string>();
  return feedback.items.every(value => {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    if (typeof item.criterion !== "string" || !criteria.has(item.criterion) || seen.has(item.criterion)
      || !boundedText(item.quote, 1000) || !original.includes(item.quote as string)
      || !boundedText(item.comment, 500) || !boundedText(item.action, 500)) return false;
    seen.add(item.criterion);
    if (item.criterion === "content" && (typeof topic !== "string" || !topic.trim())) return false;
    if (item.criterion !== "grammar") return item.suggestionIndex === null;
    return Number.isInteger(item.suggestionIndex) && Number(item.suggestionIndex) >= 0
      && Number(item.suggestionIndex) < errors.length
      && errors[Number(item.suggestionIndex)].original.includes(item.quote as string);
  });
}

export function writingFeedbackEligible(result: Pick<WritingResult, "originalText">): boolean {
  const words = result.originalText.trim().split(/\s+/u).length;
  return words >= 80 && words <= 150;
}

export function writingSubmissionId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,9}$/u.test(value)) return null;
  const id = Number(value);
  return id <= 2147483647 ? id : null;
}

export function isWritingResult(value: unknown): value is WritingResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.submissionId) && Number(item.submissionId) > 0
    && (item.task == null || isWritingTask(item.task))
    && (item.practiceRootId == null || (Number.isInteger(item.practiceRootId) && Number(item.practiceRootId) > 0 && Number(item.practiceRootId) <= Number(item.submissionId)))
    && (item.parentSubmissionId == null || (Number.isInteger(item.parentSubmissionId) && Number(item.parentSubmissionId) > 0
      && Number(item.parentSubmissionId) < Number(item.submissionId) && item.practiceRootId != null
      && Number(item.practiceRootId) <= Number(item.parentSubmissionId)))
    && Number(item.submissionId) <= 2147483647
    && (item.topic === null || (typeof item.topic === "string" && item.topic.length <= 500))
    && typeof item.originalText === "string" && item.originalText.trim().length > 0 && item.originalText.length <= 12000
    && typeof item.cefrLevel === "string" && levels.has(item.cefrLevel)
    && (item.correctedText === null || (typeof item.correctedText === "string" && item.correctedText.length <= 24000))
    && Array.isArray(item.errors) && item.errors.length <= 200
    && item.errors.every(validSuggestion)
    && item.errors.every(error => error.sourceStart == null || (writingBoundary(item.originalText as string, error.sourceStart)
      && writingBoundary(item.originalText as string, error.sourceEnd as number)
      && (item.originalText as string).slice(error.sourceStart, error.sourceEnd ?? undefined) === error.original))
    && validCoverage(item.gecCoverage, item.correctedText, item.errors)
    && Array.isArray(item.warnings) && item.warnings.length <= 30
    && item.warnings.every(warning => typeof warning === "string")
    && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt))
    && (item.provenance == null || (typeof item.provenance === "object"
      && nullableText((item.provenance as Record<string, unknown>).cefrRun, 200)
      && nullableText((item.provenance as Record<string, unknown>).gecRun, 200)
      && nullableHash((item.provenance as Record<string, unknown>).cefrAdapterSha256)
      && nullableHash((item.provenance as Record<string, unknown>).gecAdapterSha256)
      && nullableText((item.provenance as Record<string, unknown>).explanationVersion, 100)
      && ((item.provenance as Record<string, unknown>).guardVersion == null
        || boundedText((item.provenance as Record<string, unknown>).guardVersion, 100))
      && ((item.provenance as Record<string, unknown>).inputPolicyVersion == null
        || boundedText((item.provenance as Record<string, unknown>).inputPolicyVersion, 100))))
    && validFeedback(item.feedback, item.originalText as string, item.topic, item.errors as WritingSuggestion[]);
}
