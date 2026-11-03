import type { SpeakingAttempt, SpeakingAttemptScope, SpeakingLesson, SpeakingSegment, SpeakingWord } from "./speaking";
import { feedbackMode } from "./pronunciation-feedback";

const referenceKey = (text: string) => text.replaceAll("’", "'").replace(/\s+/g, " ").trim().toLowerCase();

export type SpeakingPracticeMode = "sentence" | "segment";
export type SpeakingPracticeTarget = { sentenceIndex: number; segmentIndex: number | null; text: string; key: string; segment?: SpeakingSegment };

export function getPracticeTarget(lesson: SpeakingLesson, sentenceIndex: number, segmentIndex: number | null): SpeakingPracticeTarget | null {
  if (!Number.isInteger(sentenceIndex) || sentenceIndex < 0 || !lesson.sentences[sentenceIndex]) return null;
  if (segmentIndex === null) return { sentenceIndex, segmentIndex: null, text: lesson.sentences[sentenceIndex].text, key: `sentence:${sentenceIndex}` };
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || !lesson.segmentationVersion?.trim()) return null;
  const segment = lesson.segments?.[sentenceIndex]?.[segmentIndex];
  if (!segment || segment.index !== segmentIndex || !segment.text.trim() || !Number.isInteger(segment.startWordIndex) || segment.startWordIndex < 0 ||
    !Number.isInteger(segment.wordCount) || segment.wordCount < 1) return null;
  return { sentenceIndex, segmentIndex, text: segment.text, key: `segment:${sentenceIndex}:${segmentIndex}:${lesson.segmentationVersion}`, segment };
}

export function allPracticeTargets(lesson: SpeakingLesson, mode: SpeakingPracticeMode): SpeakingPracticeTarget[] {
  return lesson.sentences.flatMap((_, index) => {
    if (mode === "segment") {
      const segments = lesson.segments?.[index] ?? [];
      const targets = segments.map((__, segmentIndex) => getPracticeTarget(lesson, index, segmentIndex));
      if (targets.length && targets.every(target => target !== null)) return targets as SpeakingPracticeTarget[];
    }
    const sentence = getPracticeTarget(lesson, index, null);
    return sentence ? [sentence] : [];
  });
}

export function matchesSentence(attempt: SpeakingAttempt, lesson: SpeakingLesson, index: number) {
  return attempt.scope == null && attempt.lessonId === lesson.lessonId && attempt.sentenceIndex === index &&
    !!lesson.sentences[index] && referenceKey(attempt.referenceText) === referenceKey(lesson.sentences[index].text);
}

export function matchesPracticeTarget(attempt: SpeakingAttempt, lesson: SpeakingLesson, sentenceIndex: number, segmentIndex: number | null) {
  const target = getPracticeTarget(lesson, sentenceIndex, segmentIndex);
  if (!target || attempt.lessonId !== lesson.lessonId || attempt.sentenceIndex !== sentenceIndex ||
    referenceKey(attempt.referenceText) !== referenceKey(target.text)) return false;
  if (segmentIndex === null) return attempt.scope == null;
  const scope = attempt.scope;
  return !!scope && scope.kind === "segment" && scope.segmentIndex === segmentIndex &&
    scope.startWordIndex === target.segment!.startWordIndex && scope.wordCount === target.segment!.wordCount &&
    scope.segmentationVersion === lesson.segmentationVersion && referenceKey(scope.sentenceText) === referenceKey(lesson.sentences[sentenceIndex].text);
}

export function completedPracticeTargets(attempts: SpeakingAttempt[], lesson: SpeakingLesson, mode: SpeakingPracticeMode) {
  const targets = allPracticeTargets(lesson, mode);
  return new Set(targets.filter(target => attempts.some(attempt =>
    matchesPracticeTarget(attempt, lesson, target.sentenceIndex, target.segmentIndex) && feedbackMode(attempt.assessment) !== "record_again")).map(target => target.key));
}

export function mergeHistory(...groups: SpeakingAttempt[][]) {
  const unique = new Map<number, SpeakingAttempt>();
  for (const group of groups) for (const attempt of group) if (!unique.has(attempt.attemptId)) unique.set(attempt.attemptId, attempt);
  return [...unique.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.attemptId - a.attemptId).slice(0, 20);
}

export function completedSentences(attempts: SpeakingAttempt[], lesson: SpeakingLesson) {
  return new Set(attempts.filter(attempt => matchesSentence(attempt, lesson, attempt.sentenceIndex) &&
    feedbackMode(attempt.assessment) !== "record_again").map(attempt => attempt.sentenceIndex));
}

export function nextUnpracticed(current: number, count: number, completed: Set<number>) {
  for (let offset = 1; offset <= count; offset++) {
    const index = (current + offset) % count;
    if (!completed.has(index)) return index;
  }
  return null;
}

export function compareAttempts(current: SpeakingAttempt, history: SpeakingAttempt[]) {
  const scopeKey = (scope: SpeakingAttemptScope | null | undefined) => {
    if (scope == null) return "sentence";
    if (scope.kind !== "segment" || !Number.isInteger(scope.segmentIndex) || scope.segmentIndex < 0 ||
      !Number.isInteger(scope.startWordIndex) || scope.startWordIndex < 0 || !Number.isInteger(scope.wordCount) || scope.wordCount < 1 ||
      !scope.sentenceText?.trim() || !scope.segmentationVersion?.trim()) return null;
    return JSON.stringify([scope.kind, scope.segmentIndex, scope.startWordIndex, scope.wordCount, referenceKey(scope.sentenceText), scope.segmentationVersion]);
  };
  const currentScope = scopeKey(current.scope);
  if (currentScope === null) return null;
  const previous = mergeHistory(history).find(attempt => attempt.lessonId === current.lessonId &&
    attempt.sentenceIndex === current.sentenceIndex && scopeKey(attempt.scope) === currentScope && referenceKey(attempt.referenceText) === referenceKey(current.referenceText) &&
    (Date.parse(attempt.createdAt) < Date.parse(current.createdAt) ||
      Date.parse(attempt.createdAt) === Date.parse(current.createdAt) && attempt.attemptId < current.attemptId));
  if (!previous) return null;
  if (feedbackMode(current.assessment) === "record_again" || feedbackMode(previous.assessment) === "record_again")
    return { previous, delta: null, reason: "Một bản ghi cần thu lại nên chưa so sánh điểm." };
  if (previous.assessment.modelVersion !== current.assessment.modelVersion)
    return { previous, delta: null, reason: "Hai lần luyện dùng phiên bản bộ chấm khác nhau nên chưa so sánh điểm." };
  const signature = (attempt: SpeakingAttempt) => JSON.stringify([attempt.assessment.referenceTokenCount,
    attempt.assessment.words.map(word => [word.index, word.phones.map(phone => [phone.sourcePhone, phone.symbol])])]);
  if (signature(previous) !== signature(current))
    return { previous, delta: null, reason: "Phần âm được chấm khác nhau nên chưa so sánh điểm." };
  const delta = Math.round((current.assessment.overallScore - previous.assessment.overallScore) * 10) / 10;
  return { previous, delta, reason: null };
}

export function wordAudioRange(word: SpeakingWord, duration: number) {
  if (!word.phones.length || !Number.isFinite(duration) || duration <= 0) return null;
  if (word.phones.some(phone => !Number.isFinite(phone.startSeconds) || !Number.isFinite(phone.endSeconds) ||
    phone.startSeconds < 0 || phone.endSeconds <= phone.startSeconds || phone.endSeconds > duration + .01)) return null;
  return { start: Math.max(0, Math.min(...word.phones.map(phone => phone.startSeconds)) - .12),
    end: Math.min(duration, Math.max(...word.phones.map(phone => phone.endSeconds)) + .12) };
}

export function microphoneError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Chưa được cấp quyền microphone. Mở quyền microphone cạnh địa chỉ trang rồi thử lại, hoặc chọn tệp WAV.";
  if (name === "NotFoundError") return "Không tìm thấy microphone. Hãy kết nối thiết bị hoặc chọn tệp WAV.";
  if (name === "NotReadableError") return "Chưa mở được microphone. Hãy kiểm tra thiết bị hoặc ứng dụng khác đang dùng microphone rồi thử lại.";
  return error instanceof Error ? error.message : "Chưa mở được microphone. Bạn có thể thử lại hoặc chọn tệp WAV.";
}
