"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/site-icon";
import BearMascot from "./bear-mascot";
import styles from "./landing.module.css";

export type SkillId = "speaking" | "reading" | "writing" | "listening" | "grammar";
const sentence = "Could I get a flat white with oat milk?";
const listeningSentence = "Please clarify this idea.";

function SampleAudio({ text, rate = 1, disabled = false }: { text: string; rate?: number; disabled?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState("");
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => () => {
    if (utterance.current) {
      utterance.current.onend = null;
      utterance.current.onerror = null;
      window.speechSynthesis?.cancel();
    }
  }, []);

  function play() {
    if (!("speechSynthesis" in window)) {
      setMessage("Thiết bị chưa hỗ trợ đọc câu mẫu. Bạn có thể luyện theo câu phía trên.");
      return;
    }
    window.speechSynthesis.cancel();
    if (playing) { setPlaying(false); return; }
    const sample = new SpeechSynthesisUtterance(text);
    sample.lang = "en-US";
    sample.rate = rate;
    sample.voice = window.speechSynthesis.getVoices().find(voice => voice.lang === "en-US") ?? null;
    sample.onend = () => { setPlaying(false); utterance.current = null; };
    sample.onerror = event => {
      setPlaying(false);
      utterance.current = null;
      if (!["canceled", "interrupted"].includes(event.error)) setMessage("Chưa thể phát câu mẫu. Hãy kiểm tra giọng đọc của thiết bị và thử lại.");
    };
    utterance.current = sample;
    setMessage("");
    setPlaying(true);
    window.speechSynthesis.speak(sample);
  }

  return <div className={styles.sampleAudio}>
    <button type="button" onClick={play} disabled={disabled} aria-pressed={playing}><Icon name={playing ? "pause" : "volume"} />{playing ? "Dừng câu mẫu" : "Nghe câu mẫu"}</button>
    <span role="status">{message}</span>
  </div>;
}

function Wave({ large = false }: { large?: boolean }) {
  return <div className={`${styles.wave} ${large ? styles.largeWave : ""}`} aria-hidden="true">{[12, 23, 34, 18, 28, 38, 22, 30, 16, 26, 36, 20, 32, 15, 25].map((height, i) => <i key={i} style={{ height, animationDelay: `${i * .08}s` }} />)}</div>;
}

export default function SkillPreview({ skill, active }: { skill: SkillId; active: boolean }) {
  const [definition, setDefinition] = useState(true);
  const [readingAnswer, setReadingAnswer] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [rate, setRate] = useState(1);
  const [listeningAnswer, setListeningAnswer] = useState("");
  const [checkedListening, setCheckedListening] = useState(false);
  const [grammarAnswer, setGrammarAnswer] = useState<string | null>(null);

  if (skill === "speaking") return <>
    <div className={styles.coachRow}>
      <div className={styles.coachIdentity}><BearMascot compact /><div><strong>LEWA Coach</strong><small>Luyện phát âm mỗi ngày</small></div></div>
      <div><Wave /><p className={styles.phonetics} lang="en">/kʊd aɪ ɡet ə flæt waɪt/</p></div>
    </div>
    <div className={styles.previewBox}>
      <div className={styles.boxHeading}><strong><Icon name="mic" />Câu giao tiếp mẫu</strong><span className={styles.good}>Luyện theo ngữ điệu</span></div>
      <blockquote lang="en">&ldquo;{sentence}&rdquo;</blockquote>
      <div className={styles.wordTags}><span>flat white /flæt waɪt/</span><span>oat milk /oʊt mɪlk/</span></div>
    </div>
    <SampleAudio key={String(active)} text={sentence} disabled={!active} />
  </>;

  if (skill === "reading") return <>
    <div className={styles.previewBox}>
      <div className={styles.boxHeading}><strong>Công nghệ xanh · B2+</strong><span>Chạm từ để tra nghĩa</span></div>
      <p className={styles.readingText} lang="en">Renewable energy has seen an <button type="button" aria-expanded={definition} aria-controls="reading-definition" onClick={() => setDefinition(!definition)}>unprecedented ⓘ</button> surge in investment.</p>
      {definition && <div id="reading-definition" className={styles.definition}><div><strong lang="en">unprecedented</strong><span lang="en">/ʌnˈpres.ə.den.tɪd/</span></div><p>Chưa từng có tiền lệ. <small>(Tính từ C1)</small></p></div>}
    </div>
    <div className={`${styles.previewBox} ${styles.readingQuiz}`}>
      <strong className={styles.question}>Ý chính của đoạn văn là gì?</strong>
      <div className={styles.answers}>{["Năng lượng tái tạo tăng kỷ lục", "Đầu tư năng lượng giảm"].map((answer, i) => <button key={answer} type="button" aria-pressed={readingAnswer === answer} data-result={readingAnswer === answer ? i === 0 ? "correct" : "incorrect" : undefined} onClick={() => setReadingAnswer(answer)}>{i === 0 ? "A" : "B"}. {answer}</button>)}</div>
      {readingAnswer && <p className={styles.feedback} role="status">{readingAnswer === "Năng lượng tái tạo tăng kỷ lục" ? "Chính xác! Đầu tư đang tăng mạnh." : "Thử lại nhé: “surge” nghĩa là tăng mạnh."}</p>}
    </div>
  </>;

  if (skill === "writing") return <>
    <div className={styles.previewBox}>
      <div className={styles.boxHeading}><strong><Icon name="writing" />Bản xem trước minh họa</strong><span>{applied ? "Đã chọn gợi ý minh họa" : "Gợi ý không phải điểm CEFR/IELTS"}</span></div>
      <p className={styles.editor} lang="en">Technology <del>bring</del> <ins>brings</ins> benefits. We can {applied ? <ins>acquire in-depth knowledge</ins> : <mark>get more knowledge</mark>} online.</p>
      <div className={styles.suggestion}><Icon name="sparkles" /><p><strong lang="en">acquire in-depth knowledge</strong></p><button type="button" disabled={applied} onClick={() => setApplied(true)}>{applied ? "Đã chọn" : "Thử chọn gợi ý"}</button></div>
    </div>
    <p className={styles.feedback} role="status">{applied ? "Đây là thao tác trên câu mẫu, không phải đánh giá năng lực viết." : "Câu và gợi ý trên trang chủ là nội dung minh họa."}</p>
  </>;

  if (skill === "listening") return <>
    <div className={styles.previewBox}>
      <div className={styles.boxHeading}><strong><Icon name="headphones" />Giao tiếp công việc</strong><span>English audio</span></div>
      <Wave large />
      <div className={styles.playerRow}><SampleAudio key={`${active}-${rate}`} text={listeningSentence} rate={rate} disabled={!active} /><div className={styles.rates} aria-label="Tốc độ nghe">{[.75, 1, 1.25].map(speed => <button key={speed} type="button" aria-pressed={rate === speed} onClick={() => setRate(speed)}>{speed.toFixed(speed === 1 ? 1 : 2)}x</button>)}</div></div>
    </div>
    <div className={styles.previewBox}><strong className={styles.question}>Điền từ còn thiếu:</strong>
      <form className={styles.listeningQuiz} onSubmit={event => { event.preventDefault(); setCheckedListening(true); }}>
        <label htmlFor="listening-word" lang="en">Please <input id="listening-word" name="word" aria-label="Từ còn thiếu trong câu nghe" autoComplete="off" value={listeningAnswer} onChange={event => { setListeningAnswer(event.target.value); setCheckedListening(false); }} placeholder="…" maxLength={40} /> this idea.</label>
        <button type="submit"><Icon name="check" />Kiểm tra</button>
      </form>
      {checkedListening && <p className={styles.feedback} role="status">{listeningAnswer.trim().toLowerCase() === "clarify" ? "Đúng rồi! “Clarify” là làm rõ." : "Nghe lại nhé. Từ cần điền nghĩa là “làm rõ”."}</p>}
    </div>
  </>;

  return <>
    <div className={`${styles.previewBox} ${styles.grammarOverview}`}><strong className={styles.question}><Icon name="brain" />Các cấu trúc đảo ngữ</strong>
      <div className={styles.mindmap}>{[["Hardly … when", "Hardly had I arrived when it rained."], ["Not only … but also", "Not only did she sing, but she also danced."], ["Only by + V-ing", "Only by practicing can you succeed."]].map(([rule, example]) => <div key={rule}><strong lang="en">{rule}</strong><p lang="en">{example}</p></div>)}</div>
    </div>
    <div className={styles.previewBox}><strong className={styles.question}>Câu hỏi thực tế: <span lang="en">Not until yesterday _______ the truth.</span></strong>
      <div className={styles.answers}>{["did he know", "he knew"].map((answer, i) => <button key={answer} type="button" lang="en" aria-pressed={grammarAnswer === answer} data-result={grammarAnswer === answer ? i === 0 ? "correct" : "incorrect" : undefined} onClick={() => setGrammarAnswer(answer)}>{answer}</button>)}</div>
      <p className={styles.feedback} role="status">{grammarAnswer ? `${grammarAnswer === "did he know" ? "Chính xác!" : "Chưa đúng."} Sau “Not until”, đảo trợ động từ lên trước chủ ngữ.` : "Chọn đáp án để xem giải thích."}</p>
    </div>
  </>;
}
