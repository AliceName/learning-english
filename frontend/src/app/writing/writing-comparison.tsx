import { Fragment } from "react";
import Icon from "@/components/site-icon";
import { type WritingRelevance, type WritingResult, writingCoverageSummary } from "@/lib/writing";
import { type WritingDiff } from "@/lib/writing-diff";
import { type WritingEdit, currentEditPosition } from "@/lib/writing-revision";
import type { SentenceShade } from "@/lib/writing-practice";
import { InfoTip } from "./info-tip";
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

const shadeClass = { pending: "shadePending", fixed: "shadeFixed", skipped: "shadeSkipped" } as const;
const shadeTitle = { pending: "Câu này có gợi ý cần xem", fixed: "Bạn đã sửa câu này; nộp lại để AI kiểm tra", skipped: "Bạn đã bỏ qua gợi ý ở câu này" };
const markClass = { pending: "markPending", accepted: "markFixed", selfFixed: "markFixed", skipped: "markSkipped" } as const;

/**
 * Original essay with Write & Improve-style sentence shading. Each suggested sentence shows its
 * state (needs review / fixed, waiting for re-check / skipped) and a "?" button that explains why;
 * revealed word-level changes are coloured by the learner's decision. Sentences rewritten since
 * the previous version that now have no suggestion are marked as improved.
 */
function ShadedOriginal({ text, shades, improved, edits, visibleIds, statusById, onSelect, onSentence }: {
  text: string; shades: readonly SentenceShade[]; improved: readonly { start: number; end: number }[]; edits: WritingEdit[];
  visibleIds: ReadonlySet<string>; statusById: ReadonlyMap<string, keyof typeof markClass>; onSelect: (id: string) => void;
  onSentence: (suggestionIndex: number) => void;
}) {
  const marks = (from: number, to: number) => {
    const inside = edits.filter(edit => visibleIds.has(edit.id) && edit.start >= from && edit.end <= to);
    const parts = [];
    let cursor = from;
    for (const edit of inside) {
      const fragment = text.slice(edit.start, edit.end);
      const status = statusById.get(edit.id) ?? "pending";
      parts.push(<Fragment key={edit.id}>{text.slice(cursor, edit.start)}<button type="button"
        className={`${styles.annotation} ${styles[markClass[status]]}`}
        aria-label={`Xem gợi ý ${edit.suggestionIndex + 1}: ${fragment.trim() || visibleEdit(fragment) || "chỗ có thể cần thêm từ"}`}
        data-review-id={edit.id} onClick={() => onSelect(edit.id)}>{fragment || "＋"}</button></Fragment>);
      cursor = edit.end;
    }
    return <>{parts}{text.slice(cursor, to)}</>;
  };
  const regions = [...shades.map(shade => ({ ...shade, improved: false })),
    ...improved.map(span => ({ ...span, improved: true, suggestionIndex: -1, state: "fixed" as const }))].sort((x, y) => x.start - y.start);
  const parts = [];
  let cursor = 0;
  for (const region of regions) {
    if (region.start < cursor) continue;
    parts.push(<Fragment key={region.start}>{marks(cursor, region.start)}{region.improved
      ? <span className={styles.shadeImproved} title="Đã cải thiện so với bản trước: AI không còn gợi ý ở câu này">{text.slice(region.start, region.end)}</span>
      : <span className={styles[shadeClass[region.state]]} title={shadeTitle[region.state]}>
        <button type="button" className={styles.sentenceInfo} aria-label={`Vì sao câu ${region.suggestionIndex + 1} cần xem`}
          onClick={() => onSentence(region.suggestionIndex)}>?</button>{marks(region.start, region.end)}</span>}</Fragment>);
    cursor = region.end;
  }
  return <>{parts}{marks(cursor, text.length)}</>;
}

export default function WritingComparison({ result, draft, draftPositionsKnown, edits, accepted, visibleIds, shades = [], improved = [],
  statusById = new Map(), onSentence = () => {}, showAnnotations, onSelect, onEdit, editDisabled, continued }: {
  result: WritingResult; draft: string; draftPositionsKnown: boolean; continued?: boolean;
  edits: WritingEdit[]; accepted: string[]; visibleIds: ReadonlySet<string>; shades?: readonly SentenceShade[];
  improved?: readonly { start: number; end: number }[]; statusById?: ReadonlyMap<string, "pending" | "accepted" | "selfFixed" | "skipped">;
  onSentence?: (suggestionIndex: number) => void;
  showAnnotations: boolean; onSelect: (id: string) => void; onEdit: () => void; editDisabled: boolean;
}) {
  return <>
    <section aria-label="Đối chiếu bài viết">
      {showAnnotations && (shades.length > 0 || improved.length > 0) && <p className={styles.shadeLegend}>
        Cách đọc màu<InfoTip kind="help" label="Chú giải màu và gạch chân">
          <span><b>Vàng</b>: câu cần xem — bấm <b>?</b> để biết vì sao.</span>
          <span><b>Gạch chéo xanh</b>: đã sửa, nộp lại để AI kiểm tra.</span>
          <span><b>Viền chấm</b>: đã bỏ qua.</span>
          {improved.length > 0 && <span><b>Xanh lá</b>: đã cải thiện so với bản trước.</span>}
          <span><b>Từ gạch chân</b>: bấm để mở gợi ý.</span>
          <span><b>Nền trắng</b>: AI không có gợi ý (vẫn có thể còn lỗi).</span></InfoTip></p>}
      {showAnnotations && !draftPositionsKnown && accepted.some(id => visibleIds.has(id))
        && <p className={styles.hint}>Bản nháp có chỉnh sửa riêng nên vị trí gợi ý chỉ được đánh dấu trên bài gốc.</p>}
      <div className={styles.studioCompare}>
        <article className={styles.essayCard}>
          <header>
            <span className={styles.icon}><Icon name="clipboard" /></span>
            <h2>Bản gốc của bạn</h2>
            <span className={styles.pill}>{result.originalText.trim().split(/\s+/u).filter(Boolean).length} từ</span>
          </header>
          <p lang="en">{showAnnotations ? <ShadedOriginal text={result.originalText} shades={shades} improved={improved} edits={edits} visibleIds={visibleIds} statusById={statusById} onSelect={onSelect} onSentence={onSentence} /> : result.originalText}</p>
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
  const relevance = result.relevance ?? null;
  return <section className={styles.summarySection} aria-labelledby="writing-summary-heading">
    <div className={styles.sectionHeading}>
      <span className={`${styles.icon} ${styles.primaryIcon}`}><Icon name="trend" /></span>
      <h2 id="writing-summary-heading">Đánh giá bài đã nộp</h2>
    </div>
    <div className={styles.studioSummary}>
      <article className={styles.cefrCard}>
        <h3>CEFR ước lượng<InfoTip label="CEFR ước lượng là gì?">
          <span>Ước lượng trình độ ngôn ngữ của bài viết, không phải của bạn.</span>
          <span>Không xét bám đề, không phải điểm IELTS. Đang thử nghiệm: A1 và C2 chưa nhận diện chắc chắn.</span>
          <span>Đề ngắn, đơn giản thường khó đạt mức cao.</span></InfoTip></h3>
        <strong>{result.cefrLevel || "Chưa có"}</strong>
        <p>Mức ngôn ngữ của bài viết{result.targetRecorded && result.targetCefr ? ` · mục tiêu khi nộp ${result.targetCefr}` : ""}</p>
      </article>
      <article>
        <h3>Gợi ý chỉnh sửa</h3>
        <strong>{result.correctedText !== null ? result.errors.length : "Không bật"}</strong>
        <p>{result.correctedText !== null ? "Số câu có gợi ý ngữ pháp" : "Lần nộp này chỉ có ước lượng CEFR"}</p>
      </article>
      {relevance ? <article className={relevance.offTopic ? styles.offTopicCard : undefined}>
        <h3>Bám đề<InfoTip label="Điểm bám đề được tính thế nào?">
          <span>Thử nghiệm: AI so nghĩa giữa bài và đề, thang 0–5.</span>
          <span>Phát hiện lạc đề đã kiểm trên bài Write &amp; Improve (báo nhầm khoảng 2–3%); phần kiểm từng ý chưa có giáo viên đối chiếu.</span></InfoTip></h3>
        <strong>{relevance.score}/5</strong>
        <ol className={styles.gauge} aria-label={`Điểm bám đề ${relevance.score} trên 5`}>
          {[0, 1, 2, 3, 4, 5].map(n => <li key={n} className={n === relevance.score ? styles.gaugeActive : n < relevance.score ? styles.gaugeFilled : undefined}>{n}</li>)}
        </ol>
        <p>{relevanceLabel(relevance.score)}</p>
      </article> : <article>
        <h3>Bám đề</h3>
        <strong>Chưa đánh giá</strong>
        <p>{result.task ? "Chưa chấm được độ bám đề cho bài này." : "Đề tự đặt chưa được chấm bám đề."}{requirements.length > 0 && " Hãy tự đối chiếu:"}</p>
        {requirements.length > 0 && <ul className={styles.summaryList}>{requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul>}
      </article>}
      {coverage && coverage.unprocessed > 0 && <article>
        <h3>Câu chưa được kiểm tra</h3>
        <strong>{coverage.unprocessed} câu</strong>
        <p>Quá dài hoặc vượt giới hạn 20 câu mỗi lượt. Hãy tự rà soát các câu này.</p>
      </article>}
    </div>
    {relevance?.offTopic && <p className={styles.offTopicNotice} role="status">Bài có vẻ không trả lời đề này. Hãy đọc lại đề và các ý cần viết trước khi sửa ngữ pháp.</p>}
    {relevance && <RelevanceDetails relevance={relevance} />}
  </section>;
}

function relevanceLabel(score: number) {
  return score === 0 ? "Có vẻ lạc đề" : score === 1 ? "Chưa bám sát đề" : score <= 3 ? "Đúng chủ đề, có thể còn thiếu ý" : "Bám đề tốt";
}

/** Points of the task with the essay sentence that seems to answer each one, plus the keywords used. */
function RelevanceDetails({ relevance }: { relevance: WritingRelevance }) {
  return <details className={styles.relevanceDetails} open={relevance.score <= 3}>
    <summary>Bài của bạn trả lời đề thế nào?</summary>
    {relevance.points.length > 0 ? <ul className={styles.pointList}>
      {relevance.points.map(item => <li key={item.point} className={item.covered ? styles.pointFound : styles.pointMissing}>
        <span lang="en">{item.point}</span>
        {item.covered && item.evidence
          ? <small>Câu liên quan: <q lang="en">{item.evidence}</q></small>
          : <small>Chưa tìm thấy câu tương ứng — hãy tự kiểm tra bạn đã viết ý này chưa.</small>}
      </li>)}
    </ul> : <p className={styles.hint}>Đề không liệt kê từng ý.</p>}
    {relevance.keywords.length > 0 && <p className={styles.hint}>Bài có nhắc tới từ của đề: <span lang="en">{relevance.keywords.join(", ")}</span></p>}
  </details>;
}
