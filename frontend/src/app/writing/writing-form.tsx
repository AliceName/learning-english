"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Icon from "@/components/site-icon";
import { isWritingResult, sameWritingCoverage, writingCoverageSummary, writingFeedbackEligible, taskWordGuidance, type WritingResult, type WritingTask } from "@/lib/writing";
import { diffWritingText, type WritingDiff } from "@/lib/writing-diff";
import { applyWritingEdits, currentEditPosition, writingEdits, type WritingEdit } from "@/lib/writing-revision";
import { isWritingCapabilities, writingInputIssue, type WritingCapabilities } from "@/lib/writing-capabilities";
import { clearWritingDraft, loadPreviousWritingDraft, loadWritingDraft, restorePreviousWritingDraft,
  saveWritingDraft, writingDraftStorage } from "@/lib/writing-draft";
import { writingAuthHref } from "@/lib/writing-return";
import { checkWritingPreflight, useWritingPreflight } from "./use-writing-preflight";
import WritingHistoryPanel from "./writing-history";
import WritingTaskLibrary, { taskLevels } from "./writing-task-library";
import styles from "./writing.module.css";

const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
const criterionLabels = { content: "Nội dung & bám đề", organization: "Tổ chức & mạch lạc",
  vocabulary: "Từ vựng & văn phong", grammar: "Giải thích chỉnh sửa ngữ pháp" };

function visibleEdit(text: string) {
  return text.trim() ? text : text.replace(/\r\n|\r|\n/g, "↵").replace(/\t/g, "⇥").replace(/ /g, "␣");
}

function DiffText({ diff, view = "inline" }: { diff: WritingDiff; view?: "original" | "suggestion" | "inline" }) {
  if (!diff.detailed) return <>{diff.parts.map(part => part.kind === "equal" ? part.text
    : view === "suggestion" ? part.after : part.before).join("")}</>;
  return <>{diff.parts.map((part, index) => {
    if (part.kind === "equal") return <span key={index}>{part.text}</span>;
    if (view === "original") return part.before
      ? <mark key={index} className={styles.diffRemoved} title={`Gợi ý: ${part.after || "bỏ phần này"}`}>{visibleEdit(part.before)}</mark>
      : <span key={index} className={styles.insertionMarker} role="img" aria-label={`Gợi ý thêm: ${part.after}`} title={`Gợi ý thêm: ${part.after}`}>＋</span>;
    if (view === "suggestion") return part.after
      ? <mark key={index} className={styles.diffAdded} title={`Bản gốc: ${part.before || "chưa có phần này"}`}>{visibleEdit(part.after)}</mark> : null;
    return <span key={index} className={styles.inlineEdit}>
      {part.before && <del className={styles.diffRemoved} title="Phần gốc đề xuất thay hoặc bỏ">{visibleEdit(part.before)}</del>}
      {part.before && part.after && <span className={styles.diffArrow} aria-label="thay bằng"> → </span>}
      {part.after && <ins className={styles.diffAdded} title="Phần được đề xuất">{visibleEdit(part.after)}</ins>}
    </span>;
  })}</>;
}

export default function WritingForm({ authenticated, unavailable, userId = null, draftBaseId = null, initialResult = null, initialNotice = "", initialTask = null, draftTaskId = null, custom = false }: {
  authenticated: boolean; unavailable: boolean; userId?: number | null; draftBaseId?: number | null;
  initialResult?: WritingResult | null; initialNotice?: string;
  initialTask?: WritingTask | null; draftTaskId?: string | null; custom?: boolean;
}) {
  const [task, setTask] = useState<WritingTask | null>(initialResult?.task ?? initialTask);
  const [checkedRequirements, setCheckedRequirements] = useState<number[]>([]);
  const [restart, setRestart] = useState(false);
  const [topic, setTopic] = useState(initialResult?.topic ?? initialTask?.title ?? "");
  const [text, setText] = useState(initialResult?.originalText ?? "");
  const [corrections, setCorrections] = useState(initialResult?.correctedText != null);
  const [pending, setPending] = useState(false);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState("");
  const [notice, setNotice] = useState(initialNotice);
  const [correctionView, setCorrectionView] = useState<"original" | "suggestion">("original");
  const [result, setResult] = useState<WritingResult | null>(initialResult);
  const [baseId, setBaseId] = useState(initialResult?.submissionId ?? draftBaseId);
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  const [previousDraft, setPreviousDraft] = useState(false);
  const [capabilities, setCapabilities] = useState<WritingCapabilities | null>(null);
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ text: string; accepted: string[]; ignored: string[] }[]>([]);
  const [comparison, setComparison] = useState<WritingResult | null>(null);
  const [compareNotice, setCompareNotice] = useState("");
  const [partialConsent, setPartialConsent] = useState<{ text: string; corrections: boolean } | null>(null);
  const [phase, setPhase] = useState<"checking" | "analyzing">("checking");
  const [elapsed, setElapsed] = useState(0);
  const inFlight = useRef(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const started = useRef(0);
  const mounted = useRef(true);
  const activeRequest = useRef<AbortController | null>(null);
  const comparisonRequest = useRef<AbortController | null>(null);
  const preflight = useWritingPreflight(text, corrections, authenticated && draftReady && !pending);
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  const changed = result !== null && (result.originalText !== text || (result.topic ?? "") !== topic.trim()
    || (result.correctedText != null) !== corrections);
  const essayDiff = useMemo(() => result?.correctedText != null
    ? diffWritingText(result.originalText, result.correctedText) : null, [result]);
  const sentenceDiffs = useMemo(() => result?.errors.map(item => diffWritingText(item.original, item.suggestion)) ?? [], [result]);
  const coverage = result?.gecCoverage ? writingCoverageSummary(result.gecCoverage) : null;
  const editMap = useMemo(() => result ? writingEdits(result) : { edits: [], unmapped: 0 }, [result]);
  const managedText = result ? applyWritingEdits(result.originalText, editMap.edits, accepted) : "";
  const canChooseEdits = result !== null && text === managedText && !pending && !feedbackPending;
  const comparisonDiff = useMemo(() => comparison && result ? diffWritingText(comparison.originalText, result.originalText) : null, [comparison, result]);
  const checked = preflight.current?.value;
  const inputIssue = writingInputIssue(checked?.inputAssessment);
  const partialSentences = checked?.canAnalyze ? checked.sentences.filter(sentence => sentence.status !== "ready") : [];
  const partialAccepted = partialConsent?.text === text && partialConsent.corrections === corrections;
  const taskScope = task?.id ?? draftTaskId;
  const editing = Boolean(initialResult || task || custom);
  const returnTarget = baseId ? `/writing?submissionId=${baseId}` : taskScope ? `/writing?taskId=${taskScope}` : custom ? "/writing?custom=1" : "/writing";
  const principal = authenticated ? userId : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRequest.current?.abort(); comparisonRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (unavailable) return;
    let disposed = false;
    const storage = writingDraftStorage();
    const restored = loadWritingDraft(storage, principal, baseId, taskScope);
    // Hydrate browser-only storage after the server-rendered form has mounted.
    queueMicrotask(() => {
      if (disposed) return;
      if (restored) {
        setTopic(restored.topic); setText(restored.text); setCorrections(restored.corrections);
        setTask(restored.task ?? null); setCheckedRequirements(restored.checkedRequirements ?? []);
        setDraftStatus("Đã khôi phục bản nháp trong phiên này. Bản nháp chưa phải bài đã lưu tài khoản.");
      }
      if (principal !== null) setPreviousDraft(Boolean(loadPreviousWritingDraft(storage, principal, baseId, taskScope)));
      setDraftReady(true);
    });
    return () => { disposed = true; };
    // Route/account changes remount the form. A successful save changes baseId
    // without rehydrating an old draft over the just-saved text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftReady || unavailable || !editing) return;
    const persist = () => {
      const storage = writingDraftStorage();
      const matchesSaved = result !== null && result.submissionId === baseId && !changed;
      if ((matchesSaved && !checkedRequirements.length) || (!text && !task && !topic && !corrections)) {
        clearWritingDraft(storage, principal, baseId, taskScope);
        setDraftStatus(matchesSaved ? `Đang xem bài #${baseId} đã lưu trong tài khoản.` : "Chưa có bản nháp.");
      } else {
        const saved = saveWritingDraft(storage, principal, { topic, text, corrections, task, checkedRequirements, baseSubmissionId: baseId });
        setDraftStatus(saved ? "Bản nháp đã lưu trong phiên trình duyệt này; sẽ giữ khi đăng nhập hoặc tải lại."
          : "Không lưu được nháp trong trình duyệt. Hãy sao chép bài trước khi rời trang.");
      }
    };
    const timer = setTimeout(persist, 0);
    window.addEventListener("pagehide", persist);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", persist); };
  }, [draftReady, unavailable, principal, baseId, topic, text, corrections, result, changed, task, checkedRequirements, taskScope, editing]);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    fetch("/api/writing/capabilities", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const value: unknown = await response.json();
        if (!response.ok || !isWritingCapabilities(value)) throw new Error("Invalid capabilities");
        if (!controller.signal.aborted) setCapabilities(value);
      }).catch(() => { if (!controller.signal.aborted) setCapabilities(null); });
    return () => controller.abort();
  }, [authenticated, capabilityRetry]);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  function persistBeforeNavigation() {
    if (!unavailable && draftReady && editing) saveWritingDraft(writingDraftStorage(), principal, { topic, text, corrections, task, checkedRequirements, baseSubmissionId: baseId });
  }

  function discardDraft() {
    if (!clearWritingDraft(writingDraftStorage(), principal, baseId, taskScope)) {
      setNotice("Không xóa được nháp trong trình duyệt. Bài hiện tại vẫn được giữ; hãy kiểm tra quyền lưu trữ trước khi thử lại."); return;
    }
    setTopic(result?.topic ?? task?.title ?? ""); setText(result?.originalText ?? ""); setCheckedRequirements([]);
    setCorrections(result?.correctedText != null); setAccepted([]); setIgnored([]); setUndo([]);
    setDraftStatus("Đã bỏ bản nháp. Các bài đã lưu tài khoản vẫn được giữ.");
  }

  function recoverPreviousDraft() {
    if (principal === null || unavailable) return;
    const restored = restorePreviousWritingDraft(writingDraftStorage(), principal, baseId, taskScope);
    if (!restored) { setNotice("Chưa khôi phục được nháp cũ. Bài đang soạn vẫn được giữ."); return; }
    setTopic(restored.topic); setText(restored.text); setCorrections(restored.corrections);
    setTask(restored.task ?? null); setCheckedRequirements(restored.checkedRequirements ?? []);
    setAccepted([]); setIgnored([]); setUndo([]); setPreviousDraft(false);
    setDraftStatus("Đã khôi phục nháp của tài khoản trước lần đăng nhập này.");
  }

  function chooseEdit(edit: WritingEdit, accept: boolean) {
    if (!result || !canChooseEdits || accepted.includes(edit.id) || ignored.includes(edit.id)) return;
    const next = accept ? [...accepted, edit.id] : accepted;
    const nextText = applyWritingEdits(result.originalText, editMap.edits, next);
    if (nextText.length > 12000) { setNotice("Bản sửa vượt giới hạn ký tự. Hãy chỉnh sửa thủ công."); return; }
    setUndo(previous => [...previous.slice(-99), { text, accepted, ignored }]);
    setAccepted(next); if (!accept) setIgnored(previous => [...previous, edit.id]);
    setText(nextText);
  }

  function undoChoice() {
    if (!canChooseEdits || !undo.length) return;
    const previous = undo[undo.length - 1];
    setText(previous.text); setAccepted(previous.accepted); setIgnored(previous.ignored);
    setUndo(values => values.slice(0, -1));
  }

  function locate(start: number, end: number) {
    editor.current?.focus(); editor.current?.setSelectionRange(start, end);
    editor.current?.scrollIntoView({ behavior: "auto", block: "center" });
  }

  async function compareSubmission(id: number) {
    comparisonRequest.current?.abort();
    const controller = new AbortController();
    comparisonRequest.current = controller;
    setCompareNotice("");
    try {
      const response = await fetch(`/api/writing/submissions/${id}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
      const value: unknown = await response.json();
      if (!mounted.current || controller.signal.aborted) return;
      if (!response.ok || !isWritingResult(value) || value.submissionId !== id) throw new Error("Invalid comparison");
      setComparison(value);
    } catch { if (mounted.current && !controller.signal.aborted) setCompareNotice("Chưa tải được bài đối chiếu. Bản nháp và kết quả hiện tại vẫn được giữ."); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!text.trim()) { setNotice("Hãy viết bài trước khi nộp."); return; }
    if (!authenticated || !draftReady) return;
    persistBeforeNavigation();
    const controller = new AbortController();
    activeRequest.current = controller;
    inFlight.current = true;
    setPending(true);
    setPhase("checking"); setElapsed(0); started.current = Date.now();
    setNotice("");
    try {
      const capacity = preflight.current?.value ?? await checkWritingPreflight(text, corrections, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      preflight.remember({ text, corrections, value: capacity, error: "" });
      const issue = writingInputIssue(capacity.inputAssessment);
      if (issue) { setNotice(issue); return; }
      if (!capacity.canAnalyze) { setNotice("Bài vượt khả năng chấm CEFR hiện tại. Hãy rút ngắn bài; bản nháp vẫn được giữ."); return; }
      if (corrections && !capacity.correctionsEnabled) { setNotice("Gợi ý sửa lỗi chưa được bật. Bạn có thể chọn chỉ ước lượng CEFR."); return; }
      if (capacity.sentences.some(sentence => sentence.status !== "ready") && !partialAccepted) {
        setNotice("Một số câu chưa thể được sửa. Hãy xem kiểm tra giới hạn và xác nhận xử lý một phần, hoặc rút ngắn bài."); return;
      }
      setPhase("analyzing");
      const response = await fetch("/api/writing/submissions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: task ? undefined : topic, originalText: text, corrections,
          taskId: task?.id, taskVersion: task?.version, parentSubmissionId: result?.submissionId }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(105_000)]),
      });
      const data: unknown = await response.json();
      if (!mounted.current || controller.signal.aborted) return;
      if (!response.ok) {
        const problem = data && typeof data === "object" ? data as Record<string, unknown> : {};
        setNotice(typeof problem.detail === "string" ? problem.detail
          : typeof problem.title === "string" ? problem.title : "Chưa thể chấm bài. Hãy thử lại sau.");
        return;
      }
      if (!isWritingResult(data)) {
        setNotice("AI trả về kết quả chưa hợp lệ. Bài viết vẫn được giữ để bạn thử lại.");
        return;
      }
      comparisonRequest.current?.abort();
      if (result) setComparison(result);
      clearWritingDraft(writingDraftStorage(), principal, baseId, taskScope);
      setResult(data); setBaseId(data.submissionId);
      setAccepted([]); setIgnored([]); setUndo([]); setPartialConsent(null); setPreviousDraft(false);
      setFeedbackNotice("");
      const savedUrl = new URL(window.location.href);
      savedUrl.search = "";
      savedUrl.searchParams.set("submissionId", String(data.submissionId));
      window.history.replaceState(null, "", savedUrl);
      requestAnimationFrame(() => resultHeading.current?.focus());
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      setNotice(error instanceof Error && error.name !== "TimeoutError" && error.name !== "TypeError"
        ? error.message : "Kết nối bị gián đoạn hoặc hết thời gian. Bản nháp và kết quả trước vẫn được giữ; kiểm tra lịch sử trước khi nộp lại để tránh tạo bài trùng.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function requestFeedback() {
    if (inFlight.current || !result || changed || !writingFeedbackEligible(result) || !capabilities?.feedbackEnabled) return;
    const saved = result;
    const controller = new AbortController();
    activeRequest.current = controller;
    inFlight.current = true;
    setFeedbackPending(true);
    setFeedbackNotice("");
    try {
      const response = await fetch(`/api/writing/submissions/${saved.submissionId}/feedback`, {
        method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      const data: unknown = await response.json();
      if (!mounted.current || controller.signal.aborted) return;
      if (!response.ok) {
        const problem = data && typeof data === "object" ? data as Record<string, unknown> : {};
        setFeedbackNotice(typeof problem.detail === "string" ? problem.detail
          : typeof problem.title === "string" ? problem.title : "Phần nhận xét chưa sẵn sàng. Bài đã lưu vẫn được giữ.");
        return;
      }
      if (!isWritingResult(data) || !data.feedback || data.submissionId !== saved.submissionId
        || data.originalText !== saved.originalText || data.topic !== saved.topic
        || data.cefrLevel !== saved.cefrLevel || data.correctedText !== saved.correctedText
        || !sameWritingCoverage(data.gecCoverage, saved.gecCoverage)
        || data.errors.length !== saved.errors.length
        || data.errors.some((error, index) => error.original !== saved.errors[index].original
          || error.suggestion !== saved.errors[index].suggestion)) {
        setFeedbackNotice("Nhận xét trả về chưa hợp lệ. Bài và kết quả chấm vẫn được giữ.");
        return;
      }
      setResult(data);
    } catch {
      if (mounted.current && !controller.signal.aborted) setFeedbackNotice("Chưa nhận được nhận xét trong thời gian cho phép. Bài và kết quả chấm vẫn được giữ; bạn có thể thử lại.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setFeedbackPending(false);
    }
  }

  if (!editing) return <main id="main-content" className={styles.page}><header className={styles.heading}><div><h1>Thư viện đề Writing</h1><p>Chọn nhiệm vụ phù hợp rồi bắt đầu luyện viết.</p></div></header>
    {notice && <p role="alert" className={styles.notice}>{notice}</p>}<WritingTaskLibrary />
    <WritingHistoryPanel authenticated={authenticated} submissionId={null} onCompare={compareSubmission} onNavigate={persistBeforeNavigation} /></main>;

  return <main id="main-content" className={styles.page}>
    <div className={styles.breadcrumb}>KHÔNG GIAN HỌC TẬP <span>/</span> WRITING</div>
    <header className={styles.heading}><div><span className={styles.eyebrow}>MAKE YOUR WORDS COUNT</span><h1>Mỗi bài viết,<br /><span>một bước tiến.</span></h1><p>Luyện diễn đạt ý tưởng bằng tiếng Anh và khám phá trình độ viết của bạn.</p></div><div className={styles.mark} aria-hidden="true"><Icon name="writing" /></div></header>
    <div className={styles.flow}><span><b>01</b> Chọn đề bài</span><span><b>02</b> Viết & nộp bài</span><span><b>03</b> Xem & chỉnh sửa</span></div>
    {!authenticated && <div className={styles.notice}>{unavailable ? "Chưa kết nối được tài khoản. Bạn có thể soạn bài; hãy sao chép bài trước khi rời trang vì chưa xác định được nơi lưu nháp." : <>Bạn có thể soạn và giữ nháp trong phiên này. <Link href={writingAuthHref("login", returnTarget)} onClick={persistBeforeNavigation}>Đăng nhập và tiếp tục bài viết</Link> để chấm và lưu vào tài khoản.</>}</div>}
    {authenticated && capabilities?.status === "unavailable" && <div className={styles.notice}>AI hiện chưa kết nối được. Bản nháp vẫn được giữ. <button type="button" onClick={() => { setCapabilityRetry(n => n + 1); preflight.retry(); }}>Kiểm tra lại dịch vụ</button></div>}
    {capabilities?.busy && <p className={styles.hint} role="status">AI đang xử lý một yêu cầu khác. Bạn vẫn có thể soạn và kiểm tra giới hạn; nếu gặp thông báo bận, hãy đợi rồi thử lại.</p>}
    <div className={styles.grid}>
      <form className={styles.editor} onSubmit={submit} aria-busy={pending}>
        <fieldset disabled={pending || (!draftReady && !unavailable)}>
          <div className={styles.panelHeading}><span className={styles.icon}><Icon name="writing" /></span><div><h2>Bài viết của bạn</h2><p>Một ý tưởng nhỏ cũng là điểm bắt đầu.</p></div></div>
          <Link href="/writing" prefetch={false} onClick={persistBeforeNavigation}>Chọn đề khác trong thư viện</Link>
          {!result && initialTask && task && initialTask.id === task.id && initialTask.version !== task.version && <div className={styles.notice}>
            <p>Đề thư viện đã được cập nhật. Nháp đang giữ yêu cầu cũ; hãy đọc lại đề mới trước khi nộp.</p>
            <button type="button" onClick={() => { setTask(initialTask); setTopic(initialTask.title); setCheckedRequirements([]); }}>Dùng phiên bản đề mới, giữ nội dung nháp</button>
          </div>}
          {task ? <section className={styles.taskPrompt} aria-label="Nhiệm vụ đã chọn"><h3>{task.title}</h3>
            <p>{taskLevels[task.level]} · {task.genre} · {taskWordGuidance(task)}</p><p lang="en">{task.prompt}</p>
            <h3>Tự kiểm yêu cầu đề</h3><p className={styles.hint}>Bạn tự đánh dấu khi đã đáp ứng. AI chưa xác minh nội dung hoặc độ bám đề; checklist chưa được chuyên gia kiểm định.</p>
            {task.requirements.map((r, i) => <label className={styles.checkbox} key={i}><input type="checkbox" checked={checkedRequirements.includes(i)} onChange={e => setCheckedRequirements(old => e.target.checked ? [...old, i] : old.filter(n => n !== i))} /><span>{r}</span></label>)}
          </section> : <><label htmlFor="writing-topic">Đề bài riêng (không bắt buộc)</label>
            <textarea id="writing-topic" className={styles.topic} value={topic} maxLength={500} rows={2} readOnly={Boolean(result)} onChange={event => setTopic(event.target.value)} placeholder="Nhập hoặc dán đề bài riêng tại đây…" />
            <p className={styles.hint}>Tối đa 500 ký tự. Đề của lượt đã lưu được giữ nguyên; để đổi đề hãy bắt đầu lượt mới.</p></>}
          {result && <div className={styles.editActions}><button type="button" onClick={() => { editor.current?.focus(); setNotice("Hãy sửa nội dung rồi nộp lại. Bản trước được giữ trong cùng lượt luyện."); }}>Sửa bài này</button><button type="button" onClick={() => setRestart(true)}>Luyện lại từ đầu</button></div>}
          {restart && <div role="alert" className={styles.notice}><p>Bắt đầu lượt riêng với ô viết trống? Nháp chưa nộp cho lượt mới cùng đề sẽ được thay; các bài đã lưu vẫn còn.</p>
            <Link href={task ? `/writing?taskId=${task.id}` : "/writing?custom=1"} prefetch={false} onClick={e => {
              persistBeforeNavigation(); const storage = writingDraftStorage();
              if (!clearWritingDraft(storage, principal, null, task?.id)
                || (!task && !saveWritingDraft(storage, principal, { topic, text: "", corrections: false, baseSubmissionId: null }))) {
                e.preventDefault(); setNotice("Chưa tạo được nháp mới. Nội dung vẫn được giữ."); }
            }}>Xác nhận bắt đầu lượt mới</Link><button type="button" onClick={() => setRestart(false)}>Giữ bài hiện tại</button></div>}
          <label htmlFor="writing-text">Nội dung bài viết <span className={styles.required}>*</span></label>
          <textarea ref={editor} id="writing-text" lang="en" className={styles.essay} placeholder="Start writing in English here…" value={text} onChange={event => setText(event.target.value)} maxLength={12000} rows={13} required aria-describedby="writing-hint writing-count writing-draft-status" />
          <div className={styles.count} id="writing-count"><span><strong>{words}</strong> từ</span><span>{text.length.toLocaleString("vi-VN")} / 12.000 ký tự</span></div>
          <p id="writing-hint" className={styles.hint}>{task ? `${taskWordGuidance(task)}. Bạn đã viết ${words} từ. ` : "Độ dài tùy yêu cầu đề riêng. "}Giới hạn nhập 12.000 ký tự khác giới hạn CEFR 512 token; khả năng xử lý được kiểm tra trước khi nộp. Không tự cắt bài.</p>
          {task && (((task.wordMode === "minimum" || task.wordMode === "range") && words < task.minWords) || (task.wordMode === "range" && words > task.maxWords)) && <p className={styles.hint}>Số từ hiện chưa theo yêu cầu đề. Đây là nhắc độ dài, không phải điểm bám đề.</p>}
          <label className={styles.checkbox}><input type="checkbox" checked={corrections} onChange={event => setCorrections(event.target.checked)} /><span>Thử gợi ý sửa ngữ pháp <small>Đang thử nghiệm · cần kiểm tra lại bản sửa</small></span></label>
          <p className={styles.modeSummary}><strong>{corrections ? "Chế độ: CEFR + gợi ý sửa lỗi thử nghiệm" : "Chế độ: chỉ ước lượng CEFR"}</strong><br />{corrections ? "Bạn tự quyết định từng gợi ý; AI có thể bỏ sót hoặc tạo lỗi mới." : "Lần nộp này sẽ không tìm hoặc đề xuất sửa lỗi ngữ pháp."}</p>
          <div className={styles.draftStatus} id="writing-draft-status"><span role="status">{unavailable ? "Nháp hiện chỉ nằm trên trang này." : !draftReady ? "Đang kiểm tra bản nháp…" : draftStatus || "Nháp sẽ được lưu trong phiên trình duyệt hiện tại."}</span>
            <small>Nháp trong phiên sẽ mất khi đóng phiên trình duyệt; khác với bài đã lưu vào tài khoản.</small>
            <div className={styles.editActions}><button type="button" disabled={!draftReady || unavailable} onClick={discardDraft}>{result ? "Bỏ nháp, trở lại bài đã lưu" : "Xóa bản nháp"}</button>
              {previousDraft && <button type="button" onClick={recoverPreviousDraft}>Khôi phục nháp trước đăng nhập</button>}</div>
          </div>
          {text.trim() && <section className={styles.preflight} aria-labelledby="writing-preflight-heading">
            <h3 id="writing-preflight-heading">Kiểm tra trước khi nộp</h3>
            {!authenticated ? <p>Đăng nhập để kiểm tra khả năng xử lý bằng mô hình. Bản nháp của bạn được giữ trong phiên.</p>
              : !preflight.current ? <p role="status">Đang kiểm tra giới hạn của bài hiện tại…</p>
              : preflight.current.error ? <p className={styles.error}>{preflight.current.error} <button type="button" onClick={preflight.retry}>Kiểm tra lại</button></p>
              : checked ? <>
                <p>{checked.canAnalyze ? "Bài nằm trong giới hạn token CEFR." : "Bài quá dài để chấm CEFR. Hãy rút ngắn bài trước khi nộp."}</p>
                {inputIssue && <p className={styles.error} role="status">{inputIssue}</p>}
                {checked.inputAssessment?.warnings.map(warning => <p key={warning} className={styles.hint}>{warning}</p>)}
                <p className={styles.hint}>Kiểm tra đầu vào không xác nhận bài đúng tiếng Anh, đúng đề hoặc có chất lượng tốt.</p>
                {checked.canAnalyze && corrections && !checked.correctionsEnabled && <p>Gợi ý sửa lỗi chưa được bật. Hãy bỏ chọn sửa lỗi nếu bạn muốn chấm CEFR.</p>}
                {checked.canAnalyze && corrections && checked.correctionsEnabled && <p>Có thể sửa {checked.sentences.filter(sentence => sentence.status === "ready").length}/{checked.sentences.length} câu thân bài. Tối đa {checked.gecSentenceLimit} câu mỗi lượt.</p>}
                {partialSentences.length > 0 && <>
                  <ul>{partialSentences.map(sentence => <li key={sentence.index}>
                    Câu {sentence.index + 1}: {sentence.status === "sentenceLimit" ? "ngoài giới hạn số câu" : "quá dài để sửa"}.
                    <button type="button" onClick={() => locate(sentence.start, sentence.end)}>Xem câu {sentence.index + 1}</button>
                  </li>)}</ul>
                  <label className={styles.checkbox}><input type="checkbox" checked={partialAccepted} onChange={event => setPartialConsent(event.target.checked ? { text, corrections } : null)} />
                    <span>Tôi hiểu các câu trên sẽ được giữ nguyên; tiếp tục chấm và sửa phần còn lại.</span></label>
                </>}
                <details><summary>Chi tiết giới hạn xử lý</summary><p>CEFR: {checked.cefrTokens}/{checked.cefrLimit} token. Token là đơn vị xử lý văn bản, không phải số từ.</p>
                  {corrections && checked.gecInputLimit && <p>Sửa lỗi: tối đa {checked.gecInputLimit} token cho một câu. Các giới hạn được kiểm trên nội dung hiện tại, không cắt bài âm thầm.</p>}</details>
              </> : null}
          </section>}
          {notice && <p className={styles.error} role="alert">{notice}</p>}
          <div className={styles.actions}><span><Icon name="shield" />{pending ? "Chỉ xác nhận lưu tài khoản sau khi nhận kết quả thành công." : "Nộp thành công để lưu bài vào tài khoản."}</span><button className={styles.submit} type="submit" disabled={!authenticated || !draftReady || !text.trim() || feedbackPending || checked?.canAnalyze === false || !!inputIssue || (partialSentences.length > 0 && !partialAccepted)}>{pending ? phase === "checking" ? "Đang kiểm tra…" : "AI đang đọc bài…" : "Nộp bài & chấm CEFR"}<Icon name="arrow" /></button></div>
        </fieldset>
      </form>
      <aside className={styles.result} aria-live="polite" aria-busy={pending}>
        <div className={styles.resultHeading}><span className={styles.icon}><Icon name="sparkles" /></span><h2 ref={resultHeading} tabIndex={-1}>Góc nhìn từ bài viết</h2></div>
        {pending && <div className={styles.pending} role="status"><strong>{phase === "checking" ? "Đang kiểm tra giới hạn" : "Đang phân tích bài viết"} · {elapsed} giây</strong><p>Kết quả trước vẫn được giữ. Chỉ xác nhận lưu bài mới khi máy chủ trả thành công.</p></div>}
        {result ? <>
          {changed && <p className={styles.notice}>Bạn đã chỉnh sửa bài. Kết quả bên dưới thuộc lần nộp trước.</p>}
          <p><strong>{result.task?.title ?? result.topic ?? "Đề riêng"}</strong><br />Bài #{result.submissionId} · lượt #{result.practiceRootId ?? result.submissionId}{result.parentSubmissionId ? ` · sửa từ bài #${result.parentSubmissionId}` : " · bản đầu"}</p>
          <div className={styles.grade}><span>CEFR ƯỚC LƯỢNG</span><strong>{result.cefrLevel}</strong><small>Trình độ ngôn ngữ của bài đã nộp</small></div>
          <section className={styles.taskPrompt} aria-label="Yêu cầu của bài đã nộp"><h3>Yêu cầu đề — chưa chấm nội dung</h3>
            <p>Bài đã nộp: {result.originalText.trim().split(/\s+/u).length} từ. {result.task ? taskWordGuidance(result.task) : "Theo đề riêng của bạn."}</p>
            <p className={styles.hint}>Checklist ở ô viết do bạn tự kiểm. AI chưa xác minh đủ ý, đúng mục đích hay lạc đề. CEFR đánh giá ngôn ngữ, không thay thế phần này.</p></section>
          <div className={styles.levels}>{levels.map(level => <span key={level} aria-current={result.cefrLevel === level ? "step" : undefined}>{level}</span>)}</div>
          <p className={styles.saved}><Icon name="check" /> Đã lưu bài #{result.submissionId} · <Link href={`/writing?submissionId=${result.submissionId}`} target="_blank" rel="noopener noreferrer" prefetch={false}>Mở lại bài đã lưu</Link></p>
          {comparison && comparison.submissionId !== result.submissionId && <section className={styles.comparison} aria-label="Đối chiếu hai bài đã lưu">
            <h3>Đối chiếu với bài #{comparison.submissionId}</h3>
            <p>CEFR: <strong>{comparison.cefrLevel} → {result.cefrLevel}</strong>. Số câu có gợi ý: <strong>{comparison.errors.length} → {result.errors.length}</strong>.</p>
            <p className={styles.hint}>Số gợi ý không phải điểm chất lượng. Sửa vài lỗi có thể không làm đổi mức CEFR. Hai bài có thể khác đề; hãy tự kiểm tra nội dung.</p>
            {comparisonDiff && <details><summary>Xem thay đổi giữa hai bài</summary><p lang="en" className={styles.diffText}><DiffText diff={comparisonDiff} /></p></details>}
            <button type="button" onClick={() => { comparisonRequest.current?.abort(); setComparison(null); }}>Đóng đối chiếu</button>
          </section>}
          {compareNotice && <p className={styles.error} role="alert">{compareNotice}</p>}
          <div className={styles.limits}>{result.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>
          {coverage && result.gecCoverage && <div className={styles.limits} aria-label="Mức độ xử lý gợi ý ngữ pháp">
            <p>Đã sinh hoàn tất: <strong>{coverage.completed}/{result.gecCoverage.totalBodySentences}</strong> câu thân bài,
              trong đó <strong>{coverage.rejected}</strong> câu có gợi ý bị chặn.</p>
            <p>Chưa xử lý hoặc chưa hoàn tất: <strong>{coverage.unprocessed}</strong> câu
              ({result.gecCoverage.inputOverBudget} vượt ngân sách đầu vào, {result.gecCoverage.incomplete} sinh chưa hoàn tất,
              {" "}{result.gecCoverage.sentenceLimit} ngoài giới hạn 20 câu).</p>
            <p>Không có gợi ý không có nghĩa là bài viết không còn lỗi.</p>
          </div>}
          {essayDiff && <div className={styles.correction}><h3>Vị trí gợi ý chỉnh sửa</h3>
            <div className={styles.diffTabs} role="group" aria-label="Chọn bản bài viết">
              <button type="button" aria-pressed={correctionView === "original"} onClick={() => setCorrectionView("original")}>Bài gốc</button>
              <button type="button" aria-pressed={correctionView === "suggestion"} onClick={() => setCorrectionView("suggestion")}>Bản đề xuất</button>
            </div>
            <p className={styles.diffLegend}>Đỏ: phần gốc đề xuất thay/bỏ. Xanh: phần đề xuất. ＋: vị trí thêm. ␣: khoảng trắng.</p>
            <p lang="en" className={styles.diffText}><DiffText diff={essayDiff} view={correctionView} /></p>
            {!essayDiff.detailed && <p className={styles.hint}>Bài có nhiều thay đổi; xem chi tiết từng gợi ý bên dưới. Chưa tô màu toàn bài để tránh đánh dấu sai vị trí.</p>}
            <small>{result.errors.length} câu có gợi ý chỉnh sửa</small>
            <p className={styles.hint}>Chỉ tô màu những thay đổi AI đã đề xuất. Phần không tô màu vẫn có thể còn lỗi.</p>
          </div>}
          {editMap.edits.length > 0 && <section className={styles.reviewChoices} aria-label="Lựa chọn chỉnh sửa">
            <h3>Tự chọn từng thay đổi</h3><p>Trong lượt xem này: {accepted.length} thay đổi đã đưa vào bản nháp · {ignored.length} đã bỏ qua.</p>
            <p className={styles.hint}>Không có thay đổi nào được áp dụng tự động. Lựa chọn chỉ sửa bản nháp, không thay bài đã lưu và không dùng làm nhãn training.</p>
            <p className={styles.hint}>Bản nháp vẫn được giữ khi tải lại; lịch sử hoàn tác chỉ có trong lượt xem hiện tại.</p>
            {!canChooseEdits && !pending && <p className={styles.notice}>Bạn đang tự chỉnh sửa bản nháp. Để tránh ghi đè, nút nhận gợi ý đã khóa. Bạn có thể nộp lại để nhận gợi ý mới hoặc bỏ nháp để trở lại bài đã lưu.</p>}
            <button type="button" disabled={!undo.length || !canChooseEdits} onClick={undoChoice}>Hoàn tác lựa chọn gần nhất</button>
          </section>}
          {editMap.unmapped > 0 && <p className={styles.hint}>Có {editMap.unmapped} gợi ý của bài cũ chưa định vị chắc chắn. Bạn vẫn xem được bản sửa; hãy chỉnh thủ công để tránh áp dụng nhầm câu lặp.</p>}
          {result.errors.map((item, index) => <div className={styles.change} key={index}><span className={styles.changeLabel}>Gợi ý {index + 1}</span>
            <p lang="en" className={styles.inlineSentence}><DiffText diff={sentenceDiffs[index]} /></p>
            {editMap.edits.filter(edit => edit.suggestionIndex === index).map((edit, part) => <div className={styles.editChoice} key={edit.id}>
              <p lang="en"><del>{visibleEdit(edit.before) || "∅"}</del> → <ins>{visibleEdit(edit.after) || "∅"}</ins></p>
              <div className={styles.editActions}><button type="button" disabled={!canChooseEdits} onClick={() => { const span = currentEditPosition(edit, editMap.edits, accepted); locate(span.start, span.end); }}>Xem vị trí {index + 1}.{part + 1}</button>
                <button type="button" disabled={!canChooseEdits || accepted.includes(edit.id) || ignored.includes(edit.id)} onClick={() => chooseEdit(edit, true)}>Nhận thay đổi {index + 1}.{part + 1}</button>
                <button type="button" disabled={!canChooseEdits || accepted.includes(edit.id) || ignored.includes(edit.id)} onClick={() => chooseEdit(edit, false)}>Bỏ qua {index + 1}.{part + 1}</button></div>
              {(accepted.includes(edit.id) || ignored.includes(edit.id)) && <small>{accepted.includes(edit.id) ? "Đã đưa vào bản nháp" : "Đã bỏ qua"}</small>}
            </div>)}
            {!sentenceDiffs[index].detailed && <details><summary>Xem bản đề xuất đầy đủ</summary><p lang="en">{item.suggestion}</p></details>}
            {item.explanations?.map((explanation, explanationIndex) => <p className={styles.explanation} key={explanationIndex}>{explanation.message}</p>)}
          </div>)}
          {result.errors.some(item => Boolean(item.explanations?.length)) && <p className={styles.hint}>Giải thích mô tả gợi ý đang hiển thị; hãy kiểm tra lại tính đúng và ý nghĩa của bản sửa.</p>}
          <section className={styles.feedback} aria-busy={feedbackPending} aria-labelledby="writing-feedback-heading">
            <h3 id="writing-feedback-heading">Nhận xét & gợi ý cải thiện</h3>
            <p className={styles.hint}>Nhận xét tiếng Việt đang thử nghiệm, dùng nội dung bài đã lưu #{result.submissionId}. Không cho điểm số hay chứng nhận trình độ.</p>
            {result.feedback?.status === "ready" ? <>
              <p className={styles.feedbackMessage}>{result.feedback.message}</p>
              {result.feedback.items.map(item => <div className={styles.feedbackItem} key={item.criterion}>
                <h4>{criterionLabels[item.criterion]}</h4><blockquote lang="en">{item.quote}</blockquote>
                <p>{item.comment}</p><p><strong>Bước tiếp theo:</strong> {item.action}</p>
              </div>)}
            </> : <>
              {result.feedback?.status === "unavailable" && <p className={styles.feedbackMessage}>{result.feedback.message}</p>}
              {!writingFeedbackEligible(result) && <p className={styles.hint}>Nhận xét mở rộng hiện hỗ trợ bài đã lưu từ 80–150 từ. Bạn có thể chỉnh sửa rồi nộp thành một bài mới.</p>}
              {capabilities?.feedbackEnabled ? <button type="button" className={styles.feedbackButton} onClick={requestFeedback}
                disabled={!authenticated || pending || feedbackPending || changed || !writingFeedbackEligible(result)}>
                {feedbackPending ? "Đang nhận xét · tối đa 30 giây…" : result.feedback ? "Thử nhận xét lại" : "Nhận xét & gợi ý cải thiện"}
              </button> : <p className={styles.feedbackMessage}>{capabilities?.feedbackStatus === "disabled" ? "Nhận xét mở rộng chưa được bật. Bạn vẫn dùng được gợi ý và giải thích đang hiển thị." : "Chưa xác nhận được khả năng nhận xét. Bài đã lưu vẫn được giữ."}
                {capabilities?.feedbackStatus !== "disabled" && <button type="button" onClick={() => setCapabilityRetry(n => n + 1)}>Kiểm tra trạng thái nhận xét</button>}</p>}
              {changed && capabilities?.feedbackEnabled && <p className={styles.hint}>Hãy nộp bản nháp mới trước khi yêu cầu nhận xét, để tránh nhận xét nhầm bài cũ.</p>}
            </>}
            {feedbackPending && <p className={styles.hint} role="status">CEFR và bài viết đã được lưu. Phần nhận xét đang được xử lý riêng.</p>}
            {feedbackNotice && <p className={styles.error} role="alert">{feedbackNotice}</p>}
          </section>
          <p className={styles.hint}>Hãy đọc lại bài gốc, tự chỉnh sửa rồi nộp lại để luyện tập.</p>
        </> : !pending && <div className={styles.empty}><span><Icon name="book" /></span><h3>Ý tưởng của bạn bắt đầu ở đây</h3><p>Viết một đoạn tiếng Anh và nộp bài để nhận ước lượng CEFR. Bật sửa lỗi nếu bạn muốn nhận thêm gợi ý thử nghiệm.</p><div className={styles.levels}>{levels.map(level => <span key={level}>{level}</span>)}</div></div>}
        <div className={styles.reminder}><Icon name="bulb" /><p><strong>Học từ bài viết của chính mình</strong><br />Kết quả đang thử nghiệm. CEFR chưa đánh giá độ bám đề và không phải điểm IELTS hay chứng chỉ.</p></div>
      </aside>
    </div>
    <WritingHistoryPanel authenticated={authenticated} submissionId={result?.submissionId ?? null} onCompare={compareSubmission} onNavigate={persistBeforeNavigation} />
  </main>;
}
