"use client";

import { safeDictionaryUrl, type DictionaryEntry, type DictionaryLicense, type VocabularyResponse } from "@/lib/vocabulary";
import { dictionaryAudioKey, PreparedDictionaryAudio, usePreparedDictionaryAudio } from "./dictionary-audio";
import styles from "./dictionary.module.css";

function License({ license }: { license: DictionaryLicense | null }) {
  if (!license?.name) return null;
  const url = safeDictionaryUrl(license.url);
  return url ? <a href={url} target="_blank" rel="noopener noreferrer">{license.name}</a> : <span>{license.name}</span>;
}

function Entry({ entry, index, prepared }: { entry: DictionaryEntry; index: number; prepared: ReturnType<typeof usePreparedDictionaryAudio> }) {
  const seen = new Set<string>();
  const pronunciations = entry.phonetics.filter(item => {
    const key = dictionaryAudioKey(item) ?? item.text;
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
  return <article className={styles.entry}>
    <div className={styles.wordHeading}><h3>{entry.word}</h3><span>{index > 0 ? `Mục ${index + 1}` : "ENGLISH"}</span></div>
    {entry.phonetic && !pronunciations.some(item => item.text === entry.phonetic) && <p className={styles.phonetic}>{entry.phonetic}</p>}
    {pronunciations.map((phonetic, i) => {
      const key = dictionaryAudioKey(phonetic);
      const asset = key ? prepared.get(key) : null;
      const credit = asset?.attribution;
      const source = safeDictionaryUrl(credit?.sourceUrl ?? phonetic.sourceUrl);
      const locale = credit?.locale;
      const label = locale === "en-US" ? "giọng Mỹ" : locale === "en-GB" ? "giọng Anh" : `bản thu ${i + 1}`;
      return <div key={i} className={styles.pronunciation}>
        {phonetic.text && <span className={styles.phonetic}>{phonetic.text}</span>}
        {asset && key && <PreparedDictionaryAudio asset={asset} label={label} onRetry={() => prepared.retry(key)} onFailure={() => prepared.fail(key)} />}
        {(source || phonetic.license?.name || credit?.licenseName) && <small className={styles.audioCredit}>
          {source && <a href={source} target="_blank" rel="noopener noreferrer">Nguồn audio</a>}
          <License license={credit?.licenseName ? { name: credit.licenseName, url: credit.licenseUrl } : phonetic.license} />
          {credit?.author && <span>{credit.author}</span>}
        </small>}
      </div>;
    })}
    {entry.meanings.map((meaning, i) => <section key={i} className={styles.meaning}>
      <h4>{meaning.partOfSpeech}</h4>
      <ol>{meaning.definitions.map((definition, j) => <li key={j}>
        <p>{definition.definition}</p>
        {definition.example && <blockquote>{definition.example}</blockquote>}
        {definition.synonyms.length > 0 && <p className={styles.related}><b>Đồng nghĩa:</b> {definition.synonyms.join(", ")}</p>}
        {definition.antonyms.length > 0 && <p className={styles.related}><b>Trái nghĩa:</b> {definition.antonyms.join(", ")}</p>}
      </li>)}</ol>
      {meaning.synonyms.length > 0 && <p className={styles.related}><b>Đồng nghĩa:</b> {meaning.synonyms.join(", ")}</p>}
      {meaning.antonyms.length > 0 && <p className={styles.related}><b>Trái nghĩa:</b> {meaning.antonyms.join(", ")}</p>}
    </section>)}
    {entry.origin && <details className={styles.credits}><summary>Nguồn gốc từ</summary><p>{entry.origin}</p></details>}
    <details className={styles.credits}><summary>Nguồn & giấy phép</summary>
      <p>Free Dictionary API {entry.license && <>· <License license={entry.license} /></>}</p>
      {entry.sourceUrls.map((value, i) => { const url = safeDictionaryUrl(value); return url && <a key={i} href={url} target="_blank" rel="noopener noreferrer">{url}</a>; })}
    </details>
  </article>;
}

export default function DictionaryResults({ result, active, onUnauthorized }: { result: VocabularyResponse; active: boolean; onUnauthorized: () => void }) {
  return active ? <ActiveResults result={result} onUnauthorized={onUnauthorized} /> : null;
}

function ActiveResults({ result, onUnauthorized }: { result: VocabularyResponse; onUnauthorized: () => void }) {
  const prepared = usePreparedDictionaryAudio(result, onUnauthorized);
  return <div className={styles.results} data-dictionary-results>{result.entries.map((entry, i) => <Entry key={`${result.word}-${i}`} entry={entry} index={i} prepared={prepared} />)}</div>;
}
