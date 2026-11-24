import type { PracticeAttempt, PracticeContext, PracticeSentence } from "./free-speaking-history";
import { feedbackMode } from "./pronunciation-feedback";
import { compareAssessments } from "./speaking-practice";

export function practiceScore(sentence: PracticeSentence) {
  const assessment = sentence.result?.assessment;
  return assessment && feedbackMode(assessment) !== "record_again" ? assessment.overallScore : null;
}

export function practiceBand(sentence: PracticeSentence) {
  const score = practiceScore(sentence);
  if (score === null) return sentence.result ? "record_again" : "pending";
  if (score < 60) return "priority";
  if (score < 80) return "review";
  if (score < 90) return "good";
  return "excellent";
}

export function comparePracticeAttempts(current: PracticeAttempt, attempts: PracticeAttempt[]) {
  const position = attempts.findIndex(item => item.id === current.id);
  const previous = position >= 0 ? attempts[position + 1] : undefined;
  return previous ? { previous, ...compareAssessments(current.assessment, previous.assessment) } : null;
}

export type SpeakingReviewStep = { kind: "word" | "phrase" | "sentence"; label: string; text: string; context?: PracticeContext };
export type SpeakingReviewPlan = { word: string; sentenceText: string; steps: SpeakingReviewStep[] };

export function speakingReviewPlan(text: string, wordIndex: number): SpeakingReviewPlan | null {
  const words = [...text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)];
  if (!Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= words.length) return null;
  const start = Math.max(0, Math.min(wordIndex - 2, words.length - 5));
  const end = Math.min(words.length, start + 5);
  const phrase = text.slice(words[start].index!, words[end - 1].index! + words[end - 1][0].length);
  const steps: SpeakingReviewStep[] = [{ kind: "word", label: "Từ cần luyện", text: words[wordIndex][0],
    ...(words.length > 1 ? { context: { sentenceText: text, startWordIndex: wordIndex } } : {}) }];
  if (words.length > 5) steps.push({ kind: "phrase", label: "Cụm ngắn", text: phrase,
    context: { sentenceText: text, startWordIndex: start } });
  if (words.length > 1) steps.push({ kind: "sentence", label: "Cả câu", text });
  return { word: words[wordIndex][0], sentenceText: text, steps };
}
