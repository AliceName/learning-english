export type Deck = { deckId: number; title: string; description: string | null; cardCount: number; dueCount: number; canEdit: boolean; isAdminDeck: boolean };
export type Flashcard = { cardId: number; deckId: number; frontText: string; backText: string; exampleSentence: string | null; intervalDays: number; repetition: number; nextReviewAt: string | null; updatedAt: string; isDue: boolean };
export type DeckDetail = { deck: Deck; cards: Flashcard[] };

export function pronounceFlashcard(text: string, language: string, onIssue: (message: string) => void) {
  if (!text.trim()) return;
  if (!("speechSynthesis" in window)) { onIssue("Trình duyệt chưa hỗ trợ đọc từ."); return; }
  onIssue("");
  window.speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(text);
  speech.lang = language;
  speech.rate = .9;
  speech.onerror = event => {
    if (event.error !== "canceled" && event.error !== "interrupted") onIssue("Chưa phát được giọng đọc trên trình duyệt.");
  };
  window.speechSynthesis.speak(speech);
}
