"use client";

import { recordLearningInteraction, notifyLearningActivity } from "@/lib/learning-activity";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Icon from "@/components/site-icon";
import { InfoTip } from "./info-tip";
import { isCefrLevel, isWritingResult, sameWritingCoverage, writingFeedbackEligible, taskWordGuidance, type WritingResult, type WritingTask } from "@/lib/writing";
import { diffWritingText } from "@/lib/writing-diff";
import { applyWritingEdits, currentEditPosition, editInDraft, writingEdits } from "@/lib/writing-revision";
import { isWritingCapabilities, writingInputIssue, type WritingCapabilities } from "@/lib/writing-capabilities";
import { clearWritingDraft, loadPreviousWritingDraft, loadWritingDraft, restorePreviousWritingDraft,
  saveWritingDraft, writingDraftStorage } from "@/lib/writing-draft";
import { writingAuthHref } from "@/lib/writing-return";
import { restoreWritingReview, writingCategoryLabels, writingReviewItems, writingReviewStatuses, writingReviewTypes, writingReviewView,
  type WritingReviewDecision, type WritingReviewItem, type WritingReviewStatus, type WritingReviewType } from "@/lib/writing-review";
import { hideAnswerFirst, locateSentence, nextSteps, practiceOrder, progressiveReview, revealLimit, reviewExhausted, improvedSentences, sentenceShades, suggestedMinutes, targetAboveTask } from "@/lib/writing-practice";
import { checkWritingPreflight, useWritingPreflight } from "./use-writing-preflight";
import { RevisionChecklistPanel, SelfCheck, TaskPrompt, VersionProgressCard } from "./writing-practice-panels";
import WritingComparison, { DiffText, visibleEdit, WritingSummary } from "./writing-comparison";
import WritingHistoryPanel from "./writing-history";
import WritingFlashcards from "./writing-flashcards";
import WritingUpgrades from "./writing-upgrades";
import WritingTaskLibrary, { taskLevels } from "./writing-task-library";
import styles from "./writing.module.css";

const criterionLabels = { content: "Nội dung & bám đề", organization: "Tổ chức & mạch lạc",
  vocabulary: "Từ vựng & văn phong", grammar: "Giải thích chỉnh sửa ngữ pháp" };
const taskBands: Record<string, string> = { Beginner: "A1–A2", Intermediate: "B1–B2", Advanced: "C1–C2" };

const standingWarning = /^(CEFR là ước lượng thử nghiệm|CEFR không xét độ bám đề|Bản sửa là gợi ý thử nghiệm|Chưa có gợi ý thay đổi không có nghĩa|Một số gợi ý sửa rủi ro|Gợi ý sửa do AI bên ngoài)/u;

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
  // New essays ask for grammar suggestions by default; a saved essay keeps the mode it was checked with.
  const [corrections, setCorrections] = useState(initialResult ? initialResult.correctedText != null : true);
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
  const [capabilityCheck, setCapabilityCheck] = useState<"idle" | "checking" | "done">("idle");
  const [decisions, setDecisions] = useState<WritingReviewDecision[]>([]);
  const [typeFilter, setTypeFilter] = useState<WritingReviewType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<WritingReviewStatus | "all">("all");
  const [comparison, setComparison] = useState<WritingResult | null>(null);
  const [compareNotice, setCompareNotice] = useState("");
  const [partialConsent, setPartialConsent] = useState<{ text: string; corrections: boolean } | null>(null);
  const [phase, setPhase] = useState<"checking" | "analyzing">("checking");
  const [elapsed, setElapsed] = useState(0);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [shownAnswers, setShownAnswers] = useState<string[]>([]);
  const [selfFixNotice, setSelfFixNotice] = useState("");
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
  const typeCounts = useMemo(() => reviewItems.reduce((counts, item) => counts.set(item.type, (counts.get(item.type) ?? 0) + 1),
    new Map<WritingReviewType, number>()), [reviewItems]);
  const steps = useMemo(() => result ? nextSteps(result) : [], [result]);
  // Standing caveats go behind a "!" icon; CEFR caveats sit on the CEFR card. Specific warnings stay visible.
  const generalWarnings = (result?.warnings ?? []).filter(warning => standingWarning.test(warning) && !warning.startsWith("CEFR"));
  const specificWarnings = (result?.warnings ?? []).filter(warning => !standingWarning.test(warning));
  // Show a few undecided suggestions at a time (Write & Improve-style), in text order.
  const practice = useMemo(() => progressiveReview(practiceOrder(review.visible), revealLimit((result?.task ?? task)?.level), showAllSuggestions),
    [review.visible, result?.task, task, showAllSuggestions]);
  const shownIds = useMemo(() => new Set(practice.shown.map(item => item.id)), [practice]);
  // Sentence shading uses every suggestion (also those not revealed yet), like Write & Improve.
  const allEntries = useMemo(() => writingReviewView(reviewItems, decisions, "all", "all").visible, [reviewItems, decisions]);
  const statusById = useMemo(() => new Map(allEntries.map(item => [item.id, item.status])), [allEntries]);
  const shades = useMemo(() => result ? sentenceShades(result.originalText, result.errors, allEntries) : [], [result, allEntries]);
  const [sentenceFocus, setSentenceFocus] = useState<number | null>(null);
  const accepted = decisions.filter(decision => decision.status === "accepted").map(decision => decision.id);
  const managedText = result ? applyWritingEdits(result.originalText, editMap.edits, accepted) : "";
  const draftPositionsKnown = text === managedText;
  const canReview = draftReady && !pending && !feedbackPending;
  const canChooseEdits = canReview && draftPositionsKnown;
  // After hand edits the exact positions are gone, but an edit can still be applied where the learner did not touch it.
  // One word diff per draft change, shared by every suggestion card.
  const draftDiff = useMemo(() => text === managedText ? undefined : diffWritingText(managedText, text), [managedText, text]);
  const draftEdit = (edit: WritingReviewItem["edit"]) =>
    result && edit && canReview ? editInDraft(result.originalText, text, edit, editMap.edits, accepted, draftDiff) : null;
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
  // The experimental qualitative-feedback column is hidden while the runtime has it switched off.
  const showFeedbackPanel = Boolean(result?.feedback) || capabilities?.feedbackStatus !== "disabled";
  // Limits are only shown when something needs the learner's attention.
  const preflightProblem = !authenticated || Boolean(preflight.current?.error) || (checked != null && (!checked.canAnalyze
    || Boolean(inputIssue) || (checked.inputAssessment?.warnings.length ?? 0) > 0
    || (corrections && !checked.correctionsEnabled) || partialSentences.length > 0));
  const preflightBlocksSubmit =!requestId && (checked?.canAnalyze === false || !!inputIssue || (partialSentences.length > 0 && !partialAccepted));

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
        setShownAnswers(restored.baseSubmissionId === result?.submissionId ? restored.shownAnswers ?? [] : []);
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
      if (!requestId && !continued && !decisions.length && !shownAnswers.length
        && ((matchesSaved && !checkedRequirements.length) || (!text && !task && !topic && !corrections))) {
        clearWritingDraft(storage, principal, baseId, taskScope);
        setDraftStatus(matchesSaved ? `Đang xem bài #${baseId} đã lưu trong tài khoản.` : "Chưa có bản nháp.");
      } else {
        const saved = saveWritingDraft(storage, principal, { topic, text, corrections, task, checkedRequirements, baseSubmissionId: baseId,
          review: decisions, shownAnswers, requestId, continued });
        setDraftStatus(saved ? "Bản nháp đã lưu trong phiên trình duyệt này; sẽ giữ khi đăng nhập hoặc tải lại."
          : "Không lưu được nháp trong trình duyệt. Hãy sao chép bài trước khi rời trang.");
      }
    };
    const timer = setTimeout(persist, 0);
    window.addEventListener("pagehide", persist);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", persist); };
  }, [draftReady, unavailable, principal, baseId, topic, text, corrections, result, changed, task, checkedRequirements, taskScope, editing, decisions, shownAnswers, continued, requestId]);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    fetch("/api/writing/capabilities", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const value: unknown = await response.json();
        if (!response.ok || !isWritingCapabilities(value)) throw new Error("Invalid capabilities");
        if (!controller.signal.aborted) setCapabilities(value);
      }).catch(() => { if (!controller.signal.aborted) setCapabilities(null); })
      .finally(() => { if (!controller.signal.aborted) setCapabilityCheck(state => state === "checking" ? "done" : state); });
    return () => controller.abort();
  }, [authenticated, capabilityRetry]);

  // Suggestions are on by default; when the AI service runs without GEC, fall back to
  // CEFR-only instead of blocking the first submission.
  const correctionsUnavailable = capabilities?.correctionsEnabled === false;
  useEffect(() => {
    if (!correctionsUnavailable) return;
    queueMicrotask(() => setCorrections(false));
  }, [correctionsUnavailable]);

  // Reopening a later version loads the version it came from, for the progress card.
  const parentId = result?.parentSubmissionId ?? null;
  useEffect(() => {
    if (!authenticated || parentId === null || comparison !== null) return;
    void compareSubmission(parentId);
    // compareSubmission is stable enough here: it only reads refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, parentId]);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  function persistBeforeNavigation() { saveDraft(requestId); }

  function saveDraft(key?: string) {
    if (!unavailable && draftReady && editing) saveWritingDraft(writingDraftStorage(), principal, { topic, text, corrections, task,
      checkedRequirements, baseSubmissionId: baseId, review: decisions, shownAnswers, requestId: key, continued });
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
    setCorrections(result ? result.correctedText != null : true); setDecisions([]); setShownAnswers([]);
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
    setShownAnswers(restored.baseSubmissionId === result?.submissionId ? restored.shownAnswers ?? [] : []);
    setDraftStatus("Đã khôi phục nháp của tài khoản trước lần đăng nhập này.");
  }

  function chooseEdit(item: WritingReviewItem, status: WritingReviewDecision["status"]) {
    if (!result || !canReview || decisions.some(decision => decision.id === item.id)) return;
    if (status === "accepted") {
      const span = draftEdit(item.edit);
      if (!item.edit || !span) return;
      const nextText = canChooseEdits ? applyWritingEdits(result.originalText, editMap.edits, [...accepted, item.id])
        : text.slice(0, span.start) + item.edit.after + text.slice(span.end);
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
      const edit = editMap.edits.find(item => item.id === lastDecision.id);
      const span = edit ? draftEdit(edit) : null;
      if (!edit || !span) { setNotice("Bạn đã sửa tay đúng chỗ này nên không hoàn tác tự động được. Hãy sửa lại trong bản nháp."); return; }
      setRequestId(undefined);
      setText(canChooseEdits ? applyWritingEdits(result.originalText, editMap.edits, accepted.filter(id => id !== lastDecision.id))
        : text.slice(0, span.start) + edit.before + text.slice(span.end));
    }
    setDecisions(decisions.slice(0, -1));
  }

  function locate(start: number, end: number) {
    // The DOM textarea collapses CRLF to LF, but the saved text uses raw UTF-16 offsets.
    const editorOffset = (offset: number) => text.slice(0, offset).replace(/\r\n/g, "\n").length;
    editor.current?.focus(); editor.current?.setSelectionRange(editorOffset(start), editorOffset(end));
    editor.current?.scrollIntoView({ behavior: "auto", block: "center" });
  }

  // Exact edit span while it is still untouched in the draft; otherwise the
  // suggestion's original sentence, found again in the hand-edited draft.
  function selfFix(id: string, edit: WritingReviewItem["edit"], suggestion: WritingResult["errors"][number]) {
    const span = (edit && draftPositionsKnown ? currentEditPosition(edit, editMap.edits, accepted) : draftEdit(edit))
      ?? locateSentence(text, suggestion.original, suggestion.sourceStart ?? edit?.start ?? 0);
    setSelfFixNotice(span ? "" : id);
    if (!span) return;
    continueVersion();
    requestAnimationFrame(() => locate(span.start, span.end));
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
      notifyLearningActivity();
      comparisonRequest.current?.abort();
      if (result) setComparison(result);
      // A reviewed submission keeps its session decisions when reopened from history.
      setRequestId(undefined);
      if (!decisions.length) clearWritingDraft(writingDraftStorage(), principal, baseId, taskScope);
      else saveDraft();
      setResult(data); setBaseId(data.submissionId);
      setContinued(false);
      setDecisions([]); setTypeFilter("all"); setStatusFilter("all"); setPartialConsent(null); setPreviousDraft(false);
      setShownAnswers([]); setShowAllSuggestions(false); setSentenceFocus(null);
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
      {!task && !result && <><label htmlFor="writing-topic">Đề bài riêng (không bắt buộc)</label>
        <textarea id="writing-topic" className={styles.topic} value={topic} maxLength={500} rows={2} onChange={event => { setRequestId(undefined); setTopic(event.target.value); }} placeholder="Nhập hoặc dán đề bài riêng tại đây…" />
        <p className={styles.hint}>Tối đa 500 ký tự.</p></>}
      {result && task && <SelfCheck requirements={task.requirements} />}
      <label htmlFor="writing-text">Nội dung bài viết <span className={styles.required}>*</span></label>
      <textarea ref={editor} id="writing-text" lang="en" className={styles.essay} placeholder="Start writing in English here…" value={text} onChange={event => {
        const value = event.target.value;
        setRequestId(undefined); setText(value);
        if (authenticated && value.trim()) void recordLearningInteraction("writing");
      }} maxLength={12000} rows={13} required aria-describedby="writing-hint writing-count writing-draft-status" />
      <div className={styles.count} id="writing-count"><span><strong>{words}</strong> từ</span><span>{text.length.toLocaleString("vi-VN")} / 12.000 ký tự</span></div>
      {task && <p id="writing-hint" className={styles.hint}>{taskWordGuidance(task)}.</p>}
      {task && (((task.wordMode === "minimum" || task.wordMode === "range") && words < task.minWords) || (task.wordMode === "range" && words > task.maxWords)) && <p className={styles.hint}>Số từ hiện chưa theo yêu cầu đề.</p>}
      <label className={styles.checkbox}><input type="checkbox" checked={corrections} onChange={event => { setRequestId(undefined); setCorrections(event.target.checked); }} /><span>Gợi ý sửa lỗi ngữ pháp <small>Bỏ chọn nếu chỉ muốn ước lượng CEFR</small></span></label>
      {!corrections && <p className={styles.modeSummary}>Lần nộp này chỉ ước lượng CEFR, không có gợi ý sửa lỗi.</p>}
      <div className={styles.draftStatus} id="writing-draft-status"><span role="status">{unavailable ? "Nháp hiện chỉ nằm trên trang này." : !draftReady ? "Đang kiểm tra bản nháp…" : draftStatus || "Nháp sẽ được lưu trong phiên trình duyệt hiện tại."}</span>
        <div className={styles.editActions}><button type="button" disabled={!draftReady || unavailable} onClick={discardDraft}>{result ? "Bỏ nháp, trở lại bài đã lưu" : "Xóa bản nháp"}</button>
          {previousDraft && <button type="button" onClick={recoverPreviousDraft}>Khôi phục nháp trước đăng nhập</button>}</div>
      </div>
      {composing && text.trim() && preflightProblem && <section className={styles.preflight} aria-labelledby="writing-preflight-heading">
        <h3 id="writing-preflight-heading">Cần xem trước khi nộp<InfoTip label="Kiểm tra này làm gì?">Chỉ kiểm tra giới hạn xử lý; không xác nhận bài đúng tiếng Anh, đúng đề hay có chất lượng tốt.</InfoTip></h3>
        {!authenticated ? <p>Đăng nhập để kiểm tra khả năng xử lý bằng mô hình. Bản nháp của bạn được giữ trong phiên.</p>
          : !preflight.current ? <p role="status">Đang kiểm tra giới hạn của bài hiện tại…</p>
          : preflight.current.error ? <p className={styles.error}>{preflight.current.error} <button type="button" onClick={preflight.retry}>Kiểm tra lại</button></p>
          : checked ? <>
            {!checked.canAnalyze && <p>Bài quá dài để chấm CEFR. Hãy rút ngắn bài trước khi nộp.</p>}
            {inputIssue && <p className={styles.error} role="status">{inputIssue}</p>}
            {checked.inputAssessment?.warnings.map(warning => <p key={warning} className={styles.hint}>{warning}</p>)}
            {checked.canAnalyze && corrections && !checked.correctionsEnabled && <p>Gợi ý sửa lỗi chưa được bật. Hãy bỏ chọn sửa lỗi nếu bạn muốn chấm CEFR.</p>}
            {checked.canAnalyze && corrections && checked.correctionsEnabled && partialSentences.length > 0 && <p>Có thể sửa {checked.sentences.filter(sentence => sentence.status === "ready").length}/{checked.sentences.length} câu thân bài. Tối đa {checked.gecSentenceLimit} câu mỗi lượt.</p>}
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
      <div className={styles.actions}><span><Icon name="shield" />{result ? "Bài nộp lại được lưu trong cùng lượt luyện." : "Nộp thành công để lưu bài vào tài khoản."}</span><button className={styles.submit} type="submit" disabled={!authenticated || !draftReady || !text.trim() || feedbackPending || preflightBlocksSubmit}>{pending ? phase === "checking" ? "Đang kiểm tra…" : "AI đang đọc bài…" : result ? "Nộp lại bài viết" : corrections ? "Nộp để nhận phản hồi" : "Nộp & ước lượng CEFR"}<Icon name="arrow" /></button></div>
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
        {displayedTask && <span className={styles.pill} title="Gồm lập ý, viết và tự soát lại; chỉ là gợi ý, không giới hạn thời gian.">
          <Icon name="clock" /> Gợi ý khoảng {suggestedMinutes(displayedTask)} phút</span>}
        {result && <span className={`${styles.pill} ${styles.savedPill}`}><Icon name="check" /> {result.versionNumber ? `Đang xem phiên bản ${result.versionNumber}` : `Đã lưu bài #${result.submissionId}`}</span>}
        {result && continued && <span className={styles.pill}>Bản nháp từ {result.versionNumber ? `phiên bản ${result.versionNumber}` : `bài #${result.submissionId}`}</span>}
        {authenticated && (isCefrLevel(targetLevel)
          ? <span className={styles.pill}>Mục tiêu {targetLevel}</span>
          : <Link className={styles.pill} href="/account">Đặt CEFR mục tiêu</Link>)}
      </div>
      {authenticated && displayedTask && targetAboveTask(displayedTask.level, targetLevel) && <p className={styles.hint}>
        Đề {displayedTask.level} thường chỉ thể hiện được mức {taskBands[displayedTask.level]}; muốn luyện mức {targetLevel}, hãy chọn đề khó hơn.</p>}
      <div className={styles.headingBody}>
        <div>
          <h1 ref={resultHeading} tabIndex={-1}>{displayedTask?.title || result?.topic || (result ? "Kết quả bài viết" : "Luyện viết theo đề riêng")}</h1>
          {displayedTask && <TaskPrompt prompt={displayedTask.prompt} />}
          {result && <p className={styles.hint}>Lượt #{result.practiceRootId ?? result.submissionId}{result.parentSubmissionId
            ? ` · Phát triển từ ${result.parentVersionNumber ? `phiên bản ${result.parentVersionNumber}` : `bài #${result.parentSubmissionId}`}` : ""}
            {" · "}<Link href={`/writing?submissionId=${result.submissionId}`} target="_blank" rel="noopener noreferrer" prefetch={false}>Mở lại bài đã lưu</Link></p>}
        </div>
        {result && <div className={styles.headingActions}>
          {hasAnnotations && <button type="button" className={styles.secondaryButton} aria-pressed={showAnnotations} onClick={() => setShowAnnotations(value => !value)}><Icon name="eye" /> Chú thích</button>}
          {!continued && <button type="button" className={styles.submit} disabled={pending || feedbackPending || !draftReady} onClick={continueVersion}><Icon name="writing" /> Sửa bài này</button>}
          <button type="button" className={styles.secondaryButton} disabled={pending || feedbackPending || !draftReady} aria-expanded={restart} aria-controls="writing-restart" onClick={() => { setNotice(""); setRestart(value => !value); }}><Icon name="replay" /> Luyện lại từ đầu</button>
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
                || (!task && !saveWritingDraft(storage, principal, { topic, text: "", corrections: true, baseSubmissionId: null }))) {
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
      <WritingSummary result={result} />
      {steps.length > 0 && <section className={styles.nextSteps} aria-labelledby="writing-next-steps-heading">
        <div className={styles.sectionHeading}><span className={styles.icon}><Icon name="bulb" /></span><h2 id="writing-next-steps-heading">Nên làm tiếp<InfoTip label="Các bước này dựa trên gì?">Dựa trên loại lỗi, độ bám đề và độ dài bài. Không phải điểm số.</InfoTip></h2></div>
        <ol>{steps.map(step => <li key={step.key}>
          <h3>{step.title}{step.count ? <span className={styles.pill}>{step.count} {step.key === "points" ? "ý" : "chỗ"}</span> : null}</h3>
          <p>{step.detail}</p>
        </li>)}</ol>
      </section>}
      {comparison && comparison.submissionId === result.parentSubmissionId && <VersionProgressCard previous={comparison} current={result} />}
      {review.total > 0 && <section className={styles.reviewControls} aria-labelledby="writing-review-heading">
        <h2 id="writing-review-heading">Xem xét gợi ý<InfoTip label="Lưu ý về gợi ý của AI">AI có thể sai hoặc bỏ sót lỗi — bạn quyết định từng gợi ý.</InfoTip></h2>
        <div className={styles.typeChips} role="group" aria-label="Lọc gợi ý theo loại lỗi">
          <button type="button" aria-pressed={typeFilter === "all"} onClick={() => setTypeFilter("all")}>Tất cả <span>{reviewItems.length}</span></button>
          {(Object.keys(writingReviewTypes) as WritingReviewType[]).filter(type => typeCounts.has(type)).map(type =>
            <button type="button" key={type} className={styles[`chip_${type}`]} aria-pressed={typeFilter === type}
              onClick={() => setTypeFilter(value => value === type ? "all" : type)}>
              {writingReviewTypes[type]} <span>{typeCounts.get(type)}</span></button>)}
        </div>
        <details className={styles.filters} open={statusFilter !== "all"}><summary>Lọc theo trạng thái</summary>
        <div className={styles.toolbar}>
          <label>Trạng thái
            <select id="writing-review-status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(writingReviewStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {statusFilter !== "all" && <button type="button" onClick={() => {
            setStatusFilter("all");
            document.getElementById("writing-review-status")?.focus();
          }}>Xóa bộ lọc trạng thái</button>}
        </div>
        </details>
        <div className={styles.reviewStats}>
          <p role="status">Tổng {review.total} · Đã tự sửa {review.selfFixed} · Đã nhận {review.accepted} · Đã bỏ qua {review.skipped} · Chưa xử lý {review.pending}</p>
          <span>{Math.round(review.percent ?? 0)}% đã xem xét</span>
        </div>
        <progress aria-label="Tiến độ xem xét toàn bộ gợi ý" value={review.reviewed} max={review.total} />
        <p className={styles.hint} role="status">Đang hiển thị {practice.shown.length}/{review.total} gợi ý.</p>
        {(practice.hidden > 0 || showAllSuggestions) && <div className={styles.revealNotice}>
          <p>{showAllSuggestions ? "Đang hiện mọi gợi ý cùng lúc." : `Mỗi lượt hiện ${revealLimit((result.task ?? task)?.level)} gợi ý chưa xử lý; còn ${practice.hidden} gợi ý sẽ hiện khi bạn xử lý các gợi ý trên.`}</p>
          <button type="button" onClick={() => setShowAllSuggestions(value => !value)}>{showAllSuggestions ? "Hiện từng phần" : "Hiện tất cả gợi ý"}</button>
        </div>}
      </section>}
      <WritingComparison result={result} draft={text}
        draftPositionsKnown={draftPositionsKnown} edits={editMap.edits} accepted={accepted} visibleIds={shownIds} shades={shades} statusById={statusById}
        improved={comparison && comparison.submissionId === result.parentSubmissionId ? improvedSentences(result.originalText, comparison.originalText, shades) : []}
        onSentence={index => { setSentenceFocus(index); requestAnimationFrame(() => document.getElementById("writing-sentence-why")?.focus()); }}
        showAnnotations={showAnnotations} onSelect={openSuggestion}
        onEdit={continueVersion} continued={continued} editDisabled={pending || feedbackPending || !draftReady} />
      {sentenceFocus !== null && result.errors[sentenceFocus] && <section className={styles.sentencePanel} aria-labelledby="writing-sentence-why">
        <h3 id="writing-sentence-why" tabIndex={-1}>Vì sao câu này cần xem?<InfoTip label="Lưu ý">Đây là loại lỗi AI nghĩ có trong câu, chưa phải đáp án. AI có thể nhầm.</InfoTip></h3>
        <p lang="en"><q>{result.errors[sentenceFocus].original}</q></p>
        <ul>{allEntries.filter(item => item.suggestionIndex === sentenceFocus).map(item => {
          const evidence = item.explanations[0];
          const shown = shownIds.has(item.id);
          return <li key={item.id}>
            <strong>{evidence ? writingCategoryLabels[evidence.category] ?? "Chưa phân loại" : "Chưa phân loại"}</strong>
            {": "}{evidence ? evidence.message : "AI đề xuất thay đổi ở đây nhưng chưa phân loại được loại lỗi."}
            {" "}{item.status !== "pending" ? <em>({writingReviewStatuses[item.status]})</em>
              : shown ? <button type="button" onClick={() => openSuggestion(item.id)}>Mở gợi ý {item.number}</button>
              : <em>(gợi ý chi tiết sẽ hiện ở lượt sau — hãy thử tự tìm trước)</em>}
          </li>; })}</ul>
        <button type="button" onClick={() => setSentenceFocus(null)}>Đóng</button>
      </section>}
      <div className={`${styles.reviewGrid} ${showFeedbackPanel ? "" : styles.reviewSingle}`}>
        <section className={styles.review} aria-labelledby="writing-suggestions-heading">
          <div className={styles.sectionHeading}><span className={styles.icon}><Icon name="writing" /></span><h2 id="writing-suggestions-heading">Chi tiết gợi ý sửa bài
            {practice.shown.length > 0 && <InfoTip kind="help" label="Cách xử lý gợi ý">
              <span>Nên tự sửa trước: bấm “Tự sửa tại vị trí”, sửa trong bản nháp rồi chọn “Đã tự sửa”. Chỉ xem đáp án khi cần.</span>
              <span>Nhãn “Chưa có quy tắc giải thích”: gợi ý có thể đúng hoặc sai, hãy cân nhắc trước khi nhận.</span>
              <span>Lựa chọn được lưu cùng bản nháp trong trình duyệt.</span></InfoTip>}
            {generalWarnings.length > 0 && <InfoTip kind="warn" label="Lưu ý về kết quả AI">
              {generalWarnings.map(warning => <span key={warning}>{warning}</span>)}</InfoTip>}</h2>
            {result.provenance?.provider === "gemini" && <span className={styles.pill}>Gợi ý sửa: Gemini</span>}</div>
          {specificWarnings.length > 0 && <div className={styles.limits}>{specificWarnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
          {result.errors.length === 0 && <p className={styles.hint}>{result.correctedText === null ? "Chưa có phân tích ngữ pháp cho bài này." : "Không có gợi ý được trả về. Hãy tự kiểm tra lại bài gốc."}</p>}
          {result.correctedText !== null && result.correctedText !== result.originalText && review.pending === 0 &&
            <details className={styles.proposal}><summary>Xem toàn bộ bản AI đề xuất đã lưu</summary><p lang="en">{result.correctedText}</p>
              {result.errors.flatMap(item => item.explanations ?? [])
                .filter(explanation => !reviewItems.some(item => item.explanations.includes(explanation)))
                .map((explanation, index) => <p className={styles.hint} key={index}>{explanation.message}</p>)}
            </details>}
          {comparison && comparison.submissionId !== result.submissionId && <section className={styles.comparison} aria-label="Đối chiếu hai bài đã lưu">
            <h3>Đối chiếu với bài #{comparison.submissionId}<InfoTip label="Đọc kết quả đối chiếu thế nào?">{comparison.submissionId === result.parentSubmissionId
              ? "Tóm tắt CEFR và số gợi ý nằm ở thẻ “So với phiên bản trước” phía trên."
              : "Số gợi ý không phải điểm chất lượng; sửa vài lỗi có thể không đổi mức CEFR. Hai bài có thể khác đề."}</InfoTip></h3>
            {comparison.submissionId !== result.parentSubmissionId && <p>CEFR: <strong>{comparison.cefrLevel} → {result.cefrLevel}</strong>. Số câu có gợi ý: <strong>{comparison.errors.length} → {result.errors.length}</strong>.</p>}
            {comparisonDiff && <details><summary>Xem thay đổi giữa hai bài</summary><p lang="en" className={styles.diffText}><DiffText diff={comparisonDiff} /></p>
              {!comparisonDiff.detailed && <p lang="en" className={styles.diffText}>{result.originalText}</p>}</details>}
            <button type="button" onClick={() => { comparisonRequest.current?.abort(); setComparison(null); }}>Đóng đối chiếu</button>
          </section>}
          {compareNotice && <p className={styles.error} role="alert">{compareNotice}</p>}
          {review.total > 0 && <section className={styles.reviewChoices} aria-label="Lựa chọn chỉnh sửa">
            {!draftPositionsKnown && <p className={styles.notice}>Bản nháp đã được sửa riêng. Những chỗ bạn chưa sửa tay vẫn nhận hoặc hoàn tác thay đổi được; chỗ đã sửa tay thì chọn “Đã tự sửa”.</p>}
            <button type="button" disabled={!canReview || !lastDecision || (lastDecision.status === "accepted" && !draftEdit(editMap.edits.find(edit => edit.id === lastDecision.id) ?? null))} onClick={undoChoice}>Hoàn tác lựa chọn gần nhất</button>
          </section>}
          {review.total > 0 && review.visible.length === 0 && <p className={styles.hint}>Không có gợi ý phù hợp với bộ lọc.</p>}
          {practice.shown.map((item, position) => {
            const next = practice.shown.slice(position + 1).find(other => other.status === "pending")
              ?? practice.shown.slice(0, position).find(other => other.status === "pending");
            const suggestion = result.errors[item.suggestionIndex];
            const edit = item.edit;
            const uncertain = !hideAnswerFirst(item.type);
            const answerShown = item.status !== "pending" || uncertain || shownAnswers.includes(item.id);
            const editable = item.status === "pending" && draftEdit(edit) !== null;
            return <article className={styles.change} key={item.id} data-review-id={item.id}>
            <div className={styles.toolbar}>
              <h3 id={`writing-suggestion-${item.id}`} tabIndex={-1}>Gợi ý {item.number}</h3>
              <span className={styles.pill}>{writingReviewTypes[item.type]}</span>
              <span className={styles.pill}>{writingReviewStatuses[item.status]}</span>
              {uncertain && <span className={`${styles.pill} ${styles.uncertainPill}`}>Chưa có quy tắc giải thích</span>}
            </div>
            <div className={styles.suggestionPair}>
              <div><h4>Bạn đã viết</h4><p lang="en">{visibleEdit(edit?.before ?? suggestion.original) || "∅"}</p></div>
              <div><h4>Đề xuất của AI</h4>{answerShown
                ? <p lang="en">{visibleEdit(edit?.after ?? suggestion.suggestion) || "∅"}</p>
                : <p className={styles.answerHidden}>Đáp án đang ẩn để bạn tự sửa trước.</p>}</div>
            </div>
            {edit && edit.before !== suggestion.original && <details className={styles.suggestionContext}>
              <summary>Xem câu gốc</summary><p lang="en">{suggestion.original}</p>
            </details>}
            <div className={styles.editActions}>
              <button type="button" disabled={!canReview} onClick={() => selfFix(item.id, edit, suggestion)}>Tự sửa tại vị trí {item.number}</button>
              {!answerShown && <button type="button" onClick={() => setShownAnswers(ids => [...ids, item.id])}>Xem đáp án {item.number}</button>}
              {edit && answerShown && <button type="button" disabled={!editable || item.status !== "pending"} onClick={() => chooseEdit(item, "accepted")}>Nhận thay đổi {item.number}</button>}
              <button type="button" disabled={!canReview || item.status !== "pending"} onClick={() => chooseEdit(item, "selfFixed")}>Đã tự sửa {item.number}</button>
              <button type="button" disabled={!canReview || item.status !== "pending"} onClick={() => chooseEdit(item, "skipped")}>Bỏ qua {item.number}</button>
              {next && <button type="button" className={styles.nextSuggestion} onClick={() => openSuggestion(next.id)}>Gợi ý tiếp ({next.number}) →</button>}
            </div>
            {!edit && <p className={styles.hint}>Vị trí chưa xác định chắc chắn. Bạn có thể tự sửa trong bản nháp.</p>}
            {edit && answerShown && item.status === "pending" && canReview && !editable && <p className={styles.hint}>Bạn đã sửa tay chỗ này trong bản nháp nên không nhận thay đổi tự động được. Nếu đã sửa xong, chọn “Đã tự sửa {item.number}”.</p>}
            {selfFixNotice === item.id && <p className={styles.hint} role="status">Không còn tìm thấy câu gốc trong bản nháp — có thể bạn đã sửa câu này. Nếu xong, chọn “Đã tự sửa {item.number}” để sang gợi ý tiếp theo.</p>}
            {item.explanations.map((explanation, explanationIndex) => <div className={styles.explanation} key={explanationIndex}>
              <Icon name="bulb" /><p>{Object.hasOwn(writingCategoryLabels, explanation.category) && <strong>{writingCategoryLabels[explanation.category]}. </strong>}{explanation.message}</p>
            </div>)}
          </article>; })}
          {reviewExhausted(result.correctedText !== null, review.pending) && <RevisionChecklistPanel noneReturned={review.total === 0}
            onContinue={() => { setStatusFilter("all"); continueVersion(); }} disabled={pending || feedbackPending || !draftReady} />}
        </section>
        {showFeedbackPanel && <aside className={styles.feedback} aria-busy={feedbackPending} aria-labelledby="writing-feedback-heading">
          <div className={styles.sectionHeading}><span className={styles.icon}><Icon name="sparkles" /></span><h2 id="writing-feedback-heading">Nhận xét & gợi ý cải thiện<InfoTip label="Về phần nhận xét">Nhận xét tiếng Việt đang thử nghiệm, dùng bài đã lưu #{result.submissionId}. Không cho điểm hay chứng nhận trình độ.</InfoTip></h2></div>
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
              {capabilities?.feedbackStatus !== "disabled" && <button type="button" disabled={capabilityCheck === "checking"}
                onClick={() => { setCapabilityCheck("checking"); setCapabilityRetry(n => n + 1); }}>
                {capabilityCheck === "checking" ? "Đang kiểm tra…" : "Kiểm tra trạng thái nhận xét"}</button>}
              {capabilityCheck === "done" && capabilities?.feedbackStatus !== "disabled" && <span role="status"> Đã kiểm tra lại: dịch vụ AI vẫn chưa phản hồi. Hãy chắc rằng dịch vụ AI (cổng 8000) đang chạy.</span>}</p>}
            {changed && capabilities?.feedbackEnabled && <p className={styles.hint}>Hãy nộp bản nháp mới trước khi yêu cầu nhận xét, để tránh nhận xét nhầm bài cũ.</p>}
          </>}
          {feedbackPending && <p className={styles.hint} role="status">CEFR và bài viết đã được lưu. Phần nhận xét đang được xử lý riêng.</p>}
          {feedbackNotice && <p className={styles.error} role="alert">{feedbackNotice}</p>}
        </aside>}
      </div>
      {continued && form}
    </> : <div className={styles.reviewGrid}>
      {form}
      <aside className={styles.feedback}>
        {task ? <SelfCheck requirements={task.requirements} /> : <>
          <div className={styles.sectionHeading}><span className={styles.icon}><Icon name="sparkles" /></span><h2>Sau khi nộp</h2></div>
          <p className={styles.hint}>Bạn sẽ nhận ước lượng CEFR và các gợi ý sửa lỗi để tự sửa rồi nộp lại.</p></>}
      </aside>
    </div>}
    {!!result?.upgrades?.length && <WritingUpgrades upgrades={result.upgrades} />}
    {authenticated && result && <WritingFlashcards key={result.submissionId} submissionId={result.submissionId}
      versionNumber={result.versionNumber} targetCefr={result.targetCefr} />}
    <WritingHistoryPanel authenticated={authenticated} submissionId={result?.submissionId ?? null} practiceRootId={result?.practiceRootId ?? result?.submissionId}
      taskId={displayedTask?.id ?? null} taskTitle={displayedTask?.title ?? null}
      onCompare={compareSubmission} onNavigate={persistBeforeNavigation} />
  </main>;
}
