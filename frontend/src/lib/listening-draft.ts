import type { ListeningAnswer, ListeningLesson } from "./listening";

type Draft = { contentVersion: string; answers: Record<number, ListeningAnswer>; timeSpentSeconds: number };

export function listeningDraftKey(userId: number, lesson: ListeningLesson) {
  return `linguaai:listening-draft:${userId}:${lesson.courseId}:${lesson.lessonId}`;
}

export function readListeningDraft(key: string, lesson: ListeningLesson): Draft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    if (draft?.contentVersion !== lesson.contentVersion || !draft.answers ||
        !Number.isInteger(draft.timeSpentSeconds) || draft.timeSpentSeconds < 0 || draft.timeSpentSeconds > 86400) return null;

    const answers: Draft["answers"] = {};
    for (const question of lesson.questions) {
      const answer = draft.answers[question.questionId];
      if (!answer || answer.questionId !== question.questionId) continue;
      const cleaned: ListeningAnswer = { questionId: question.questionId, matches: [] };
      if (question.type === "multiple_choice") {
        const index = answer.optionIndex;
        if (index === undefined || !Number.isInteger(index) || index < 0 || index >= question.options.length) continue;
        cleaned.optionIndex = index;
      } else if (question.type === "fill_blank") {
        if (typeof answer.text !== "string" || answer.text.length > 500) continue;
        cleaned.text = answer.text;
      } else if (Array.isArray(answer.matches)) {
        cleaned.matches = question.matchingLeft.flatMap((_, leftIndex) => {
          const rightId = answer.matches.find(match => match?.leftIndex === leftIndex)?.rightId;
          return rightId && question.matchingRight.some(option => option.id === rightId) ? [{ leftIndex, rightId }] : [];
        });
      }
      answers[question.questionId] = cleaned;
    }
    return Object.keys(answers).length ? { ...draft, answers } : null;
  } catch { return null; }
}

export function writeListeningDraft(key: string, draft: Draft) {
  try { sessionStorage.setItem(key, JSON.stringify(draft)); return true; }
  catch { return false; }
}

export function clearListeningDraft(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}
