import { Fragment } from "react";
import Icon from "@/components/site-icon";
import { type WritingResult, writingCoverageSummary } from "@/lib/writing";
import { type WritingDiff } from "@/lib/writing-diff";
import { type WritingEdit, currentEditPosition } from "@/lib/writing-revision";
import styles from "./writing.module.css";

export function visibleEdit(text: string) {
  return text.trim() ? text : text.replace(/\r\n|\r|\n/g, "↵").replace(/\t/g, "⇥").replace(/ /g, "␣");
}

export function DiffText({ diff }: { diff: WritingDiff }) {
  return <>{diff.parts.map((part, index) => {
    if (part.kind === "equal") return <Fragment key={index}>{part.text}</Fragment>;
    if (!diff.detailed) return <Fragment key={index}>{part.before}</Fragment>;
    return <span key={index} className={styles.inlineEdit}>
      {part.before && <del className={styles.diffRemoved}>{visibleEdit(part.before)}</del>}
      {part.before && part.after && <span aria-label="thay bằng"> → </span>}
      {part.after && <ins className={styles.diffAdded}>{visibleEdit(part.after)}</ins>}
    </span>;
  })}</>;
}

function LinkedEdits({ text, edits, accepted, visibleIds, draft = false, onSelect }: {
  text: string; edits: WritingEdit[]; accepted: string[]; visibleIds: ReadonlySet<string>; draft?: boolean; onSelect: (id: string) => void;
}) {
  const visible = edits.filter(edit => visibleIds.has(edit.id) && (!draft || accepted.includes(edit.id)));
  const parts = [];
  let cursor = 0;
  for (const edit of visible) {
    const { start, end } = draft ? currentEditPosition(edit, edits, accepted) : edit;
    const before = text.slice(cursor, start);
    const fragment = text.slice(start, end);
    cursor = end;
    parts.push(<Fragment key={edit.id}>{before}<button type="button"
      className={`${styles.annotation} ${draft ? styles.diffAdded : styles.diffRemoved}`}
      aria-label={`Xem gợi ý ${edit.suggestionIndex + 1}: ${fragment.trim() || visibleEdit(fragment) || (draft ? "đã xóa" : "chỗ có thể cần thêm từ")}`}
      data-review-id={edit.id}
      onClick={() => onSelect(edit.id)}>{fragment || (draft ? "−" : "＋")}</button></Fragment>);
  }
  return <>{parts}{text.slice(cursor)}</>;
}

export default function WritingComparison({ result, draft, draftPositionsKnown, edits, accepted, visibleIds, showAnnotations, onSelect, onEdit, editDisabled, continued }: {
  result: WritingResult; draft: string; draftPositionsKnown: boolean; continued?: boolean;
  edits: WritingEdit[]; accepted: string[]; visibleIds: ReadonlySet<string>;
  showAnnotations: boolean; onSelect: (id: string) => void; onEdit: () => void; editDisabled: boolean;
}) {
  return <>
    <section aria-label="Đối chiếu bài viết">
      {showAnnotations && edits.some(edit => visibleIds.has(edit.id)) && <p className={styles.annotationHint}>
        Chọn phần được tô để mở thẻ gợi ý tương ứng.
      </p>}
      {showAnnotations && !draftPositionsKnown && accepted.some(id => visibleIds.has(id))
        && <p className={styles.hint}>Bản nháp có chỉnh sửa riêng nên vị trí gợi ý chỉ được đánh dấu trên bài gốc.</p>}
      <div className={styles.studioCompare}>
        <article className={styles.essayCard}>
          <header>
            <span className={styles.icon}><Icon name="clipboard" /></span>
            <h2>Bản gốc của bạn</h2>
            <span className={styles.pill}>{result.originalText.trim().split(/\s+/u).filter(Boolean).length} từ</span>
          </header>
          <p lang="en">{showAnnotations ? <LinkedEdits text={result.originalText} edits={edits} accepted={accepted} visibleIds={visibleIds} onSelect={onSelect} /> : result.originalText}</p>
        </article>
        <article className={styles.essayCard}>
          <header>
            <span className={`${styles.icon} ${styles.primaryIcon}`}><Icon name="writing" /></span>
            <h2>Bản nháp chỉnh sửa</h2>
            <span className={styles.pill}>{draft === result.originalText ? "Trùng bản gốc" : "Đã chỉnh sửa"}</span>
          </header>
          {draft || (showAnnotations && draftPositionsKnown && accepted.some(id => visibleIds.has(id)))
            ? <p lang="en">{showAnnotations && draftPositionsKnown
              ? <LinkedEdits text={draft} edits={edits} accepted={accepted} visibleIds={visibleIds} draft onSelect={onSelect} />
              : draft}</p> : <p>Bản nháp đang trống.</p>}
          <footer><button type="button" className={styles.secondaryButton} onClick={onEdit} disabled={editDisabled}><Icon name="writing" /> {continued ? "Chỉnh sửa bản nháp" : "Tiếp tục từ phiên bản này"}</button></footer>
        </article>
      </div>
    </section>
  </>;
}

/** Result summary shown first: language level, task relevance status and unchecked sentences. */
export function WritingSummary({ result }: { result: WritingResult }) {
  const coverage = result.gecCoverage && writingCoverageSummary(result.gecCoverage);
  const requirements = result.task?.requirements ?? [];
  return <section className={styles.summarySection} aria-labelledby="writing-summary-heading">
    <div className={styles.sectionHeading}>
      <span className={`${styles.icon} ${styles.primaryIcon}`}><Icon name="trend" /></span>
      <h2 id="writing-summary-heading">Đánh giá bài đã nộp</h2>
    </div>
    <div className={styles.studioSummary}>
      <article className={styles.cefrCard}>
        <h3>CEFR ước lượng</h3>
        <strong>{result.cefrLevel || "Chưa có"}</strong>
        <p>Mức ngôn ngữ của bài viết{result.targetRecorded && result.targetCefr ? ` · mục tiêu khi nộp ${result.targetCefr}` : ""}</p>
      </article>
      <article>
        <h3>Gợi ý chỉnh sửa</h3>
        <strong>{result.correctedText !== null ? result.errors.length : "Không bật"}</strong>
        <p>{result.correctedText !== null ? "Số câu có gợi ý ngữ pháp" : "Lần nộp này chỉ có ước lượng CEFR"}</p>
      </article>
      <article>
        <h3>Bám đề</h3>
        <strong>Chưa đánh giá</strong>
        <p>LEWA chưa chấm được bài có trả lời đúng đề hay không.{requirements.length > 0 && " Hãy tự đối chiếu:"}</p>
        {requirements.length > 0 && <ul className={styles.summaryList}>{requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul>}
      </article>
      {coverage && coverage.unprocessed > 0 && <article>
        <h3>Câu chưa được kiểm tra</h3>
        <strong>{coverage.unprocessed} câu</strong>
        <p>Quá dài hoặc vượt giới hạn 20 câu mỗi lượt. Hãy tự rà soát các câu này.</p>
      </article>}
    </div>
    <p className={styles.hint}>CEFR ước lượng mức ngôn ngữ của bài viết, không phải của bạn, và không xét bài có đúng đề hay không. Đề ngắn, đơn giản có ít chỗ thể hiện cấu trúc phức tạp nên thường khó đạt mức cao.</p>
  </section>;
}
