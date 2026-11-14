const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(relativePath, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "..", "src", relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, URL, Request, Response, AbortSignal,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    }, ...globals,
  }, { filename });
  return module.exports;
}

const writing = loadTs("lib/writing.ts");
const writingDiff = loadTs("lib/writing-diff.ts");
const original = "I learn English every day. " + Array(75).fill("practice").join(" ");
const suggestion = { original: "I learn English every day.", suggestion: "I study English every day.",
  explanations: [{ category: "OTHER", original: "learn", suggestion: "study", message: "Gợi ý thay learn bằng study.", templateVersion: "vi-v1" }] };
const feedback = { status: "ready", items: [
  { criterion: "organization", quote: "I learn English every day.", comment: "Ý chính xuất hiện ngay đầu bài.", action: "Nêu một ví dụ cụ thể.", suggestionIndex: null },
  { criterion: "grammar", quote: "I learn English every day.", comment: "Hãy xem lại gợi ý đang hiển thị.", action: "Đối chiếu với ý định diễn đạt.", suggestionIndex: 0 },
], message: "Nhận xét thử nghiệm.", modelId: "local/model", modelSha256: "a".repeat(64), promptVersion: "v1" };
const result = { submissionId: 7, topic: "My habit", originalText: original, cefrLevel: "B1", correctedText: original.replace(suggestion.original, suggestion.suggestion),
  errors: [suggestion], warnings: ["Experimental"], createdAt: "2026-10-27T00:00:00Z", feedback,
  gecCoverage: { totalBodySentences: 22, changed: 1, unchanged: 15, rejected: 1, inputOverBudget: 1, incomplete: 2, sentenceLimit: 2 },
  provenance: { cefrRun: "cefr-my-first-run", cefrAdapterSha256: "b".repeat(64), gecRun: "gec-expanded-v1", gecAdapterSha256: "c".repeat(64), explanationVersion: "vi-v1", guardVersion: "gec-safety-v1" } };

test("extended result remains compatible with old saved analyses and nullable optional fields", () => {
  assert.equal(writing.isWritingResult(result), true);
  assert.equal(writing.isWritingResult({ ...result, feedback: null, provenance: null, gecCoverage: null, errors: [{ original: "Old", suggestion: "New" }] }), true);
  const old = { ...result }; delete old.feedback; delete old.provenance; delete old.gecCoverage;
  assert.equal(writing.isWritingResult(old), true);
});

test("feedback eligibility uses the saved original and inclusive 80–150 word limits", () => {
  for (const [count, expected] of [[79, false], [80, true], [150, true], [151, false]])
    assert.equal(writing.writingFeedbackEligible({ originalText: Array(count).fill("word").join(" \n") }), expected);
});

test("optional input policy provenance accepts legacy absence but rejects malformed supplied values", () => {
  for (const inputPolicyVersion of [undefined, null, "cefr-input-v1"])
    assert.equal(writing.isWritingResult({ ...result, provenance: { ...result.provenance, inputPolicyVersion } }), true);
  for (const inputPolicyVersion of ["", " ", 1, {}, "v".repeat(101)])
    assert.equal(writing.isWritingResult({ ...result, provenance: { ...result.provenance, inputPolicyVersion } }), false);
});

test("feedback cannot introduce absent quotes, duplicate criteria, unsupported grammar or topic judgments", () => {
  for (const item of [
    { ...feedback.items[0], quote: "This sentence never existed." },
    { ...feedback.items[0], criterion: "score" },
    { ...feedback.items[0], suggestionIndex: 0 },
    { ...feedback.items[1], suggestionIndex: 1 },
    { ...feedback.items[1], quote: "practice" },
  ]) assert.equal(writing.isWritingResult({ ...result, feedback: { ...feedback, items: [item] } }), false);
  assert.equal(writing.isWritingResult({ ...result, feedback: { ...feedback, items: [feedback.items[0], feedback.items[0]] } }), false);
  assert.equal(writing.isWritingResult({ ...result, topic: null, feedback: { ...feedback, items: [{ ...feedback.items[0], criterion: "content" }] } }), false);
  assert.equal(writing.isWritingResult({ ...result, feedback: { ...feedback, status: "unavailable" } }), false);
  assert.equal(writing.isWritingResult({ ...result, feedback: { ...feedback, status: "unavailable", items: [] } }), true);
});

test("explanations must refer to real parts of their accepted suggestion and provenance hashes are bounded", () => {
  const broken = { ...suggestion, explanations: [{ ...suggestion.explanations[0], original: "invented" }] };
  assert.equal(writing.isWritingResult({ ...result, errors: [broken] }), false);
  assert.equal(writing.isWritingResult({ ...result, provenance: { ...result.provenance, gecAdapterSha256: "wrong" } }), false);
  assert.equal(writing.isWritingResult({ ...result, feedback: { ...feedback, modelSha256: "wrong" } }), false);
});

function route({ token = "test-session", sameOrigin = true, reply = () => Response.json(result) } = {}) {
  const calls = [], timeouts = [];
  const api = loadTs("app/api/writing/submissions/[submissionId]/feedback/route.ts", {
    "next/headers": { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
    "@/lib/server-auth": { SESSION_COOKIE: "session", isSameOrigin: () => sameOrigin, backendUrl: value => new URL(value, "http://backend.local") },
    "@/lib/writing": writing,
  }, { AbortSignal: { any: signals => AbortSignal.any(signals), timeout: ms => { timeouts.push(ms); return AbortSignal.timeout(ms); } },
    fetch: async (url, options) => { calls.push({ url: String(url), ...options }); return reply(); } });
  return { ...api, calls, timeouts };
}

const request = () => new Request("http://app.local/api/writing/submissions/7/feedback", { method: "POST" });
const context = value => ({ params: Promise.resolve({ submissionId: value }) });

test("feedback proxy forwards only authentication and saved ID with no-store and a 30s deadline", async () => {
  const api = route();
  const response = await api.POST(request(), context("7"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(api.calls[0].url, "http://backend.local/api/v1/writing/submissions/7/feedback");
  assert.equal(api.calls[0].headers.Authorization, "Bearer test-session");
  assert.equal(api.calls[0].method, "POST"); assert.equal(api.calls[0].body, undefined);
  assert.equal(api.calls[0].cache, "no-store");
  assert.deepEqual(api.timeouts, [30000]);
  assert.equal((await response.json()).originalText, original);
});

test("cross-origin, anonymous, malformed IDs and supplied essay bodies never reach feedback backend", async () => {
  for (const [settings, req, id, status] of [
    [{ sameOrigin: false }, request(), "7", 403], [{ token: "" }, request(), "7", 401],
    [{}, request(), "7/../8", 400], [{}, new Request(request(), { body: JSON.stringify({ originalText: "fake" }) }), "7", 400],
  ]) {
    const api = route(settings); const response = await api.POST(req, context(id));
    assert.equal(response.status, status); assert.equal(api.calls.length, 0);
  }
});

test("empty POST strings and Next-style empty streams are accepted but any actual byte is rejected", async () => {
  const emptyStream = () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(0)); controller.close(); } });
  for (const body of ["", emptyStream()]) {
    const api = route();
    const req = new Request(request(), { body, duplex: "half" });
    assert.notEqual(req.body, null);
    const response = await api.POST(req, context("7"));
    assert.equal(response.status, 200); assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].body, undefined);
  }
  for (const body of [" ", "{}", JSON.stringify({ originalText: "fake essay" }),
    new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x")); controller.close(); } })]) {
    const api = route();
    const response = await api.POST(new Request(request(), { body, duplex: "half" }), context("7"));
    assert.equal(response.status, 400); assert.equal(api.calls.length, 0);
  }
});

test("a stalled empty request stream is cancelled without calling the backend", async () => {
  const abort = new AbortController(); let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const api = route();
  const pending = api.POST(new Request(request(), { body, duplex: "half", signal: abort.signal }), context("7"));
  setTimeout(() => abort.abort(), 5);
  const response = await pending;
  assert.equal(response.status, 499); assert.equal(api.calls.length, 0);
  assert.equal(cancelled, true);
});

test("feedback proxy retains busy/access statuses and never forwards private upstream error text", async () => {
  for (const [upstream, expected] of [[401, 401], [403, 403], [404, 404], [422, 422], [429, 429], [500, 503]]) {
    const api = route({ reply: () => new Response("private learner text", { status: upstream }) });
    const response = await api.POST(request(), context("7"));
    assert.equal(response.status, expected);
    assert.equal((await response.text()).includes("private learner text"), false);
  }
});

test("malformed, foreign, missing feedback and interrupted upstream results never replace saved results", async () => {
  for (const reply of [() => Response.json({ ...result, submissionId: 8 }),
    () => Response.json({ ...result, feedback: null }), () => new Response("not JSON"),
    () => { throw new Error("private learner text"); }]) {
    const response = await route({ reply }).POST(request(), context("7"));
    assert.equal(response.status, 503); assert.equal((await response.text()).includes("private learner text"), false);
  }
  const abort = new AbortController(); abort.abort();
  const response = await route({ reply: () => { throw new Error("cancelled"); } }).POST(new Request(request(), { signal: abort.signal }), context("7"));
  assert.equal(response.status, 499);
});

test("saved feedback renders evidence as text without auto-requesting or changing the original essay", () => {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const styles = { default: new Proxy({}, { get: (_, key) => key }) };
  const icon = { default: () => null };
  const revision = loadTs("lib/writing-revision.ts", { "./writing-diff": writingDiff, "./writing": writing });
  const review = loadTs("lib/writing-review.ts");
  const comparison = loadTs("app/writing/writing-comparison.tsx", {
    react: React, "react/jsx-runtime": require("react/jsx-runtime"),
    "@/components/site-icon": icon, "@/lib/writing": writing, "@/lib/writing-revision": revision,
    "./writing.module.css": styles,
  });
  let fetchCalls = 0;
  const form = loadTs("app/writing/writing-form.tsx", {
    "react": React, "react/jsx-runtime": require("react/jsx-runtime"), "next/link": {
      default: ({ children, prefetch, ...props }) => { void prefetch; return React.createElement("a", props, children); },
    },
    "@/components/site-icon": icon, "@/lib/writing": writing,
    "@/lib/writing-diff": writingDiff,
    "@/lib/writing-revision": revision,
    "@/lib/writing-capabilities": loadTs("lib/writing-capabilities.ts", { "./writing": writing }),
    "@/lib/writing-draft": loadTs("lib/writing-draft.ts", { "./writing": writing }),
    "@/lib/writing-return": loadTs("lib/writing-return.ts"),
    "@/lib/writing-review": review,
    "./use-writing-preflight": { useWritingPreflight: () => ({ current: null, retry() {}, remember() {} }) },
    "./writing-history": { default: () => null },
    "./writing-flashcards": { default: () => null },
    "./writing-task-library": { default: () => null, taskLevels: { Beginner: "A1–A2", Intermediate: "B1–B2", Advanced: "C1–C2" } },
    "./writing-comparison": comparison,
    "./writing.module.css": styles,
  }, { fetch: () => { fetchCalls += 1; throw new Error("Unexpected automatic request"); } }).default;
  const html = renderToStaticMarkup(React.createElement(form, { authenticated: true, unavailable: false, targetLevel: "B2", initialResult: result }));
  assert.equal(fetchCalls, 0);
  assert.ok(html.includes("Gợi ý thay learn bằng study."));
  assert.ok(html.includes("Ý chính xuất hiện ngay đầu bài."));
  assert.ok(html.includes("I learn English every day."));
  assert.ok(html.includes("Nhận xét tiếng Việt đang thử nghiệm"));
  assert.match(html, /Bạn đã viết<\/h4><p lang="en">learn<\/p>/u);
  assert.match(html, /Đề xuất của AI<\/h4><p lang="en">study<\/p>/u);
  assert.ok(html.includes("Bản nháp chỉnh sửa"));
  assert.match(html, /CEFR mục tiêu khi nộp<\/h3><strong>Chưa được ghi<\/strong>/u);
  const recorded = renderToStaticMarkup(React.createElement(form, { authenticated: true, unavailable: false,
    targetLevel: "C1", initialResult: { ...result, targetRecorded: true, targetCefr: "B2", versionNumber: 1 } }));
  assert.match(recorded, /CEFR mục tiêu khi nộp<\/h3><strong>B2<\/strong>/u);
  assert.ok(recorded.includes("Tiếp tục từ phiên bản này"));
  assert.equal(recorded.includes('id="writing-target"'), false);
  const newDraft = renderToStaticMarkup(React.createElement(form, { authenticated: true, custom: true, targetLevel: "B2" }));
  assert.match(newDraft, /CEFR mục tiêu từ Hồ sơ cá nhân<\/strong> B2/u);
  assert.doesNotMatch(newDraft, /id="writing-target"/u);
  const unsetDraft = renderToStaticMarkup(React.createElement(form, { authenticated: true, custom: true }));
  assert.match(unsetDraft, /Chưa thiết lập. <a href="\/account">Mở Hồ sơ cá nhân<\/a>/u);
  assert.match(html, /Bản nháp chỉnh sửa<\/h2>[^]*?<p lang="en">I learn English every day\./u);
  assert.match(html, /<strong>17\/22 câu<\/strong>/u);
  assert.ok(html.includes("1 câu có gợi ý bị chặn"));
  assert.ok(html.includes("Chưa xử lý hoặc chưa hoàn tất: 5 câu"));
  assert.match(html, /aria-label="Xem gợi ý 1: learn"/u);
  const [firstEdit] = revision.writingEdits(result).edits;
  assert.ok(html.includes(`id="writing-suggestion-${firstEdit.id}" tabindex="-1"`));
  const waiting = renderToStaticMarkup(React.createElement(form, { authenticated: true, unavailable: false, initialResult: { ...result, feedback: null } }));
  assert.ok(waiting.includes("Nhận xét &amp; gợi ý cải thiện"));
  assert.equal(fetchCalls, 0);

  const repeated = "😀 Tiếng Việt\r\nShe learn.\r\nShe learn.";
  const second = repeated.lastIndexOf("She learn.");
  const repeatedResult = { ...result, originalText: repeated, correctedText: repeated.slice(0, second) + "She learns.",
    errors: [{ original: "She learn.", suggestion: "She learns.", sourceStart: second, sourceEnd: repeated.length }] };
  const { edits } = revision.writingEdits(repeatedResult);
  const repeatedHtml = renderToStaticMarkup(React.createElement(comparison.default, {
    result: repeatedResult, draft: repeatedResult.correctedText, edits, accepted: edits.map(edit => edit.id),
    visibleIds: new Set(edits.map(edit => edit.id)), draftPositionsKnown: true, showAnnotations: true, onSelect() {}, onEdit() {},
  }));
  assert.match(repeatedHtml, /😀 Tiếng Việt\r\nShe learn\.\r\nShe <button[^>]+aria-label="Xem gợi ý 1: learn"[^>]*>learn<\/button>\./u);
  assert.match(repeatedHtml, /😀 Tiếng Việt\r\nShe learn\.\r\nShe <button[^>]+aria-label="Xem gợi ý 1: learns"[^>]*>learns<\/button>\./u);
  const renderComparison = (visibleIds, draft, draftPositionsKnown) => renderToStaticMarkup(React.createElement(comparison.default, {
    result: repeatedResult, draft, edits, accepted: edits.map(edit => edit.id), visibleIds,
    draftPositionsKnown, showAnnotations: true, onSelect() {}, onEdit() {},
  }));
  assert.equal(renderComparison(new Set(), repeatedResult.correctedText, true).includes("data-review-id"), false);
  const manual = renderComparison(new Set([edits[0].id]), "My own edit. " + repeatedResult.correctedText, false);
  assert.ok(manual.includes("My own edit."));
  assert.equal([...manual.matchAll(/data-review-id=/gu)].length, 1);
  const empty = renderToStaticMarkup(React.createElement(form, { authenticated: true, unavailable: false,
    initialResult: { ...result, correctedText: null, errors: [], gecCoverage: null, feedback: null } }));
  assert.equal(empty.includes("<progress"), false);
});
