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
      aria-label={`Xem gợi ý ${edit.suggestionIndex + 1}: ${fragment.trim() || visibleEdit(fragment) || (draft ? "đã xóa" : edit.after)}`}
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
  const coverage = result.gecCoverage && writingCoverageSummary(result.gecCoverage);
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
    <section className={styles.summarySection} aria-labelledby="writing-summary-heading">
      <div className={styles.sectionHeading}>
        <span className={`${styles.icon} ${styles.primaryIcon}`}><Icon name="trend" /></span>
        <h2 id="writing-summary-heading">Đánh giá bài đã nộp</h2>
      </div>
      <div className={styles.studioSummary}>
        <article className={styles.cefrCard}>
          <h3>CEFR ước lượng</h3>
          <strong>{result.cefrLevel || "Chưa có"}</strong>
          <p>Mức ngôn ngữ của bài gốc</p>
        </article>
        <article><h3>CEFR mục tiêu khi nộp</h3>
          <strong>{result.targetRecorded ? result.targetCefr ?? "Chưa đặt" : "Chưa được ghi"}</strong>
        </article>
        <article>
          <h3>Gợi ý chỉnh sửa</h3>
          <strong>{result.correctedText !== null ? result.errors.length : "Chưa phân tích"}</strong>
          <p>{result.correctedText !== null ? "Số câu có gợi ý ngữ pháp" : "Lần nộp này chỉ có ước lượng CEFR"}</p>
        </article>
        {coverage && result.gecCoverage && <article>
          <h3>Phạm vi xử lý GEC</h3>
          <strong>{coverage.completed}/{result.gecCoverage.totalBodySentences} câu</strong>
          <p>Đã sinh hoàn tất, trong đó {coverage.rejected} câu có gợi ý bị chặn.</p>
          <p>Chưa xử lý hoặc chưa hoàn tất: {coverage.unprocessed} câu
            ({result.gecCoverage.inputOverBudget} quá dài, {result.gecCoverage.incomplete} sinh chưa hoàn tất,
            {" "}{result.gecCoverage.sentenceLimit} ngoài giới hạn 20 câu).</p>
        </article>}
      </div>
      <p className={styles.hint}>CEFR chỉ ước lượng trình độ ngôn ngữ. Độ bám đề cần được tự kiểm tra.</p>
    </section>
  </>;
}
