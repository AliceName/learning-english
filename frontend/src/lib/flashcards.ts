export type Deck = { deckId: number; title: string; description: string | null; cardCount: number; dueCount: number; canEdit: boolean; isAdminDeck: boolean };
export type Flashcard = { cardId: number; deckId: number; frontText: string; backText: string; exampleSentence: string | null; intervalDays: number; repetition: number; nextReviewAt: string | null; updatedAt: string; isDue: boolean };
export type DeckDetail = { deck: Deck; cards: Flashcard[] };
