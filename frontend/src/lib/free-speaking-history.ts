import type { SpeakingAssessment } from "./speaking";

export type PracticeResult = { assessment: SpeakingAssessment; recording: Blob };
export type PracticeAttempt = PracticeResult & { id: string; createdAt: number };
export type PracticeContext = { sentenceText: string; startWordIndex: number };
export const practiceAttemptLimit = 10;
export type PracticeSentence = {
  account: string;
  id: string;
  text: string;
  updatedAt: number;
  saved: boolean;
  bookmarkNote?: string | null;
  result?: PracticeResult;
  attempts?: PracticeAttempt[];
  context?: PracticeContext;
};

export function practiceAttempts(sentence: PracticeSentence): PracticeAttempt[] {
  if (sentence.attempts) return sentence.attempts;
  return sentence.result ? [{ ...sentence.result, id: "legacy-" + sentence.updatedAt, createdAt: sentence.updatedAt }] : [];
}

export function appendPracticeResult(sentence: PracticeSentence, result: PracticeResult,
  createdAt = Date.now(), id = crypto.randomUUID()): PracticeSentence {
  const attempt: PracticeAttempt = { ...result, id, createdAt };
  const attempts = [attempt, ...practiceAttempts(sentence).filter(item => item.id !== id)]
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, practiceAttemptLimit);
  const latest = attempts[0];
  return { ...sentence, attempts, updatedAt: latest.createdAt,
    result: { assessment: latest.assessment, recording: latest.recording } };
}

export function sentenceKey(text: string) {
  return text.toLowerCase().replaceAll("’", "'").replace(/\s+/g, " ");
}

export function practiceSentenceKey(text: string, context?: PracticeContext) {
  return context ? "review:" + JSON.stringify([sentenceKey(text), sentenceKey(context.sentenceText), context.startWordIndex]) : sentenceKey(text);
}

const sentenceFragment = "#cau-";

export function practiceSentenceHref(id: string) {
  return "/speaking" + sentenceFragment + encodeURIComponent(id);
}

export function linkedPracticeSentence(hash: string) {
  if (!hash.startsWith(sentenceFragment)) return null;
  try { return decodeURIComponent(hash.slice(sentenceFragment.length)) || null; }
  catch { return null; }
}

function openHistory(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lewa-free-speaking", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("sentences", { keyPath: ["account", "id"] });
      store.createIndex("account", "account");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadSentences(account: string): Promise<PracticeSentence[]> {
  const db = await openHistory();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("sentences").objectStore("sentences").index("account").getAll(account);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function writeSentence<T extends PracticeSentence | undefined>(
  account: string, id: string, update: (current: PracticeSentence | undefined) => T,
): Promise<T> {
  const db = await openHistory();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("sentences", "readwrite");
      const store = transaction.objectStore("sentences");
      const request = store.get([account, id]);
      let updated: T;
      let updateError: unknown;
      request.onsuccess = () => {
        try {
          updated = update(request.result);
          if (updated) store.put(updated);
        } catch (error) {
          updateError = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(updated);
      transaction.onabort = () => reject(updateError ?? transaction.error);
    });
  } finally { db.close(); }
}

export function saveSentence(sentence: PracticeSentence, changes: Partial<Pick<PracticeSentence, "saved" | "bookmarkNote" | "result" | "updatedAt">> = {}) {
  const { result, updatedAt, ...metadata } = changes;
  const attemptId = result ? crypto.randomUUID() : undefined;
  const createdAt = updatedAt ?? Date.now();
  return writeSentence(sentence.account, sentence.id, current => result
    ? { ...appendPracticeResult(current ?? sentence, result, createdAt, attemptId), ...metadata }
    : { ...(current ?? sentence), ...changes });
}

export function savePracticeResult(sentence: PracticeSentence, result: PracticeResult) {
  return saveSentence(sentence, { result, updatedAt: Date.now() });
}

export function changeSentenceBookmark(account: string, id: string, { saved, bookmarkNote }: { saved?: boolean; bookmarkNote: string | null }) {
  return writeSentence(account, id, current => {
    if (!current || (saved === undefined && !current.saved)) return undefined;
    if (saved && current.saved) return current;
    return { ...current, saved: saved ?? current.saved, bookmarkNote };
  });
}
