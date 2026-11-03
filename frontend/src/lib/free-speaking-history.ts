import type { SpeakingAssessment } from "./speaking";

export type PracticeResult = { assessment: SpeakingAssessment; recording: Blob };
export type PracticeSentence = {
  account: string;
  id: string;
  text: string;
  updatedAt: number;
  saved: boolean;
  result?: PracticeResult;
};

export function sentenceKey(text: string) {
  return text.toLowerCase().replaceAll("’", "'").replace(/\s+/g, " ");
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

export async function saveSentence(sentence: PracticeSentence, changes: Partial<Pick<PracticeSentence, "saved" | "result" | "updatedAt">> = {}): Promise<PracticeSentence> {
  const db = await openHistory();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("sentences", "readwrite");
      const store = transaction.objectStore("sentences");
      const request = store.get([sentence.account, sentence.id]);
      let updated: PracticeSentence;
      request.onsuccess = () => {
        updated = { ...(request.result ?? sentence), ...changes };
        store.put(updated);
      };
      transaction.oncomplete = () => resolve(updated);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
