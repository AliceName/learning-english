"use client";

import {useEffect, useId, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {adminRequest} from "@/lib/admin-courses";
import Icon from "@/components/site-icon";
import styles from "./admin.module.css";
import ui from "./question-import.module.css";

export type ImportedQuestion = {
  type: "multiple_choice" | "fill_blank";
  prompt: string;
  options: string[];
  correctOptionIndex: number | null;
  answer: string | null;
  explanation: string | null;
};
export type QuestionImportContext = {courseId: number; lessonId?: number};
type QuestionIdentity = Pick<ImportedQuestion, "prompt" | "options"> & {type: string};
type Candidate = {
  question: ImportedQuestion | null;
  source: {questionNumber: number; paragraphIndex: number; excerpt: string; tableAnswers: string[]};
  status: "ready" | "review" | "unsupported";
  issues: string[];
};
type ReviewRow = Candidate & {selected: boolean};
type Preview = {questions: Candidate[]; warnings: string[]};
type Props = {
  context: QuestionImportContext;
  skill: "reading" | "grammar";
  disabled: boolean;
  existing: QuestionIdentity[];
  onImport: (questions: ImportedQuestion[]) => void;
  passage?: string;
};
const maxQuestions = 30;
const maxFileBytes = 2 * 1024 * 1024;

function normalize(text: string) {
  return text.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

function questionKey(question: QuestionIdentity) {
  return JSON.stringify([question.type, normalize(question.prompt),
    question.type === "multiple_choice" ? question.options.map(normalize).sort() : []]);
}

function validQuestion(question: ImportedQuestion) {
  if (!question.prompt.trim() || question.prompt.length > 2000 || (question.explanation?.length ?? 0) > 2000) return false;
  if (question.type === "fill_blank")
    return question.prompt.split("[blank]").length === 2 && !!question.answer?.trim() && question.answer.length <= 500;
  return question.options.length >= 2 && question.options.length <= 4 &&
    question.options.every(option => !!option.trim() && option.length <= 500) &&
    new Set(question.options.map(normalize)).size === question.options.length &&
    question.correctOptionIndex !== null && Number.isInteger(question.correctOptionIndex) &&
    question.correctOptionIndex >= 0 && question.correctOptionIndex < question.options.length;
}

export default function QuestionImport(props: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={styles.secondaryButton}
      disabled={props.disabled || props.existing.length >= maxQuestions} onClick={() => setOpen(true)}>
      <Icon name="file"/>Nhập câu hỏi từ tệp
    </button>
    {open && createPortal(<ImportDialog {...props} onClose={() => setOpen(false)}/>, document.body)}
  </>;
}

function ImportDialog({context, skill, disabled, existing, passage, onImport, onClose}: Props & {onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const titleId = useId();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const slots = Math.max(0, maxQuestions - existing.length);
  const existingKeys = new Set(existing.map(questionKey));
  const picked = rows.flatMap(row => row.selected && row.question ? [row.question] : []);
  const pickedKeys = picked.map(questionKey);
  const hasDuplicates = new Set(pickedKeys).size !== pickedKeys.length || pickedKeys.some(key => existingKeys.has(key));
  const eligible = (row: ReviewRow) => row.question !== null && validQuestion(row.question) && !existingKeys.has(questionKey(row.question));
  const readyCount = rows.filter(row => eligible(row) && (row.status === "ready" || row.selected)).length;
  const unsupportedCount = rows.filter(row => row.question === null).length;

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    return () => activeRequest.current?.abort();
  }, []);

  async function preview(file: File) {
    activeRequest.current?.abort();
    setRows([]);
    setWarnings([]);
    setError("");
    setRetryFile(null);
    if (!file.name.toLowerCase().endsWith(".docx") || file.size === 0 || file.size > maxFileBytes) {
      setError("Chọn tệp Word .docx có nội dung và dung lượng tối đa 2 MB.");
      setLoading(false);
      return;
    }

    const request = new AbortController();
    activeRequest.current = request;
    const form = new FormData();
    form.set("file", file);
    form.set("skillType", skill);
    if (context.lessonId !== undefined) form.set("lessonId", String(context.lessonId));
    setLoading(true);
    try {
      const result = await adminRequest<Preview>("courses/" + context.courseId + "/question-import/preview",
        {method: "POST", body: form, signal: request.signal});
      if (request.signal.aborted) return;
      const used = new Set(existingKeys);
      let remaining = slots;
      setRows(result.questions.map(item => {
        const key = item.question && questionKey(item.question);
        const selected = !!key && item.status === "ready" && eligible({...item, selected: false}) && remaining > 0 && !used.has(key);
        if (selected) {
          used.add(key);
          remaining--;
        }
        return {...item, selected};
      }));
      setWarnings(result.warnings);
    } catch (failure) {
      if (!request.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Không đọc được tệp Word.");
        setRetryFile(file);
      }
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }

  function change(index: number, patch: Partial<ImportedQuestion>) {
    setRows(previous => previous.map((row, rowIndex) => {
      if (index !== rowIndex || !row.question) return row;
      const question = {...row.question, ...patch};
      return {...row, question, selected: row.selected && validQuestion(question) && !existingKeys.has(questionKey(question))};
    }));
  }

  const canImport = !disabled && !loading && picked.length > 0 && picked.length <= slots &&
    !hasDuplicates && picked.every(validQuestion);
  function addQuestions() {
    if (!canImport) return;
    onImport(picked.map(question => ({
      ...question,
      prompt: question.prompt.trim(),
      options: question.options.map(option => option.trim()),
      answer: question.answer?.trim() || null,
      explanation: question.explanation?.trim() || null,
    })));
    dialog.current?.close();
  }

  return <dialog ref={dialog} onClose={onClose} aria-labelledby={titleId} className={ui.dialog}>
    <header className={ui.header}>
      <div>
        <h2 id={titleId}>Nhập câu hỏi từ tệp</h2>
        <p>Chọn đề Word, rà soát đáp án rồi thêm câu vào bài đang soạn.</p>
      </div>
      <button type="button" className={styles.secondaryButton} onClick={() => dialog.current?.close()}>Đóng</button>
    </header>
    <div className={ui.body}>
      <div className={ui.fileRow}>
        <label className={styles.field}>Tệp Word (.docx, tối đa 2 MB)
          <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (file) void preview(file);
            }}/>
        </label>
        <a href="/templates/mau-nhap-cau-hoi.docx" download className={styles.secondaryButton}>Tải mẫu Word</a>
      </div>
      {loading && <p role="status">Đang đọc câu hỏi…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {retryFile && <button type="button" className={styles.secondaryButton} disabled={disabled || loading}
        onClick={() => void preview(retryFile)}>Thử lại với tệp này</button>}
      {warnings.map(warning => <p key={warning} className={ui.warning}>{warning}</p>)}
      {rows.length > 0 && <>
        {skill === "reading" && <details className={ui.passage}>
          <summary>Đối chiếu bài đọc hiện tại</summary>
          <p>{passage?.trim() || "Bài này chưa có đoạn đọc. Hãy bổ sung đoạn đọc tương ứng trong trình soạn."}</p>
        </details>}
        <div className={ui.countRow}>
          <p role="status">{readyCount} sẵn sàng · {rows.length - readyCount - unsupportedCount} cần kiểm tra · {unsupportedCount} không hỗ trợ</p>
          <button type="button" className={styles.secondaryButton} disabled={picked.length === 0}
            onClick={() => setRows(previous => previous.map(row => ({...row, selected: false})))}>Bỏ chọn tất cả</button>
        </div>
        {rows.map((row, index) => {
          const question = row.question;
          const duplicate = question !== null && existingKeys.has(questionKey(question));
          const ready = eligible(row) && (row.status === "ready" || row.selected);
          return <article className={ui.candidate} key={index}>
            <div className={ui.candidateTitle}>
              <label>
                <input type="checkbox" checked={row.selected} disabled={disabled || !eligible(row)}
                  onChange={event => {
                    const selected = event.currentTarget.checked;
                    setRows(previous => previous.map((item, position) => position === index ? {...item, selected} : item));
                  }}/>
                <strong>Câu {row.source.questionNumber}</strong>
                <span className={ui.sourceLabel}>Đoạn {row.source.paragraphIndex}</span>
              </label>
              <span className={ready ? ui.ready : ui.status}>{!question ? "Không hỗ trợ" : ready ? "Sẵn sàng" : "Cần kiểm tra"}</span>
            </div>
            {question && <p className={ui.prompt}>{question.prompt || "Thiếu nội dung câu hỏi"}</p>}
            {duplicate && <p className={ui.warning}>Câu này đã có trong bài.</p>}
            {row.issues.length > 0 && <ul className={ui.issues}>{row.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
            <details className={ui.details}>
              <summary>{question ? "Đối chiếu và sửa" : "Xem nội dung nguồn"}</summary>
              <pre className={ui.source}>{row.source.excerpt}</pre>
              {row.source.tableAnswers.length > 0 && <p>Đáp án trong bảng cuối đề: {row.source.tableAnswers.map(answer => answer || "(trống)").join(", ")}</p>}
              {question && <div className={ui.fields}>
                <label className={styles.field}>Nội dung câu hỏi
                  <textarea rows={2} maxLength={2000} value={question.prompt} disabled={disabled}
                    onChange={event => change(index, {prompt: event.target.value})}/>
                </label>
                {question.type === "multiple_choice" ? <>
                  {question.options.map((option, position) => <label className={styles.field} key={position}>
                    Lựa chọn {String.fromCharCode(65 + position)}
                    <input maxLength={500} value={option} disabled={disabled}
                      onChange={event => change(index, {options: question.options.map((value, i) => i === position ? event.target.value : value)})}/>
                  </label>)}
                  {question.options.length < 4 && <button type="button" className={styles.secondaryButton} disabled={disabled}
                    onClick={() => change(index, {options: [...question.options, ""]})}>Thêm lựa chọn</button>}
                  <label className={styles.field}>Đáp án đúng
                    <select value={question.correctOptionIndex ?? ""} disabled={disabled}
                      onChange={event => change(index, {correctOptionIndex: event.target.value === "" ? null : Number(event.target.value)})}>
                      <option value="">Chọn đáp án</option>
                      {question.options.map((option, position) => <option key={position} value={position}>{String.fromCharCode(65 + position)}. {option}</option>)}
                    </select>
                  </label>
                </> : <label className={styles.field}>Đáp án điền từ
                  <input maxLength={500} value={question.answer ?? ""} disabled={disabled}
                    onChange={event => change(index, {answer: event.target.value})}/>
                </label>}
                <label className={styles.field}>Giải thích
                  <textarea rows={2} maxLength={2000} value={question.explanation ?? ""} disabled={disabled}
                    onChange={event => change(index, {explanation: event.target.value})}/>
                </label>
                {!validQuestion(question) && <p className={ui.warning}>Hoàn thiện nội dung và đáp án để chọn câu này.</p>}
              </div>}
            </details>
          </article>;
        })}
      </>}
      {hasDuplicates && <p className={styles.error} role="alert">Danh sách đã chọn có câu trùng. Hãy bỏ chọn hoặc sửa câu trùng.</p>}
      {picked.length > slots && <p className={styles.error} role="alert">Bài học chỉ còn {slots} chỗ. Hãy bỏ bớt câu đã chọn.</p>}
    </div>
    <footer className={ui.footer}>
      <span>Đã chọn {picked.length} · Còn {slots} chỗ trong bài</span>
      <button type="button" className={styles.primaryButton} disabled={!canImport} onClick={addQuestions}>
        Thêm {picked.length > 0 ? picked.length + " câu đã chọn" : "câu đã chọn"}
      </button>
    </footer>
  </dialog>;
}
