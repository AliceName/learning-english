export type CardPreferences = { level: string; image: string; phonetic?: string };
export const emptyPreferences: CardPreferences = { level: "", image: "" };

export function deckPreferencePrefix(account: string, deckId: number) {
  return `${account}:deck:${deckId}:`;
}

export function favoritePrefix(account: string) {
  return `${account}:favorite:`;
}

async function access<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lewa-flashcards", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("preferences");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("preferences", mode);
      const request = operation(transaction.objectStore("preferences"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function readPreference<T>(key: string): Promise<T | undefined> {
  return access<T | undefined>("readonly", store => store.get(key));
}

export async function readFavorites(account: string) {
  const prefix = favoritePrefix(account);
  const keys = await access("readonly", store => store.getAllKeys(IDBKeyRange.bound(prefix, prefix + "\uffff")));
  return keys.map(key => Number(String(key).slice(prefix.length)));
}

export function writePreference(key: string, value: true | CardPreferences) {
  return access("readwrite", store => store.put(value, key));
}

export function removePreferences(key: string | IDBKeyRange) {
  return access("readwrite", store => store.delete(key));
}
