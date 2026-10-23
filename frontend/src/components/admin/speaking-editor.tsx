"use client";

import {useEffect, useId, useLayoutEffect, useRef, useState} from "react";
import {adminRequest, type GeneratedIpa, type Sentence, type Speaking} from "@/lib/admin-courses";
import Icon from "@/components/site-icon";
import MediaField from "./media-field";
import styles from "./admin.module.css";

type SentenceProps = {
  value: Sentence;
  index: number;
  disabled: boolean;
  onChange: (change: Partial<Sentence>, expectedText?: string) => void;
  onRemove: () => void;
  onBusy: (key: string, value: boolean) => void;
};

function SentenceEditor({value, index, disabled, onChange, onRemove, onBusy}: SentenceProps) {
  const id = useId();
  const abort = useRef<AbortController | null>(null);
  const latest = useRef({value, disabled, onChange});
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<GeneratedIpa | null>(null);
  const [error, setError] = useState("");
  useLayoutEffect(() => { latest.current = {value, disabled, onChange}; });
  useEffect(() => () => {
    const request = abort.current;
    abort.current = null;
    request?.abort();
  }, []);

  function cancel() {
    abort.current?.abort();
    abort.current = null;
    setPending(false);
  }

  async function generate() {
    if (disabled || !value.text.trim() || abort.current) return;
    const source = value.text;
    const previousIpa = value.ipa;
    const controller = new AbortController();
    abort.current = controller;
    setPending(true);
    setError("");
    setResult(null);
    try {
      const response = await adminRequest<GeneratedIpa>("pronunciation/ipa", {
        method: "POST", body: JSON.stringify({text: source}), signal: controller.signal,
      });
      // Editing text/IPA, deleting a sentence, or switching lessons invalidates the in-flight result.
      if (controller.signal.aborted || latest.current.value.text !== source || latest.current.value.ipa !== previousIpa || latest.current.disabled) return;
      setResult(response);
      if (response.ipa) latest.current.onChange({ipa: response.ipa}, source);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Chưa thể tạo IPA. Hãy thử lại.");
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setPending(false);
      }
    }
  }

  return <div className={styles.exerciseCard}>
    <div className={styles.exerciseHeading}>
      <span className={styles.exerciseNumber}>{index + 1}</span><strong>Câu luyện nói {index + 1}</strong>
      <button type="button" className={styles.iconButton} disabled={disabled} aria-label={`Xóa câu luyện nói ${index + 1}`} onClick={onRemove}><Icon name="trash"/></button>
    </div>
    <div className={styles.twoColumns}>
      <label className={styles.field}>Văn bản tiếng Anh <em>*</em>
        <textarea required value={value.text} onChange={event => {
          cancel(); setResult(null); setError("");
          onChange({text: event.target.value, ipa: null});
        }} onBlur={() => { if (!value.ipa?.trim()) void generate(); }} rows={3} maxLength={1000} disabled={disabled} placeholder="Could you tell me how to get to the library?"/>
      </label>
      <div className={styles.field}>
        <div className={styles.ipaLabel}><label htmlFor={`${id}-ipa`}>Phiên âm IPA · Mỹ</label>
          <button type="button" className={styles.ipaButton} disabled={disabled || pending || !value.text.trim()} onMouseDown={event => event.preventDefault()} onClick={() => void generate()}>
            {pending ? "Đang tạo…" : value.ipa ? "Tạo lại IPA" : "Tạo IPA"}
          </button>
        </div>
        <textarea id={`${id}-ipa`} value={value.ipa ?? ""} onChange={event => {
          cancel(); setResult(null); setError(""); onChange({ipa: event.target.value});
        }} rows={3} maxLength={8000} disabled={disabled} aria-busy={pending} aria-describedby={`${id}-status`} placeholder="Tự động điền sau khi nhập câu tiếng Anh"/>
      </div>
    </div>
    <div id={`${id}-status`} aria-live="polite">
      {error && <p className={styles.error}>{error}</p>}
      {result && !result.ipa && <p className={styles.notice}>{result.unknownWords.length > 0
        ? `Chưa có cách đọc cho: ${result.unknownWords.join(", ")}. Kiểm tra chính tả; tên riêng và số có thể cần viết lại bằng chữ hoặc bổ sung IPA. Bạn vẫn có thể lưu nháp.`
        : "Nhập ít nhất một từ tiếng Anh để tạo IPA."}</p>}
      {result?.ipa && <p className={styles.hint}>Đã tạo IPA gợi ý. Bạn có thể chỉnh sửa trước khi lưu.</p>}
    </div>
    {!!result?.alternatives.length && <details className={styles.ipaAlternatives}>
      <summary>Các cách đọc khác trong từ điển</summary>
      <p>Chọn cách đọc phù hợp với nghĩa trong câu; hệ thống đang dùng cách đọc đầu tiên.</p>
      {result.alternatives.map(item => <p key={item.word}><strong>{item.word}</strong>: {item.pronunciations.join(" · ")}</p>)}
    </details>}
    <MediaField kind="audio" label={`Audio mẫu câu ${index + 1} (không bắt buộc)`} value={value.audioUrl}
      onChange={audioUrl => onChange({audioUrl})} onBusy={busy => onBusy(`audio-${id}`, busy)} disabled={disabled}/>
  </div>;
}

export default function SpeakingEditor({value, onChange, onBusy, disabled}: {
  value: Speaking;
  onChange: (value: Speaking | ((previous: Speaking) => Speaking)) => void;
  onBusy: (key: string, value: boolean) => void;
  disabled: boolean;
}) {
  // Stable local keys keep async results attached to their sentence when an earlier sentence is removed.
  const [sentenceIds, setSentenceIds] = useState(() => value.sentences.map((_, index) => index));
  const nextId = useRef(value.sentences.length);
  function update(index: number, change: Partial<Sentence>, expectedText?: string) {
    onChange(previous => ({...previous, sentences: previous.sentences.map((item, itemIndex) =>
      itemIndex === index && (expectedText === undefined || item.text === expectedText) ? {...item, ...change} : item)}));
  }
  function remove(index: number) {
    setSentenceIds(previous => previous.filter((_, itemIndex) => itemIndex !== index));
    onChange(previous => ({...previous, sentences: previous.sentences.filter((_, itemIndex) => itemIndex !== index)}));
  }
  function add() {
    const id = nextId.current++;
    setSentenceIds(previous => [...previous, id]);
    onChange(previous => ({...previous, sentences: [...previous.sentences, {text: "", ipa: null, audioUrl: null}]}));
  }
  return <>
    <section className={styles.panel}>
      <div className={styles.sectionHeader}><span className={styles.sectionIcon}><Icon name="compass"/></span><div><h2>Khối 1: Mục tiêu luyện phát âm</h2><p>Hướng dẫn ngắn gọn cho học viên trước khi luyện nói.</p></div></div>
      <label className={styles.field}>Mục tiêu luyện nói<textarea value={value.goals} onChange={event => onChange(previous => ({...previous, goals: event.target.value}))} maxLength={3000} rows={3} placeholder="Ví dụ: Luyện âm cuối, nối âm và ngữ điệu trong câu hỏi…" disabled={disabled}/></label>
    </section>
    <section className={styles.panel}>
      <div className={styles.sectionHeader}><span className={styles.sectionIcon}><Icon name="mic"/></span><div><h2>Khối 2: Câu tiếng Anh mẫu luyện nói</h2><p>{value.sentences.length}/30 câu · IPA tự động, audio mẫu tùy chọn.</p></div></div>
      <p className={styles.hint}>Nhập câu tiếng Anh rồi chuyển sang ô khác để tự tạo IPA. Phiên âm gợi ý theo từ điển Mỹ; từ đồng tự khác âm và nối âm cần kiểm tra theo ngữ cảnh.</p>
      {value.sentences.length === 0 && <p className={styles.hint}>Chưa có câu luyện nói. Thêm câu để bắt đầu biên soạn.</p>}
      {value.sentences.map((sentence, index) => <SentenceEditor key={sentenceIds[index]} value={sentence} index={index} disabled={disabled}
        onChange={(patch, expectedText) => update(index, patch, expectedText)} onRemove={() => remove(index)} onBusy={onBusy}/>)}
      <button type="button" className={styles.addButton} disabled={disabled || value.sentences.length >= 30} onClick={add}><Icon name="plus"/>Thêm câu luyện nói mới</button>
    </section>
  </>;
}
