// Run: node --test frontend/tests/writing-flow.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(relativePath, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "..", "src", relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, URL, Request, Response, AbortSignal,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    ...globals,
  }, { filename });
  return module.exports;
}

const writing = loadTs("lib/writing.ts");
const result = {
  submissionId: 7, topic: "A synthetic topic", originalText: "Synthetic original.",
  cefrLevel: "B1", correctedText: "Synthetic correction.",
  errors: [{ original: "Synthetic original.", suggestion: "Synthetic correction." }],
  warnings: ["Experimental"], createdAt: "2026-10-26T00:00:00Z",
};

function server({ token = "private-test-token", reply = () => Response.json(result) } = {}) {
  const calls = [];
  const api = loadTs("lib/writing-server.ts", {
    "server-only": {},
    "next/headers": { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
    "./backend-request": { backendRequestSignal: signal => signal ?? AbortSignal.timeout(1000) },
    "./server-auth": { SESSION_COOKIE: "session", backendUrl: value => new URL(value, "http://backend.local") },
    "./writing": writing,
  }, {
    fetch: async (url, options) => { calls.push({ url: String(url), ...options }); return reply(); },
  });
  return { ...api, calls };
}

test("only a single valid positive SQL submission ID can select a saved result", () => {
  assert.equal(writing.writingSubmissionId("7"), 7);
  assert.equal(writing.writingSubmissionId("2147483647"), 2147483647);
  for (const id of [undefined, ["7", "8"], "0", "-1", "1.5", "2147483648", "7/../8", "7?other=8", "NaN"])
    assert.equal(writing.writingSubmissionId(id), null);
});

test("malformed analysis is rejected before rendering", () => {
  assert.equal(writing.isWritingResult(result), true);
  for (const change of [{ submissionId: -1 }, { cefrLevel: "B3" }, { errors: [null] },
    { warnings: [null] }, { originalText: " " }, { correctedText: 1 }, { createdAt: "invalid" }])
    assert.equal(writing.isWritingResult({ ...result, ...change }), false);
});

test("optional source offsets must point to the exact original text and be paired", () => {
  const source = "👩‍💻 I work.\r\nI work.";
  const start = source.lastIndexOf("I work.");
  const item = { original: "I work.", suggestion: "I worked.", sourceStart: start, sourceEnd: source.length };
  assert.equal(writing.isWritingResult({ ...result, originalText: source, errors: [item] }), true);
  for (const patch of [{ sourceStart: 0 }, { sourceStart: -1 }, { sourceEnd: null }, { sourceStart: 2, sourceEnd: 9 }])
    assert.equal(writing.isWritingResult({ ...result, originalText: source, errors: [{ ...item, ...patch }] }), false);
  const split = { original: '😀'.slice(1), suggestion: 'x', sourceStart: 1, sourceEnd: 2 };
  assert.equal(writing.isWritingResult({ ...result, originalText: '😀.', errors: [split] }), false);
});

test("coverage is optional for legacy analyses but every supplied count must form the complete partition", () => {
  const coverage = { totalBodySentences: 22, changed: 1, unchanged: 15, rejected: 1,
    inputOverBudget: 1, incomplete: 2, sentenceLimit: 2 };
  assert.equal(writing.isWritingResult({ ...result, gecCoverage: coverage }), true);
  assert.equal(writing.isWritingResult({ ...result, gecCoverage: null }), true);
  for (const change of [{ changed: -1, unchanged: 17 }, { incomplete: 1.5 }, { unchanged: 14 },
    { totalBodySentences: 21 }, { sentenceLimit: 0, unchanged: 17 }, { changed: 0, unchanged: 16 }])
    assert.equal(writing.isWritingResult({ ...result, gecCoverage: { ...coverage, ...change } }), false);
  assert.equal(writing.isWritingResult({ ...result, gecCoverage: { totalBodySentences: 0 } }), false);
  assert.equal(writing.isWritingResult({ ...result, correctedText: null, gecCoverage: coverage }), false);
  const summary = writing.writingCoverageSummary(coverage);
  assert.equal(summary.completed, 17); assert.equal(summary.rejected, 1); assert.equal(summary.unprocessed, 5);
  assert.equal(writing.sameWritingCoverage(coverage, { ...coverage }), true);
  assert.equal(writing.sameWritingCoverage(coverage, null), false);
  assert.equal(writing.sameWritingCoverage(coverage, { ...coverage, unchanged: 14 }), false);
  assert.equal(writing.sameWritingCoverage(undefined, null), true);
});

test("saved loader forwards account authentication with no caching and returns original text", async () => {
  const api = server();
  const saved = await api.getSavedWriting("7");
  assert.equal(saved.status, 200);
  assert.equal(saved.result.originalText, result.originalText);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].url, "http://backend.local/api/v1/writing/submissions/7");
  assert.equal(api.calls[0].headers.Authorization, "Bearer private-test-token");
  assert.equal(api.calls[0].cache, "no-store");
});

test("invalid IDs and anonymous reads never call backend", async () => {
  const api = server();
  assert.equal((await api.getSavedWriting("7/../8")).status, 400);
  assert.equal(api.calls.length, 0);
  const anonymous = server({ token: "" });
  assert.equal((await anonymous.getSavedWriting("7")).status, 401);
  assert.equal(anonymous.calls.length, 0);
});

test("missing or non-owned submissions remain 404; expired sessions remain unauthorized", async () => {
  for (const status of [401, 403, 404]) {
    const api = server({ reply: () => new Response("private upstream details", { status }) });
    const saved = await api.getSavedWriting("7");
    assert.equal(saved.status, status);
    assert.equal(JSON.stringify(saved).includes("private upstream details"), false);
    assert.equal("result" in saved, false);
  }
});

test("invalid or mismatched saved payload and upstream failures do not become results", async () => {
  for (const reply of [() => Response.json({ ...result, submissionId: 8 }),
    () => Response.json({ ...result, errors: null }),
    () => new Response("invalid JSON"),
    () => new Response("unavailable", { status: 503 }),
    () => { throw new Error("private learner body"); }]) {
    const saved = await server({ reply }).getSavedWriting("7");
    assert.equal(saved.status, 503);
    assert.equal("result" in saved, false);
    assert.equal(JSON.stringify(saved).includes("private learner body"), false);
  }
});

test("cancelled saved reads retain a distinct cancellation status", async () => {
  const abort = new AbortController();
  abort.abort();
  const api = server({ reply: () => { throw new Error("aborted"); } });
  const saved = await api.getSavedWriting("7", abort.signal);
  assert.equal(saved.status, 499);
  assert.equal(api.calls[0].signal, abort.signal);
  assert.equal("result" in saved, false);
});

test("HTTP GET proxy exposes saved results with no-store and retains access error statuses", async () => {
  for (const status of [200, 401, 404]) {
    const api = server({ reply: () => status === 200 ? Response.json(result) : new Response(null, { status }) });
    const route = loadTs("app/api/writing/submissions/[submissionId]/route.ts", { "@/lib/writing-server": api });
    const response = await route.GET(new Request("http://app.local/api/writing/submissions/7"),
      { params: Promise.resolve({ submissionId: "7" }) });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    assert.equal(status === 200 ? body.originalText : body.submissionId, status === 200 ? result.originalText : undefined);
  }
});
