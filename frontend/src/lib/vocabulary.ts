export type DictionaryLicense = { name: string | null; url: string | null };
export type DictionaryPhonetic = { text: string | null; audio: string | null; sourceUrl: string | null; license: DictionaryLicense | null };
export type DictionaryEntry = {
  word: string; phonetic: string | null; origin: string | null;
  phonetics: DictionaryPhonetic[];
  meanings: { partOfSpeech: string; definitions: { definition: string; example: string | null; synonyms: string[]; antonyms: string[] }[]; synonyms: string[]; antonyms: string[] }[];
  license: DictionaryLicense | null; sourceUrls: string[];
};
export type VocabularyResponse = { word: string; language: string; source: "mongodb" | "dictionaryApi"; isPersisted: boolean; fetchedAtUtc: string; entries: DictionaryEntry[] };

export function safeDictionaryUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
