export type DictionaryLicense = { name: string | null; url: string | null };
export type DictionaryDirection = "en-en" | "en-vi" | "vi-en";
export type DictionaryPhonetic = { text: string | null; audio: string | null; sourceUrl: string | null; license: DictionaryLicense | null; region?: string | null };
export type DictionaryDefinition = {
  definition: string; example: string | null; synonyms: string[]; antonyms: string[];
  definitionId?: string; definitionLanguage?: string;
  sourceMetadata?: { sourceName: string | null; sourceUrl: string | null; license: DictionaryLicense | null } | null;
  definitionAudio?: { canPrepare: boolean; reason: string | null; language: string };
};
export type DictionaryEntry = {
  word: string; phonetic: string | null; origin: string | null;
  phonetics: DictionaryPhonetic[];
  meanings: { partOfSpeech: string; definitions: DictionaryDefinition[]; synonyms: string[]; antonyms: string[] }[];
  license: DictionaryLicense | null; sourceUrls: string[];
};
export type VocabularyResponse = { word: string; language: string; source: "mongodb" | "dictionaryApi" | "minhqnd"; isPersisted: boolean; fetchedAtUtc: string; entries: DictionaryEntry[];
  direction?: DictionaryDirection; definitionLanguage?: string; provider?: "dictionaryApi" | "minhqnd"; providerAttribution?: { name: string; url: string } };

export function bilingualPronunciations(entry: DictionaryEntry) {
  const seen = new Set<string>();
  const pronunciations = entry.phonetic ? [...entry.phonetics, { text: entry.phonetic, audio: null, sourceUrl: null, license: null }] : entry.phonetics;
  return pronunciations.filter(phonetic => {
    const key = phonetic.text?.normalize("NFC").trim().replace(/^[/\[]|[/\]]$/g, "").replace(/[.\s]/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function safeDictionaryUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
