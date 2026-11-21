import type { SpeakingAssessment } from "./speaking";

export type PracticeResult = { assessment: SpeakingAssessment; recording: Blob };
export type PracticeSentence = {
  account: string;
  id: string;
  text: string;
  updatedAt: number;
  saved: boolean;
  bookmarkNote?: string | null;
  result?: PracticeResult;
};

export function sentenceKey(text: string) {
  return text.toLowerCase().replaceAll("’", "'").replace(/\s+/g, " ");
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
      request.onsuccess = () => {
        updated = update(request.result);
        if (updated) store.put(updated);
      };
      transaction.oncomplete = () => resolve(updated);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function saveSentence(sentence: PracticeSentence, changes: Partial<Pick<PracticeSentence, "saved" | "bookmarkNote" | "result" | "updatedAt">> = {}) {
  return writeSentence(sentence.account, sentence.id, current => ({ ...(current ?? sentence), ...changes }));
}

export function changeSentenceBookmark(account: string, id: string, { saved, bookmarkNote }: { saved?: boolean; bookmarkNote: string | null }) {
  return writeSentence(account, id, current => {
    if (!current || (saved === undefined && !current.saved)) return undefined;
    if (saved && current.saved) return current;
    return { ...current, saved: saved ?? current.saved, bookmarkNote };
  });
}
