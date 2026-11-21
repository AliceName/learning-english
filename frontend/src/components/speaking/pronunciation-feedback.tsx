"use client";

import { useState } from "react";
import type { SpeakingAttempt, SpeakingWord } from "@/lib/speaking";
import { wordAudioRange } from "@/lib/speaking-practice";
import { practiceTargets, phoneGuidance, feedbackMode, feedbackThresholds, sentenceFeedback } from "@/lib/pronunciation-feedback";
import styles from "./pronunciation-feedback.module.css";

export const pronunciationToneClasses = {
  good: styles.goodWord,
  listen: styles.listenWord,
  practice: styles.practiceWord,
  unassessed: styles.unassessedWord,
};

export function PronunciationLegend() {
  return <ul className={styles.legend} aria-label="Ý nghĩa màu từng từ">
    <li><span className={pronunciationToneClasses.good}>Xanh</span> Điểm tốt</li>
    <li><span className={pronunciationToneClasses.listen}>Vàng</span> Nên nghe lại</li>
    <li><span className={pronunciationToneClasses.practice}>Đỏ</span> Ưu tiên luyện</li>
    <li><span className={pronunciationToneClasses.unassessed}>Xám</span> Chưa đủ dữ liệu</li>
  </ul>;
}

export default function PronunciationFeedback({ attempt, disabled, canRetry, rate, onBeforePlay, onListenRecording, onRetry }: {
  attempt: Pick<SpeakingAttempt, "referenceText" | "assessment" | "scope"> & { attemptId: string | number };
  disabled: boolean; canRetry: boolean; rate: number;
  onBeforePlay: () => void; onListenRecording: (word: SpeakingWord) => void; onRetry: () => void;
}) {
  const [notice, setNotice] = useState("");
  const unit = attempt.scope?.kind === "segment" ? "cụm" : "câu";
  const { practice: threshold, review: reviewThreshold } = feedbackThresholds(attempt.assessment);
  const mode = feedbackMode(attempt.assessment);
  const needsRetry = mode === "record_again";
  const words = needsRetry ? attempt.assessment.words.filter(word => word.feedbackEligible === true) : attempt.assessment.words;
  const targets = practiceTargets(words, threshold, reviewThreshold);
  const parts = sentenceFeedback(attempt.referenceText, attempt.assessment);
  const hasWordColors = parts.some(part => part.feedback && part.feedback.tone !== "unassessed");
  const scores = new Map(attempt.assessment.words.map(word => [word.index, word.score]));

  function listen(text: string) {
    if (!("speechSynthesis" in window)) { setNotice("Trình duyệt chưa hỗ trợ giọng đọc mẫu."); return; }
    setNotice("");
    onBeforePlay();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US"; utterance.rate = rate;
    utterance.onerror = event => { if (event.error !== "canceled" && event.error !== "interrupted") setNotice("Chưa phát được giọng đọc. Hãy kiểm tra giọng tiếng Anh của trình duyệt."); };
    window.speechSynthesis.speak(utterance);
  }

  return <section className={styles.panel} aria-labelledby={`feedback-${attempt.attemptId}`}>
    <h3 id={`feedback-${attempt.attemptId}`}>Chi tiết từng từ</h3>
    {needsRetry && <div className={styles.qualityNote}>
      <p>{hasWordColors ? `Đã tô màu các từ có đủ tín hiệu. Hãy ghi âm lại để đánh giá cả ${unit}.`
        : "Chưa đủ tín hiệu để tô màu từng từ. Hãy nghe lại và ghi âm lại."}</p>
      {attempt.assessment.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
    </div>}
    {mode === "limited_coverage" && <p className={styles.qualityNote}>Mới đánh giá được {(attempt.assessment.coverage * 100).toFixed(0)}% số âm tham chiếu. Các gợi ý bên dưới chỉ áp dụng cho phần đã chấm, chưa đủ để nhận xét toàn {unit}.</p>}
    <ul className={styles.sentence} aria-label="Điểm phát âm từng từ">{parts.map(({ text, wordIndex, feedback }) => {
      if (wordIndex === null || !feedback) return null;
      const score = scores.get(wordIndex);
      return <li key={wordIndex} className={`${styles.sentenceWord} ${pronunciationToneClasses[feedback.tone]}${feedback.partial ? ` ${styles.partialWord}` : ""}`}
        data-word-index={wordIndex} data-pronunciation-state={feedback.tone} title={`${feedback.label}. ${feedback.description}`}>
        <strong lang="en">{text}</strong><span>{score == null || (needsRetry && feedback.tone === "unassessed") ? "—" : `${score.toFixed(2)}/2`}</span>
        <span className={styles.srOnly}>{feedback.label}{feedback.partial ? ", chỉ chấm một phần" : ""}</span>
      </li>;
    })}</ul>
    <PronunciationLegend />
    <p className={styles.colorNote}>{needsRetry ? "Từ màu xám cần bản thu rõ hơn. Màu của các từ còn lại dựa trên âm có điểm thấp nhất." : "Màu dựa trên âm có điểm thấp nhất trong từ. Từ chỉ chấm được một phần có gạch dưới nét đứt; màu xanh chưa phải khẳng định phát âm đúng hoàn toàn."}</p>
    {targets.length === 0 ? <p className={styles.summary}>{needsRetry ? `Nghe lại bản ghi và ${unit} mẫu, sau đó đọc lại toàn bộ ${unit}.` : "Chưa có âm đã chấm nào dưới ngưỡng gợi ý luyện lại. Điều này chưa đánh giá các âm không được hỗ trợ."}</p> : targets.map(({ word, phone, phoneIndex, band }) => <article key={word.index} className={styles.target}>
      <span className={band === "practice" ? styles.tag : styles.listenTag}>{band === "practice" ? "Ưu tiên luyện" : "Nên nghe lại"} từ “{word.text}”</span>
      <ul>
        <li><strong>Vị trí:</strong> Từ thứ {word.index + 1}{unit === "cụm" ? " trong cụm" : ""} “{word.text}”{phone ? <>, tập trung âm /<span lang="en">{phone.symbol}</span>/ (âm thứ {phoneIndex + 1} trong phần được chấm).</> : "."}</li>
        <li><strong>Kết quả mô hình:</strong> {phone ? <>Âm /{phone.symbol}/ có điểm {phone.score.toFixed(2)}/2. {band === "practice" ? <>Dưới ngưỡng ưu tiên luyện {threshold.toFixed(2)}/2.</> : <>Ở vùng nên nghe lại và so sánh với mẫu, chưa đủ căn cứ kết luận sai.</>} Chưa xác định bạn thay âm hay bỏ âm.</> : "Chưa đủ dữ liệu để chỉ ra lỗi âm cụ thể."}</li>
        {word.reason && <li><strong>Phạm vi:</strong> {word.reason}</li>}
        <li><strong>Cách đọc tham khảo:</strong> {phone ? phoneGuidance(phone.sourcePhone) : "Nghe mẫu, đọc chậm từng phần của từ rồi ghép lại."}</li>
        <li><strong>Luyện tập:</strong> Nghe từ mẫu, đọc lại “{word.text}” vài lần, sau đó ghi âm lại {unit} để so sánh.</li>
      </ul>
      <button type="button" disabled={disabled} onClick={() => listen(word.text)}>▷ Nghe từ “{word.text}”</button>
      {wordAudioRange(word, attempt.assessment.durationSeconds) && <button type="button" disabled={disabled} onClick={() => onListenRecording(word)}>▷ Nghe bạn đọc “{word.text}”</button>}
    </article>)}
    <button type="button" disabled={disabled} onClick={() => listen(attempt.referenceText)}>▷ Nghe lại {unit} mẫu</button>
    <button type="button" disabled={disabled || !canRetry} onClick={onRetry}>● Ghi âm lại {unit} này</button>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
