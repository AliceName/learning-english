"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Icon from "@/components/site-icon";
import { isCefrLevel, isWritingResult, sameWritingCoverage, writingFeedbackEligible, taskWordGuidance, type WritingResult, type WritingTask } from "@/lib/writing";
import { diffWritingText } from "@/lib/writing-diff";
import { applyWritingEdits, currentEditPosition, writingEdits } from "@/lib/writing-revision";
import { isWritingCapabilities, writingInputIssue, type WritingCapabilities } from "@/lib/writing-capabilities";
import { clearWritingDraft, loadPreviousWritingDraft, loadWritingDraft, restorePreviousWritingDraft,
  saveWritingDraft, writingDraftStorage } from "@/lib/writing-draft";
import { writingAuthHref } from "@/lib/writing-return";
import { restoreWritingReview, writingReviewItems, writingReviewStatuses, writingReviewTypes, writingReviewView,
  type WritingReviewDecision, type WritingReviewItem, type WritingReviewStatus, type WritingReviewType } from "@/lib/writing-review";
import { checkWritingPreflight, useWritingPreflight } from "./use-writing-preflight";
import WritingComparison, { DiffText, visibleEdit } from "./writing-comparison";
import WritingHistoryPanel from "./writing-history";
import WritingFlashcards from "./writing-flashcards";
import WritingTaskLibrary, { taskLevels } from "./writing-task-library";
import styles from "./writing.module.css";

const criterionLabels = { content: "Nội dung & bám đề", organization: "Tổ chức & mạch lạc",
  vocabulary: "Từ vựng & văn phong", grammar: "Giải thích chỉnh sửa ngữ pháp" };
const explanationLabels: Record<string, string> = { SPELL: "Chính tả", ARTICLE: "Mạo từ",
  "NOUN:NUM": "Số của danh từ", "VERB:FORM": "Dạng động từ", "VERB:SVA": "Hòa hợp chủ ngữ và động từ" };

export default function WritingForm({ authenticated, unavailable, userId = null, targetLevel = null, draftBaseId = null, initialResult = null, initialNotice = "", initialTask = null, draftTaskId = null, custom = false }: {
  authenticated: boolean; unavailable: boolean; userId?: number | null; draftBaseId?: number | null;
  initialResult?: WritingResult | null; initialNotice?: string;
  initialTask?: WritingTask | null; draftTaskId?: string | null; custom?: boolean; targetLevel?: string | null;
}) {
  const [task, setTask] = useState<WritingTask | null>(initialResult?.task ?? initialTask);
  const [checkedRequirements, setCheckedRequirements] = useState<number[]>([]);
  const [restart, setRestart] = useState(false);
  const [topic, setTopic] = useState(initialResult?.topic ?? initialTask?.title ?? "");
  const [text, setText] = useState(initialResult?.originalText ?? "");
  const [corrections, setCorrections] = useState(initialResult?.correctedText != null);
  const [continued, setContinued] = useState(false);
  const [requestId, setRequestId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState("");
  const [notice, setNotice] = useState(initialNotice);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [result, setResult] = useState<WritingResult | null>(initialResult);
  const [baseId, setBaseId] = useState(initialResult?.submissionId ?? draftBaseId);
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  const [previousDraft, setPreviousDraft] = useState(false);
  const [capabilities, setCapabilities] = useState<WritingCapabilities | null>(null);
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const [decisions, setDecisions] = useState<WritingReviewDecision[]>([]);
  const [typeFilter, setTypeFilter] = useState<WritingReviewType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<WritingReviewStatus | "all">("all");
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
  const composing = !result || continued;
  const preflight = useWritingPreflight(text, corrections, authenticated && draftReady && composing && !pending);
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  const changed = result !== null && (result.originalText !== text || (result.topic ?? "") !== topic.trim()
    || (result.correctedText != null) !== corrections);
  const editMap = useMemo(() => result ? writingEdits(result) : { edits: [], unmapped: 0 }, [result]);
  const reviewItems = useMemo(() => writingReviewItems(result?.errors ?? [], editMap.edits), [result, editMap]);
  const review = useMemo(() => writingReviewView(reviewItems, decisions, typeFilter, statusFilter), [reviewItems, decisions, typeFilter, statusFilter]);
  const accepted = decisions.filter(decision => decision.status === "accepted").map(decision => decision.id);
  const managedText = result ? applyWritingEdits(result.originalText, editMap.edits, accepted) : "";
  const draftPositionsKnown = text === managedText;
  const canReview = draftReady && !pending && !feedbackPending;
  const canChooseEdits = canReview && draftPositionsKnown;
  const lastDecision = decisions.at(-1);
  const comparisonDiff = useMemo(() => comparison && result ? diffWritingText(comparison.originalText, result.originalText) : null, [comparison, result]);
  const checked = preflight.current?.value;
  const inputIssue = writingInputIssue(checked?.inputAssessment);
  const partialSentences = checked?.canAnalyze ? checked.sentences.filter(sentence => sentence.status !== "ready") : [];
  const partialAccepted = partialConsent?.text === text && partialConsent.corrections === corrections;
  const taskScope = task?.id ?? draftTaskId;
  const editing = Boolean(result || task || custom);
  const returnTarget = baseId ? `/writing?submissionId=${baseId}` : taskScope ? `/writing?taskId=${taskScope}` : custom ? "/writing?custom=1" : "/writing";
  const principal = authenticated ? userId : null;
  const preflightBlocksSubmit = !requestId && (checked?.canAnalyze === false || !!inputIssue || (partialSentences.length > 0 && !partialAccepted));

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
        setContinued(Boolean(restored.continued || (result && restored.text !== result.originalText)));
        setRequestId(restored.requestId);
        setDecisions(restoreWritingReview(restored, result?.submissionId, reviewItems));
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
      if (!requestId && !continued && !decisions.length
        && ((matchesSaved && !checkedRequirements.length) || (!text && !task && !topic && !corrections))) {
        clearWritingDraft(storage, principal, baseId, taskScope);
        setDraftStatus(matchesSaved ? `Đang xem bài #${baseId} đã lưu trong tài khoản.` : "Chưa có bản nháp.");
      } else {
        const saved = saveWritingDraft(storage, principal, { topic, text, corrections, task, checkedRequirements, baseSubmissionId: baseId,
          review: decisions, requestId, continued });
        setDraftStatus(saved ? "Bản nháp đã lưu trong phiên trình duyệt này; sẽ giữ khi đăng nhập hoặc tải lại."
          : "Không lưu được nháp trong trình duyệt. Hãy sao chép bài trước khi rời trang.");
      }
    };
    const timer = setTimeout(persist, 0);
    window.addEventListener("pagehide", persist);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", persist); };
  }, [draftReady, unavailable, principal, baseId, topic, text, corrections, result, changed, task, checkedRequirements, taskScope, editing, decisions, continued, requestId]);

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

  function persistBeforeNavigation() { saveDraft(requestId); }

  function saveDraft(key?: string) {
    if (!unavailable && draftReady && editing) saveWritingDraft(writingDraftStorage(), principal, { topic, text, corrections, task,
      checkedRequirements, baseSubmissionId: baseId, review: decisions, requestId: key, continued });
  }

  function continueVersion() {
    if (!result || !draftReady || pending || feedbackPending) return;
    setContinued(true);
    requestAnimationFrame(() => editor.current?.focus());
  }

  function discardDraft() {
    if (!clearWritingDraft(writingDraftStorage(), principal, baseId, taskScope)) {
      setNotice("Không xóa được nháp trong trình duyệt. Bài hiện tại vẫn được giữ; hãy kiểm tra quyền lưu trữ trước khi thử lại."); return;
    }
    setTopic(result?.topic ?? task?.title ?? ""); setText(result?.originalText ?? ""); setCheckedRequirements([]);
    setCorrections(result?.correctedText != null); setDecisions([]);
    setContinued(false); setRequestId(undefined);
    setDraftStatus("Đã bỏ bản nháp. Các bài đã lưu tài khoản vẫn được giữ.");
  }

  function recoverPreviousDraft() {
    if (principal === null || unavailable) return;
    const restored = restorePreviousWritingDraft(writingDraftStorage(), principal, baseId, taskScope);
    if (!restored) { setNotice("Chưa khôi phục được nháp cũ. Bài đang soạn vẫn được giữ."); return; }
    setTopic(restored.topic); setText(restored.text); setCorrections(restored.corrections);
    setTask(restored.task ?? null); setCheckedRequirements(restored.checkedRequirements ?? []);
    setContinued(Boolean(restored.continued || (result && restored.text !== result.originalText)));
    setRequestId(restored.requestId);
    setDecisions(restoreWritingReview(restored, result?.submissionId, reviewItems)); setPreviousDraft(false);
    setDraftStatus("Đã khôi phục nháp của tài khoản trước lần đăng nhập này.");
  }

  function chooseEdit(item: WritingReviewItem, status: WritingReviewDecision["status"]) {
    if (!result || !canReview || decisions.some(decision => decision.id === item.id)) return;
    if (status === "accepted") {
      if (!item.edit || !canChooseEdits) return;
      const nextText = applyWritingEdits(result.originalText, editMap.edits, [...accepted, item.id]);
      if (nextText.length > 12000) { setNotice("Bản sửa vượt giới hạn ký tự. Hãy chỉnh sửa thủ công."); return; }
      setRequestId(undefined);
      setContinued(true);
      setText(nextText);
    }
    setDecisions([...decisions, { id: item.id, status }]);
    if (statusFilter !== "all" && statusFilter !== status) {
      requestAnimationFrame(() => document.getElementById("writing-review-status")?.focus());
    }
  }

  function undoChoice() {
    if (!result || !canReview || !lastDecision) return;
    if (lastDecision.status === "accepted") {
      if (!canChooseEdits) return;
      setRequestId(undefined);
      setText(applyWritingEdits(result.originalText, editMap.edits, accepted.filter(id => id !== lastDecision.id)));
    }
    setDecisions(decisions.slice(0, -1));
  }

  function locate(start: number, end: number) {
    // The DOM textarea collapses CRLF to LF, but the saved text uses raw UTF-16 offsets.
    const editorOffset = (offset: number) => text.slice(0, offset).replace(/\r\n/g, "\n").length;
    editor.current?.focus(); editor.current?.setSelectionRange(editorOffset(start), editorOffset(end));
    editor.current?.scrollIntoView({ behavior: "auto", block: "center" });
  }

  function openSuggestion(id: string) {
    document.getElementById(`writing-suggestion-${id}`)?.focus();
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
    if (!authenticated || !draftReady || !composing) return;
    persistBeforeNavigation();
    const controller = new AbortController();
    activeRequest.current = controller;
    inFlight.current = true;
    setPending(true);
    setRestart(false);
    setPhase("checking"); setElapsed(0); started.current = Date.now();
    setNotice("");
    try {
      if (!requestId) {
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
      }
      setPhase("analyzing");
      const submissionKey = requestId ?? crypto.randomUUID();
      setRequestId(submissionKey);
      saveDraft(submissionKey);
      const response = await fetch("/api/writing/submissions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: task ? undefined : topic, originalText: text, corrections,
          taskId: task?.id, taskVersion: task?.version, parentSubmissionId: result?.submissionId,
          requestId: submissionKey }),
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
      if (!isWritingResult(data) || !data.cefrLevel || (data.parentSubmissionId ?? null) !== (result?.submissionId ?? null)
        || data.originalText !== text || (result && data.practiceRootId !== (result.practiceRootId ?? result.submissionId))
        || data.targetRecorded !== true) {
        setNotice("AI trả về kết quả chưa hợp lệ. Bài viết vẫn được giữ để bạn thử lại.");
        return;
      }
      comparisonRequest.current?.abort();
      if (result) setComparison(result);
      // A reviewed submission keeps its session decisions when reopened from history.
      setRequestId(undefined);
      if (!decisions.length) clearWritingDraft(writingDraftStorage(), principal, baseId, taskScope);
      else saveDraft();
      setResult(data); setBaseId(data.submissionId);
      setContinued(false);
      setDecisions([]); setTypeFilter("all"); setStatusFilter("all"); setPartialConsent(null); setPreviousDraft(false);
      setFeedbackNotice("");
      const savedUrl = new URL(window.location.href);
      savedUrl.search = "";
      savedUrl.searchParams.set("submissionId", String(data.submissionId));
      window.history.replaceState(null, "", savedUrl);
      requestAnimationFrame(() => resultHeading.current?.focus());
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      setNotice(error instanceof Error && error.name !== "TimeoutError" && error.name !== "TypeError"
        ? error.message : "Kết nối bị gián đoạn hoặc hết thời gian. Bạn có thể thử lại cùng bản nháp; hệ thống sẽ kiểm tra lần nộp trước.");
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
        || data.practiceRootId !== saved.practiceRootId || data.parentSubmissionId !== saved.parentSubmissionId
        || data.versionNumber !== saved.versionNumber || data.parentVersionNumber !== saved.parentVersionNumber
        || data.targetCefr !== saved.targetCefr || data.targetRecorded !== saved.targetRecorded
        || !sameWritingCoverage(data.gecCoverage, saved.gecCoverage)
        || data.errors.length !== saved.errors.length
        || data.errors.some((error, index) => error.original !== saved.errors[index].original
          || error.suggestion !== saved.errors[index].suggestion
          || (error.sourceStart ?? null) !== (saved.errors[index].sourceStart ?? null)
          || (error.sourceEnd ?? null) !== (saved.errors[index].sourceEnd ?? null))) {
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

  const form = <form className={styles.editor} onSubmit={submit} aria-busy={pending}>
    <fieldset disabled={!composing || pending || (!draftReady && !unavailable)}>
      <div className={styles.panelHeading}><span className={styles.icon}><Icon name="writing" /></span><h2>{result ? "Chỉnh sửa & nộp lại" : "Bài viết của bạn"}</h2></div>
      {!result && initialTask && task && initialTask.id === task.id && initialTask.version !== task.version && <div className={styles.notice}>
        <p>Đề thư viện đã được cập nhật. Nháp đang giữ yêu cầu cũ; hãy đọc lại đề mới trước khi nộp.</p>
        <button type="button" onClick={() => { setRequestId(undefined); setTask(initialTask); setTopic(initialTask.title); setCheckedRequirements([]); }}>Dùng phiên bản đề mới, giữ nội dung nháp</button>
      </div>}
      {task ? <section className={styles.taskPrompt} aria-label="Tự kiểm yêu cầu đề">
        <h3>Tự kiểm yêu cầu đề</h3><p className={styles.hint}>Hãy tự đánh dấu khi đã đáp ứng. Checklist chưa được chuyên gia kiểm định.</p>
        {task.requirements.map((r, i) => <label className={styles.checkbox} key={i}><input type="checkbox" checked={checkedRequirements.includes(i)} onChange={e => setCheckedRequirements(old => e.target.checked ? [...old, i] : old.filter(n => n !== i))} /><span>{r}</span></label>)}
      </section> : !result && <><label htmlFor="writing-topic">Đề bài riêng (không bắt buộc)</label>
        <textarea id="writing-topic" className={styles.topic} value={topic} maxLength={500} rows={2} onChange={event => { setRequestId(undefined); setTopic(event.target.value); }} placeholder="Nhập hoặc dán đề bài riêng tại đây…" />
        <p className={styles.hint}>Tối đa 500 ký tự.</p></>}
      {authenticated && <p className={styles.hint}>
        <strong>CEFR mục tiêu từ Hồ sơ cá nhân</strong>{" "}
        {isCefrLevel(targetLevel) ? targetLevel : <>Chưa thiết lập. <Link href="/account">Mở Hồ sơ cá nhân</Link></>}
      </p>}
      <label htmlFor="writing-text">Nội dung bài viết <span className={styles.required}>*</span></label>
      <textarea ref={editor} id="writing-text" lang="en" className={styles.essay} placeholder="Start writing in English here…" value={text} onChange={event => { setRequestId(undefined); setText(event.target.value); }} maxLength={12000} rows={13} required aria-describedby="writing-hint writing-count writing-draft-status" />
      <div className={styles.count} id="writing-count"><span><strong>{words}</strong> từ</span><span>{text.length.toLocaleString("vi-VN")} / 12.000 ký tự</span></div>
      <p id="writing-hint" className={styles.hint}>{task && `${taskWordGuidance(task)}. `}Khả năng xử lý của mô hình được kiểm tra trước khi nộp.</p>
      {task && (((task.wordMode === "minimum" || task.wordMode === "range") && words < task.minWords) || (task.wordMode === "range" && words > task.maxWords)) && <p className={styles.hint}>Số từ hiện chưa theo yêu cầu đề. Đây là nhắc độ dài, không phải điểm bám đề.</p>}
      <label className={styles.checkbox}><input type="checkbox" checked={corrections} onChange={event => { setRequestId(undefined); setCorrections(event.target.checked); }} /><span>Thử gợi ý sửa ngữ pháp <small>Đang thử nghiệm · cần kiểm tra lại bản sửa</small></span></label>
      <p className={styles.modeSummary}><strong>{corrections ? "Chế độ: CEFR + gợi ý sửa lỗi thử nghiệm" : "Chế độ: chỉ ước lượng CEFR"}</strong><br />{corrections ? "Bạn tự quyết định từng gợi ý; AI có thể bỏ sót hoặc tạo lỗi mới." : "Lần nộp này sẽ không tìm hoặc đề xuất sửa lỗi ngữ pháp."}</p>
      <div className={styles.draftStatus} id="writing-draft-status"><span role="status">{unavailable ? "Nháp hiện chỉ nằm trên trang này." : !draftReady ? "Đang kiểm tra bản nháp…" : draftStatus || "Nháp sẽ được lưu trong phiên trình duyệt hiện tại."}</span>
        <small>Nháp trong phiên sẽ mất khi đóng phiên trình duyệt; khác với bài đã lưu vào tài khoản.</small>
        <div className={styles.editActions}><button type="button" disabled={!draftReady || unavailable} onClick={discardDraft}>{result ? "Bỏ nháp, trở lại bài đã lưu" : "Xóa bản nháp"}</button>
          {previousDraft && <button type="button" onClick={recoverPreviousDraft}>Khôi phục nháp trước đăng nhập</button>}</div>
      </div>
      {composing && text.trim() && <section className={styles.preflight} aria-labelledby="writing-preflight-heading">
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
      {notice && !restart && <p className={styles.error} role="alert">{notice}</p>}
      <div className={styles.actions}><span><Icon name="shield" />{result ? "Bài nộp lại được lưu trong cùng lượt luyện." : "Nộp thành công để lưu bài vào tài khoản."}</span><button className={styles.submit} type="submit" disabled={!authenticated || !draftReady || !text.trim() || feedbackPending || preflightBlocksSubmit}>{pending ? phase === "checking" ? "Đang kiểm tra…" : "AI đang đọc bài…" : result ? "Nộp lại bài viết" : "Nộp bài & chấm CEFR"}<Icon name="arrow" /></button></div>
    </fieldset>
  </form>;
  if (!editing) return <main id="main-content" className={styles.page}>
    <header className={styles.heading}>
      <div className={styles.sectionHeading}><span className={`${styles.icon} ${styles.primaryIcon}`}><Icon name="writing" /></span><h1>Thư viện đề luyện viết</h1></div>
      <p>Chọn đề theo trình độ, dạng bài hoặc chủ đề.</p>
    </header>
    {notice && <p role="alert" className={styles.notice}>{notice}</p>}
    <WritingTaskLibrary />
    <WritingHistoryPanel authenticated={authenticated} submissionId={null} onCompare={compareSubmission} onNavigate={persistBeforeNavigation} />
  </main>;

  const displayedTask = result ? result.task : task;
  const hasAnnotations = editMap.edits.length > 0;
  return <main id="main-content" className={styles.page}>
    <header className={styles.heading}>
      <div className={styles.toolbar}>
        <Link className={`${styles.secondaryButton} ${styles.backLink}`} href="/writing" prefetch={false} onClick={persistBeforeNavigation}><Icon name="arrow" /> Về thư viện đề</Link>
        {displayedTask && <span className={`${styles.pill} ${styles.taskLevel}`}>{taskLevels[displayedTask.level]}</span>}
        {displayedTask && <span className={styles.pill}>{taskWordGuidance(displayedTask)}</span>}
        {result && <span className={`${styles.pill} ${styles.savedPill}`}><Icon name="check" /> {result.versionNumber ? `Đang xem phiên bản ${result.versionNumber}` : `Đã lưu bài #${result.submissionId}`}</span>}
        {result && continued && <span className={styles.pill}>Bản nháp từ {result.versionNumber ? `phiên bản ${result.versionNumber}` : `bài #${result.submissionId}`}</span>}
      </div>
      <div className={styles.headingBody}>
        <div>
          <h1 ref={resultHeading} tabIndex={-1}>{displayedTask?.title || result?.topic || (result ? "Kết quả bài viết" : "Luyện viết theo đề riêng")}</h1>
          {displayedTask && <p className={styles.promptText} lang="en">{displayedTask.prompt}</p>}
          {result && <p className={styles.hint}>Lượt #{result.practiceRootId ?? result.submissionId}{result.parentSubmissionId
            ? ` · Phát triển từ ${result.parentVersionNumber ? `phiên bản ${result.parentVersionNumber}` : `bài #${result.parentSubmissionId}`}` : ""}
            {" · "}<Link href={`/writing?submissionId=${result.submissionId}`} target="_blank" rel="noopener noreferrer" prefetch={false}>Mở lại bài đã lưu</Link></p>}
        </div>
        {result && <div className={styles.headingActions}>
          {hasAnnotations && <button type="button" className={styles.secondaryButton} aria-pressed={showAnnotations} onClick={() => setShowAnnotations(value => !value)}><Icon name="eye" /> Chú thích</button>}
          <button type="button" className={styles.submit} disabled={pending || feedbackPending || !draftReady} aria-expanded={restart} aria-controls="writing-restart" onClick={() => { setNotice(""); setRestart(value => !value); }}><Icon name="replay" /> Luyện lại từ đầu</button>
        </div>}
      </div>
      {result && <div id="writing-restart" hidden={!restart}>
        {restart && <div className={styles.notice}>
          <p>Bắt đầu lượt riêng với ô viết trống? Thao tác này thay nháp chưa nộp của lượt mới cùng đề.</p>
          <div className={styles.editActions}>
            <Link href={task ? `/writing?taskId=${task.id}` : "/writing?custom=1"} prefetch={false} onClick={event => {
              if (pending || feedbackPending) { event.preventDefault(); return; }
              persistBeforeNavigation();
              const storage = writingDraftStorage();
              if (!clearWritingDraft(storage, principal, null, task?.id)
                || (!task && !saveWritingDraft(storage, principal, { topic, text: "", corrections: false, baseSubmissionId: null }))) {
                event.preventDefault(); setNotice("Chưa tạo được nháp mới. Nội dung vẫn được giữ.");
              }
            }}>Xác nhận bắt đầu lượt mới</Link>
            <button type="button" onClick={() => setRestart(false)}>Giữ bài hiện tại</button>
          </div>
          {notice && <p className={styles.error} role="alert">{notice}</p>}
        </div>}
      </div>}
    </header>
    {!authenticated && <div className={styles.notice}>{unavailable ? "Chưa kết nối được tài khoản. Bạn có thể soạn bài; hãy sao chép bài trước khi rời trang vì chưa xác định được nơi lưu nháp." : <>Bạn có thể soạn và giữ nháp trong phiên này. <Link href={writingAuthHref("login", returnTarget)} onClick={persistBeforeNavigation}>Đăng nhập và tiếp tục bài viết</Link> để chấm và lưu vào tài khoản.</>}</div>}
    {authenticated && capabilities?.status === "unavailable" && <div className={styles.notice} role="status">AI hiện chưa kết nối được. Bản nháp vẫn được giữ. <button type="button" onClick={() => { setCapabilityRetry(n => n + 1); preflight.retry(); }}>Kiểm tra lại dịch vụ</button></div>}
    {capabilities?.busy && <p className={styles.hint} role="status">AI đang xử lý một yêu cầu khác. Bạn vẫn có thể soạn và kiểm tra giới hạn.</p>}
    {pending && <div className={styles.pending} role="status"><strong>{phase === "checking" ? "Đang kiểm tra giới hạn" : "Đang phân tích bài viết"} · {elapsed} giây</strong><p>Máy chủ sẽ xác nhận khi lưu bài thành công.</p></div>}
    {result ? <>
      {review.total > 0 && <section className={styles.reviewControls} aria-labelledby="writing-review-heading">
        <div className={styles.toolbar}>
          <h2 id="writing-review-heading">Xem xét gợi ý</h2>
          <label>Loại gợi ý
            <select value={typeFilter} onChange={event => setTypeFilter(event.target.value as typeof typeFilter)}>
              <option value="all">Tất cả loại</option>
              {Object.entries(writingReviewTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Trạng thái
            <select id="writing-review-status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(writingReviewStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {(typeFilter !== "all" || statusFilter !== "all") && <button type="button" onClick={() => {
            setTypeFilter("all"); setStatusFilter("all");
            document.getElementById("writing-review-status")?.focus();
          }}>Xóa bộ lọc</button>}
        </div>
        <div className={styles.reviewStats}>
          <p role="status">Tổng {review.total} · Đã nhận {review.accepted} · Đã bỏ qua {review.skipped} · Chưa xử lý {review.pending}</p>
          <span>{Math.round(review.percent ?? 0)}% đã xem xét</span>
        </div>
        <progress aria-label="Tiến độ xem xét toàn bộ gợi ý" value={review.accepted + review.skipped} max={review.total} />
        <p className={styles.hint} role="status">Đang hiển thị {review.visible.length}/{review.total} gợi ý.</p>
      </section>}
      <WritingComparison result={result} draft={text}
        draftPositionsKnown={draftPositionsKnown} edits={editMap.edits} accepted={accepted} visibleIds={review.visibleIds}
        showAnnotations={showAnnotations} onSelect={openSuggestion}
        onEdit={continueVersion} continued={continued} editDisabled={pending || feedbackPending || !draftReady} />
      <div className={styles.reviewGrid}>
        <section className={styles.review} aria-labelledby="writing-suggestions-heading">
          <div className={styles.sectionHeading}><span className={styles.icon}><Icon name="writing" /></span><h2 id="writing-suggestions-heading">Chi tiết gợi ý sửa bài</h2></div>
          {result.warnings.length > 0 && <div className={styles.limits}>{result.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
          {result.errors.length === 0 && <p className={styles.hint}>{result.correctedText === null ? "Chưa có phân tích ngữ pháp cho bài này." : "Không có gợi ý được trả về. Hãy tự kiểm tra lại bài gốc."}</p>}
          {result.correctedText !== null && result.correctedText !== result.originalText &&
            <details className={styles.proposal}><summary>Xem toàn bộ bản AI đề xuất đã lưu</summary><p lang="en">{result.correctedText}</p>
              {result.errors.flatMap(item => item.explanations ?? [])
                .filter(explanation => !reviewItems.some(item => item.explanations.includes(explanation)))
                .map((explanation, index) => <p className={styles.hint} key={index}>{explanation.message}</p>)}
            </details>}
          {comparison && comparison.submissionId !== result.submissionId && <section className={styles.comparison} aria-label="Đối chiếu hai bài đã lưu">
            <h3>Đối chiếu với bài #{comparison.submissionId}</h3>
            <p>CEFR: <strong>{comparison.cefrLevel} → {result.cefrLevel}</strong>. Số câu có gợi ý: <strong>{comparison.errors.length} → {result.errors.length}</strong>.</p>
            <p className={styles.hint}>Số gợi ý không phải điểm chất lượng. Sửa vài lỗi có thể không làm đổi mức CEFR. Hai bài có thể khác đề; hãy tự kiểm tra nội dung.</p>
            {comparisonDiff && <details><summary>Xem thay đổi giữa hai bài</summary><p lang="en" className={styles.diffText}><DiffText diff={comparisonDiff} /></p>
              {!comparisonDiff.detailed && <p lang="en" className={styles.diffText}>{result.originalText}</p>}</details>}
            <button type="button" onClick={() => { comparisonRequest.current?.abort(); setComparison(null); }}>Đóng đối chiếu</button>
          </section>}
          {compareNotice && <p className={styles.error} role="alert">{compareNotice}</p>}
          {review.total > 0 && <section className={styles.reviewChoices} aria-label="Lựa chọn chỉnh sửa">
            <p className={styles.hint}>Lựa chọn được lưu cùng bản nháp trong phiên trình duyệt.</p>
            {!draftPositionsKnown && <p className={styles.notice}>Bản nháp đã được sửa riêng. Bạn vẫn có thể bỏ qua gợi ý. Áp dụng hoặc hoàn tác thay đổi đã nhận cần bản nháp khớp với các lựa chọn.</p>}
            <button type="button" disabled={!canReview || !lastDecision || (lastDecision.status === "accepted" && !draftPositionsKnown)} onClick={undoChoice}>Hoàn tác lựa chọn gần nhất</button>
          </section>}
          {review.total > 0 && review.visible.length === 0 && <p className={styles.hint}>Không có gợi ý phù hợp với bộ lọc.</p>}
          {review.visible.map(item => {
            const suggestion = result.errors[item.suggestionIndex];
            const edit = item.edit;
            return <article className={styles.change} key={item.id} data-review-id={item.id}>
            <div className={styles.toolbar}>
              <h3 id={`writing-suggestion-${item.id}`} tabIndex={-1}>Gợi ý {item.number}</h3>
              <span className={styles.pill}>{writingReviewTypes[item.type]}</span>
              <span className={styles.pill}>{writingReviewStatuses[item.status]}</span>
            </div>
            <div className={styles.suggestionPair}>
              <div><h4>Bạn đã viết</h4><p lang="en">{visibleEdit(edit?.before ?? suggestion.original) || "∅"}</p></div>
              <div><h4>Đề xuất của AI</h4><p lang="en">{visibleEdit(edit?.after ?? suggestion.suggestion) || "∅"}</p></div>
            </div>
            {edit && edit.before !== suggestion.original && <details className={styles.suggestionContext}>
              <summary>Xem câu gốc</summary><p lang="en">{suggestion.original}</p>
            </details>}
            <div className={styles.editActions}>
              {edit && <><button type="button" disabled={!canChooseEdits} onClick={() => { const span = currentEditPosition(edit, editMap.edits, accepted); continueVersion(); requestAnimationFrame(() => locate(span.start, span.end)); }}>Xem vị trí {item.number}</button>
                <button type="button" disabled={!canChooseEdits || item.status !== "pending"} onClick={() => chooseEdit(item, "accepted")}>Nhận thay đổi {item.number}</button></>}
              <button type="button" disabled={!canReview || item.status !== "pending"} onClick={() => chooseEdit(item, "skipped")}>Bỏ qua {item.number}</button>
            </div>
            {!edit && <p className={styles.hint}>Vị trí chưa xác định chắc chắn. Bạn có thể tự sửa trong bản nháp.</p>}
            {item.explanations.map((explanation, explanationIndex) => <div className={styles.explanation} key={explanationIndex}>
              <Icon name="bulb" /><p>{Object.hasOwn(explanationLabels, explanation.category) && <strong>{explanationLabels[explanation.category]}. </strong>}{explanation.message}</p>
            </div>)}
          </article>; })}
          {review.visible.some(item => item.explanations.length > 0) && <p className={styles.hint}>Hãy kiểm tra ý nghĩa của gợi ý trong ngữ cảnh bài viết.</p>}
        </section>
        <aside className={styles.feedback} aria-busy={feedbackPending} aria-labelledby="writing-feedback-heading">
          <div className={styles.sectionHeading}><span className={styles.icon}><Icon name="sparkles" /></span><h2 id="writing-feedback-heading">Nhận xét & gợi ý cải thiện</h2></div>
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
            {capabilities?.feedbackEnabled ? <button type="button" onClick={requestFeedback}
              disabled={!authenticated || pending || feedbackPending || changed || !writingFeedbackEligible(result)}>
              {feedbackPending ? "Đang nhận xét · tối đa 30 giây…" : result.feedback ? "Thử nhận xét lại" : "Nhận xét & gợi ý cải thiện"}
            </button> : <p className={styles.feedbackMessage}>{capabilities?.feedbackStatus === "disabled" ? "Nhận xét mở rộng chưa được bật. Bạn vẫn dùng được gợi ý và giải thích đang hiển thị." : "Chưa xác nhận được khả năng nhận xét. Bài đã lưu vẫn được giữ."}
              {capabilities?.feedbackStatus !== "disabled" && <button type="button" onClick={() => setCapabilityRetry(n => n + 1)}>Kiểm tra trạng thái nhận xét</button>}</p>}
            {changed && capabilities?.feedbackEnabled && <p className={styles.hint}>Hãy nộp bản nháp mới trước khi yêu cầu nhận xét, để tránh nhận xét nhầm bài cũ.</p>}
          </>}
          {feedbackPending && <p className={styles.hint} role="status">CEFR và bài viết đã được lưu. Phần nhận xét đang được xử lý riêng.</p>}
          {feedbackNotice && <p className={styles.error} role="alert">{feedbackNotice}</p>}
        </aside>
      </div>
      {continued && form}
    </> : <div className={styles.reviewGrid}>
      {form}
      <aside className={styles.feedback}>
        <div className={styles.sectionHeading}><span className={styles.icon}><Icon name="sparkles" /></span><h2>Kết quả phân tích</h2></div>
        <p className={styles.hint}>Nộp bài để xem ước lượng CEFR. Bạn có thể bật gợi ý sửa ngữ pháp trong ô viết.</p>
      </aside>
    </div>}
    {authenticated && result && <WritingFlashcards key={result.submissionId} submissionId={result.submissionId}
      versionNumber={result.versionNumber} targetCefr={result.targetCefr} />}
    <WritingHistoryPanel authenticated={authenticated} submissionId={result?.submissionId ?? null} practiceRootId={result?.practiceRootId ?? result?.submissionId}
      onCompare={compareSubmission} onNavigate={persistBeforeNavigation} />
  </main>;
}
