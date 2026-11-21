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
  // Word choice (vocabulary) is a matter of meaning and GEC often over-corrects it, so its answer stays visible.
  return type === "grammar" || type === "mechanics";
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

export type SentenceShade = { start: number; end: number; suggestionIndex: number; state: "pending" | "fixed" | "skipped" };

/**
 * Write & Improve-style sentence shading. Every suggested sentence is shaded, even when its
 * word-level suggestions are not revealed yet: "pending" while any change in it is undecided,
 * "done" once all are handled. Only exact saved offsets (or a unique legacy match) are used;
 * overlapping or mismatched spans are skipped rather than guessed.
 */
export function sentenceShades(originalText: string,
  errors: readonly { original: string; sourceStart?: number | null; sourceEnd?: number | null }[],
  items: readonly { suggestionIndex: number; status: string }[]): SentenceShade[] {
  const shades: SentenceShade[] = [];
  for (const [suggestionIndex, error] of errors.entries()) {
    let start = error.sourceStart ?? null;
    if (start === null) {
      const first = originalText.indexOf(error.original);
      if (!error.original || first < 0 || originalText.indexOf(error.original, first + 1) >= 0) continue;
      start = first;
    }
    const end = error.sourceEnd ?? start + error.original.length;
    if (!error.original || originalText.slice(start, end) !== error.original) continue;
    if (shades.some(shade => start! < shade.end && shade.start < end)) continue;
    const own = items.filter(item => item.suggestionIndex === suggestionIndex);
    // Skipping is not fixing: a sentence counts as fixed only if at least one change was accepted or self-fixed.
    const state = own.some(item => item.status === "pending") ? "pending"
      : own.some(item => item.status === "accepted" || item.status === "selfFixed") ? "fixed" : "skipped";
    shades.push({ start, end, suggestionIndex, state });
  }
  return shades.sort((a, b) => a.start - b.start);
}

/**
 * Sentences of the current version that are not in the previous version (rewritten or added)
 * and have no suggestion now: shown as "improved", like Write & Improve after a re-check.
 */
export function improvedSentences(current: string, previous: string, shades: readonly { start: number; end: number }[]) {
  const spans: { start: number; end: number }[] = [];
  for (const match of current.matchAll(/[^.!?\n]+[.!?]*/gu)) {
    const text = match[0].trim();
    if (!text || !/[A-Za-z]/u.test(text)) continue;
    const start = (match.index ?? 0) + match[0].indexOf(text), end = start + text.length;
    if (previous.includes(text) || shades.some(shade => start < shade.end && shade.start < end)) continue;
    spans.push({ start, end });
  }
  return spans;
}

type DictionaryLike = { entries?: { meanings?: { partOfSpeech?: string; definitions?: { definition?: string }[] }[] }[] };

/** Phrases such as "listen to" are looked up by their first word; single words as they are. */
export function dictionaryLookupWord(term: string): string {
  const words = term.trim().split(/\s+/u);
  return words.length > 1 ? words[0] : term.trim();
}

/**
 * A short, editable card meaning from the app's existing en-vi dictionary: the first two
 * definitions of the first sense. For a phrase, the remaining words are noted ("đi với “to”").
 * Empty when the dictionary has nothing, so the learner writes it.
 */
export function dictionaryGloss(response: DictionaryLike, term: string): string {
  const meaning = response.entries?.[0]?.meanings?.find(m => m.definitions?.some(d => d.definition?.trim()));
  if (!meaning) return "";
  const definitions = (meaning.definitions ?? []).map(d => d.definition?.trim()).filter(Boolean).slice(0, 2).join(" / ");
  const rest = term.trim().split(/\s+/u).slice(1).join(" ");
  return `${meaning.partOfSpeech ? `(${meaning.partOfSpeech}) ` : ""}${definitions}${rest ? ` — đi với “${rest}”` : ""}`;
}

/** Rough planning + writing + checking time for a task (about 10 words a minute while drafting). */
export function suggestedMinutes(task: { wordMode: string; minWords: number; maxWords: number }): number {
  const words = task.wordMode === "about" || task.wordMode === "minimum" ? task.minWords : (task.minWords + task.maxWords) / 2;
  return Math.min(45, Math.max(10, Math.round((10 + words / 10) / 5) * 5));
}

export type NextStep = { key: string; title: string; detail: string; count?: number };

// Each group turns error kinds into one concrete practice step. Kinds come from the explanation templates.
const stepGroups: { key: string; categories: string[]; title: string; detail: string }[] = [
  { key: "sva", categories: ["VERB:SVA"], title: "Ôn hòa hợp chủ ngữ – động từ",
    detail: "Gạch chân chủ ngữ của từng câu ở hiện tại đơn. Chủ ngữ số ít (he, she, it, my friend) thì động từ thêm -s/-es; chủ ngữ số nhiều thì không." },
  { key: "tense", categories: ["VERB:TENSE", "VERB:INFL"], title: "Ôn thì và động từ bất quy tắc",
    detail: "Tìm mốc thời gian (yesterday, last week, every day) rồi đọc lại các động từ trong câu đó; tra bảng động từ bất quy tắc cho dạng quá khứ." },
  { key: "form", categories: ["VERB:FORM"], title: "Ôn dạng động từ sau từ đặc biệt",
    detail: "Sau can/must/should dùng động từ nguyên mẫu; sau enjoy, thank you for dùng V-ing; sau want, decide dùng to + V." },
  { key: "number", categories: ["NOUN:NUM", "NOUN:INFL"], title: "Ôn danh từ số ít / số nhiều",
    detail: "Tìm từ chỉ số lượng (many, two, some, a lot of) và kiểm tra danh từ theo sau; nhớ các danh từ không đếm được như homework, advice, information." },
  { key: "article", categories: ["ARTICLE", "DET"], title: "Ôn mạo từ a/an/the",
    detail: "Danh từ đếm được số ít cần a/an/the hoặc một từ như my, this; dùng the khi người đọc đã biết vật bạn nói tới." },
  { key: "prep", categories: ["PREP", "PART"], title: "Ôn cụm động từ + giới từ",
    detail: "Ghi các cụm đã sai (listen to, depend on, good at) vào thẻ từ vựng bên dưới và ôn lại trước lần viết sau." },
  { key: "spell", categories: ["SPELL"], title: "Luyện chính tả các từ đã sai",
    detail: "Lưu các từ sai chính tả vào thẻ từ vựng; tự viết lại mỗi từ trong một câu mới." },
  { key: "mechanics", categories: ["PUNCT", "ORTH", "CONTR"], title: "Soát dấu câu và viết hoa",
    detail: "Đọc to từng câu: mỗi câu một ý và kết thúc bằng dấu chấm; viết hoa đầu câu, tên riêng, ngày và tháng." },
  { key: "words", categories: ["VERB", "NOUN", "ADJ", "ADV", "MORPH", "WO", "PRON", "CONJ", "ADJ:FORM", "NOUN:POSS"],
    title: "Kiểm tra cách dùng từ",
    detail: "Với mỗi từ AI đề xuất thay, tra nghĩa và câu ví dụ trong từ điển trước khi dùng; chỉ nhận khi đúng ý bạn." },
];

/**
 * Up to three concrete next steps, built only from what LEWA measured: error kinds, prompt
 * relevance and word count. It is a practice plan, not a score.
 */
export function nextSteps(result: {
  errors: { explanations?: { category: string }[] | null }[];
  correctedText: string | null; originalText: string;
  relevance?: { offTopic: boolean; points: { point: string; covered: boolean }[] } | null;
  task?: { wordMode: string; minWords: number; maxWords: number } | null;
}): NextStep[] {
  const steps: NextStep[] = [];
  const relevance = result.relevance;
  if (relevance?.offTopic) steps.push({ key: "topic", title: "Bám sát đề bài",
    detail: "Bài có vẻ chưa trả lời đúng đề. Đọc lại đề, gạch chân câu hỏi chính và viết ít nhất một câu trả lời trực tiếp cho từng ý." });
  else {
    const missing = relevance?.points.filter(point => !point.covered) ?? [];
    if (missing.length) steps.push({ key: "points", title: "Trả lời đủ các ý của đề", count: missing.length,
      detail: `Chưa thấy rõ trong bài: ${missing.map(point => `“${point.point}”`).join("; ")}. Viết thêm một câu cho mỗi ý.` });
  }
  const task = result.task, words = wordCount(result.originalText);
  if (task && task.wordMode !== "metadata" && words < task.minWords) steps.push({ key: "length", title: "Viết đủ độ dài",
    detail: `Bài có ${words} từ, đề yêu cầu ${task.wordMode === "range" ? `${task.minWords}–${task.maxWords}` : task.wordMode === "minimum" ? `ít nhất ${task.minWords}` : `khoảng ${task.minWords}`} từ. Thêm một ví dụ hoặc lý do cụ thể cho ý chính.` });
  else if (task && task.wordMode === "range" && words > task.maxWords) steps.push({ key: "length", title: "Rút gọn bài",
    detail: `Bài có ${words} từ, vượt giới hạn ${task.maxWords} từ. Bỏ câu lặp ý và giữ mỗi đoạn một ý chính.` });
  const counts = new Map<string, number>();
  for (const error of result.errors) for (const explanation of error.explanations ?? []) {
    const group = stepGroups.find(item => item.categories.includes(explanation.category));
    if (group) counts.set(group.key, (counts.get(group.key) ?? 0) + 1);
  }
  const ranked = stepGroups.filter(group => counts.has(group.key))
    .sort((a, b) => counts.get(b.key)! - counts.get(a.key)!);
  for (const group of ranked) steps.push({ key: group.key, title: group.title, detail: group.detail, count: counts.get(group.key) });
  if (!steps.length && result.correctedText !== null) steps.push({ key: "stretch", title: "Thử mở rộng bài",
    detail: "AI không trả về gợi ý sửa, nhưng điều đó không có nghĩa bài không còn lỗi. Hãy tự đọc lại một lượt, rồi thêm từ nối (however, as a result) và một ví dụ cụ thể cho mỗi ý trước khi nộp lại." });
  return steps.slice(0, 3);
}
