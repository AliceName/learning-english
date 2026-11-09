"use client";

import { useState } from "react";
import { bilingualPronunciations, safeDictionaryUrl, type DictionaryEntry, type DictionaryLicense, type VocabularyResponse } from "@/lib/vocabulary";
import { dictionaryAudioKey, PreparedDictionaryAudio, usePreparedDictionaryAudio } from "./dictionary-audio";
import styles from "./dictionary.module.css";
import { DefinitionAudioButton, useDefinitionAudio } from "./definition-audio";

function License({ license }: { license: DictionaryLicense | null }) {
  if (!license?.name) return null;
  const url = safeDictionaryUrl(license.url);
  return url ? <a href={url} target="_blank" rel="noopener noreferrer">{license.name}</a> : <span>{license.name}</span>;
}

function Entry({ entry, index, prepared, result, definitionPlayer }: { entry: DictionaryEntry; index: number; prepared: ReturnType<typeof usePreparedDictionaryAudio>; result: VocabularyResponse; definitionPlayer: ReturnType<typeof useDefinitionAudio> }) {
  const showPronunciation = result.language !== "vi";
  const bilingual = result.direction === "en-vi";
  const [expandedPronunciations, setExpandedPronunciations] = useState(false);
  const seen = new Set<string>();
  const pronunciations = !showPronunciation ? [] : bilingual ? bilingualPronunciations(entry) : entry.phonetics.filter(item => {
    const key = dictionaryAudioKey(item) ?? item.text;
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
  const visiblePronunciations = bilingual && !expandedPronunciations ? pronunciations.slice(0, 2) : pronunciations;
  return <article className={styles.entry}>
    <div className={styles.wordHeading}><h3>{entry.word}</h3><span>{index > 0 ? `Mục ${index + 1}` : result.language === "vi" ? "TIẾNG VIỆT" : "ENGLISH"}</span></div>
    {showPronunciation && !bilingual && entry.phonetic && !pronunciations.some(item => item.text === entry.phonetic) && <p className={styles.phonetic}>{entry.phonetic}</p>}
    {visiblePronunciations.map((phonetic, i) => {
      const key = !result.direction || result.direction === "en-en" ? dictionaryAudioKey(phonetic) : null;
      const asset = key ? prepared.get(key) : null;
      const credit = asset?.attribution;
      const source = safeDictionaryUrl(credit?.sourceUrl ?? phonetic.sourceUrl);
      const locale = credit?.locale;
      const label = locale === "en-US" ? "giọng Mỹ" : locale === "en-GB" ? "giọng Anh" : `bản thu ${i + 1}`;
      return <div key={i} className={styles.pronunciation} data-pronunciation>
        {phonetic.text && <span className={styles.phonetic}>{phonetic.text}</span>}
        {phonetic.region && <small>{phonetic.region}</small>}
        {asset && key && <PreparedDictionaryAudio asset={asset} label={label} onRetry={() => prepared.retry(key)} onFailure={() => prepared.fail(key)} />}
        {(source || phonetic.license?.name || credit?.licenseName) && <small className={styles.audioCredit}>
          {source && <a href={source} target="_blank" rel="noopener noreferrer">Nguồn audio</a>}
          <License license={credit?.licenseName ? { name: credit.licenseName, url: credit.licenseUrl } : phonetic.license} />
          {credit?.author && <span>{credit.author}</span>}
        </small>}
      </div>;
    })}
    {bilingual && pronunciations.length > 2 && <button type="button" className={styles.morePronunciations} aria-expanded={expandedPronunciations}
      onClick={() => setExpandedPronunciations(value => !value)}>{expandedPronunciations ? "Thu gọn phiên âm" : `Xem thêm ${pronunciations.length - 2} phiên âm`}</button>}
    {entry.meanings.map((meaning, i) => <section key={i} className={styles.meaning}>
      <h4>{meaning.partOfSpeech}</h4>
      <ol>{meaning.definitions.map((definition, j) => <li key={j}>
        <p>{definition.definition}</p>
        <DefinitionAudioButton definition={definition} player={definitionPlayer} />
        {definition.example && <blockquote>{definition.example}</blockquote>}
        {definition.sourceMetadata?.sourceName && <small className={styles.audioCredit}>Nguồn nghĩa · {definition.sourceMetadata.sourceName}</small>}
        {definition.synonyms.length > 0 && <p className={styles.related}><b>Đồng nghĩa:</b> {definition.synonyms.join(", ")}</p>}
        {definition.antonyms.length > 0 && <p className={styles.related}><b>Trái nghĩa:</b> {definition.antonyms.join(", ")}</p>}
      </li>)}</ol>
      {meaning.synonyms.length > 0 && <p className={styles.related}><b>Đồng nghĩa:</b> {meaning.synonyms.join(", ")}</p>}
      {meaning.antonyms.length > 0 && <p className={styles.related}><b>Trái nghĩa:</b> {meaning.antonyms.join(", ")}</p>}
    </section>)}
    {entry.origin && <details className={styles.credits}><summary>Nguồn gốc từ</summary><p>{entry.origin}</p></details>}
    <details className={styles.credits}><summary>Nguồn & giấy phép</summary>
      <p>{result.providerAttribution?.name ?? "Free Dictionary API"} {entry.license && <>· <License license={entry.license} /></>}</p>
      {result.provider === "minhqnd" && <p>Dữ liệu được chuẩn hóa để hiển thị. Xem nguồn và giấy phép tại trang nhà cung cấp.</p>}
      {entry.sourceUrls.map((value, i) => { const url = safeDictionaryUrl(value); return url && <a key={i} href={url} target="_blank" rel="noopener noreferrer">{url}</a>; })}
    </details>
  </article>;
}

export default function DictionaryResults({ result, active, onUnauthorized }: { result: VocabularyResponse; active: boolean; onUnauthorized: () => void }) {
  return active ? <ActiveResults result={result} onUnauthorized={onUnauthorized} /> : null;
}

function ActiveResults({ result, onUnauthorized }: { result: VocabularyResponse; onUnauthorized: () => void }) {
  const prepared = usePreparedDictionaryAudio(result, onUnauthorized);
  const definitionPlayer = useDefinitionAudio(result, onUnauthorized);
  return <div className={styles.results} data-dictionary-results>
    {result.entries.map((entry, i) => <Entry key={`${result.word}-${i}`} entry={entry} index={i} prepared={prepared} result={result} definitionPlayer={definitionPlayer} />)}
  </div>;
}
