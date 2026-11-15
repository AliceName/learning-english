import type { Deck } from "./flashcards";

export type VocabularyCard = { frontText: string; backText: string; exampleSentence: string | null };
export type ReadingVocabularyDeck = { lessonId: number; title: string; difficultyLevel: string | null; contentVersion: string; cards: VocabularyCard[] };
export type CourseVocabulary = { courseId: number; courseTitle: string; readingDecks: ReadingVocabularyDeck[] };
export type CourseFlashcardsData = { vocabulary: CourseVocabulary; decks: Deck[] | null };
export function courseFlashcardsHref(courseId: number, lessonId?: number) {
  return `/courses/${courseId}/flashcards${lessonId ? `?lesson=${lessonId}` : ""}`;
}
export function courseFlashcardsApi(courseId: number) { return `/api/flashcards/decks?courseId=${courseId}`; }

export async function flashcardsRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại." : body?.title || "Chưa tải được bộ thẻ. Hãy thử lại.");
  return body as T;
}
