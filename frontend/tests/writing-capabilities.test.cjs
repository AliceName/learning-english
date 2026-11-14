const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(relativePath, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "..", "src", relativePath);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, URL, URLSearchParams, Request, Response, AbortSignal,
    require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw Error(name); }, ...globals }, { filename });
  return module.exports;
}
const writing = load("lib/writing.ts");
const types = load("lib/writing-capabilities.ts", { "./writing": writing });
const caps = { status: "ready", busy: false, correctionsEnabled: true, feedbackEnabled: false,
  feedbackStatus: "disabled", cefrLimit: 512, gecInputLimit: 384, gecSentenceLimit: 20 };

test("eligibility is independent of token budget and legacy payloads remain valid", () => {
  const base={cefrTokens:20,cefrLimit:512,canAnalyze:true,correctionsEnabled:false,
    gecInputLimit:null,gecSentenceLimit:20,sentences:[]};
  assert.equal(types.isWritingPreflight(base,"Some English text.",false),true);
  const assessment={status:"insufficient",reasons:["repetition"],warnings:[],policyVersion:"cefr-input-v1"};
  assert.equal(types.isWritingPreflight({...base,inputAssessment:assessment},"Some English text.",false),true);
  assert.match(types.writingInputIssue(assessment),/lặp/);
  for(const bad of [{...assessment,status:"eligible"},{...assessment,reasons:["unknown"]},
    {...assessment,reasons:["repetition","repetition"]},{...assessment,warnings:[42]},
    {...assessment,policyVersion:"arbitrary"}])
    assert.equal(types.isWritingPreflight({...base,inputAssessment:bad},"Some English text.",false),false);
  assert.equal(types.writingInputIssue(undefined),"");
});

test("safe capability status distinguishes offline, disabled feedback and busy without invented limits", () => {
  assert.equal(types.isWritingCapabilities(caps), true);
  assert.equal(types.isWritingCapabilities({ ...caps, busy: true }), true);
  assert.equal(types.isWritingCapabilities({ ...caps, feedbackEnabled: true }), false);
  assert.equal(types.isWritingCapabilities({ ...caps, busy: undefined }), false);
  assert.equal(types.isWritingCapabilities({ ...caps, status: ["ready"] }), false);
  assert.equal(types.isWritingCapabilities({ ...caps, feedbackStatus: ["disabled"] }), false);
  assert.equal(types.isWritingCapabilities({ status: "unavailable", busy: false, correctionsEnabled: false,
    feedbackEnabled: false, feedbackStatus: "unavailable", cefrLimit: null, gecInputLimit: null, gecSentenceLimit: null }), true);
});

test("preflight requires valid UTF16 spans, ordered sentence IDs, exact status and cap20", () => {
  const text = "🙂 I read books.\r\nI read books.";
  const value = { cefrTokens: 34, cefrLimit: 512, canAnalyze: true, correctionsEnabled: true,
    gecInputLimit: 384, gecSentenceLimit: 20,
    sentences: [{ index: 0, start: 0, end: 16, tokens: 16, status: "ready" },
      { index: 1, start: 18, end: text.length, tokens: 16, status: "ready" }] };
  assert.equal(types.isWritingPreflight(value, text, true), true);
  assert.equal(types.isWritingPreflight(value, text, false), false);
  for (const sentence of [ { ...value.sentences[0], start: 1 }, { ...value.sentences[0], end: 1 },
    { ...value.sentences[0], status: "sentenceLimit" }, { ...value.sentences[0], tokens: 385 } ])
    assert.equal(types.isWritingPreflight({ ...value, sentences: [sentence] }, text, true), false);
  assert.equal(types.isWritingPreflight({ ...value, cefrTokens: 513 }, text, true), false);
});

test("history cursor is strict, summaries bounded and IDs ordered", () => {
  const item = { submissionId: 3, topic: null, cefrLevel: "B1", preview: "Short preview", createdAt: "2026-10-27T12:00:00Z" };
  assert.equal(types.isWritingHistory({ items: [item], nextBeforeId: 3 }), true);
  assert.equal(types.isWritingHistory({ items: [item], nextBeforeId: 4 }), false);
  assert.equal(types.isWritingHistory({ items: [item, item], nextBeforeId: null }), false);
  assert.equal(types.isWritingHistory({ items: [{ ...item, preview: "x".repeat(161) }], nextBeforeId: null }), false);
});

function route(file, { token = "session", sameOrigin = true, reply = () => Response.json(caps) } = {}) {
  const calls = [];
  return { calls, api: load(file, {
    "next/headers": { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
    "@/lib/server-auth": { SESSION_COOKIE: "session", isSameOrigin: () => sameOrigin,
      backendUrl: path => new URL(path, "http://backend.local") },
    "@/lib/writing-capabilities": types,
    "@/lib/writing": writing,
  }, { fetch: async (...args) => { calls.push(args); return reply(); } }) };
}

test("new BFF read endpoints require auth, same origin and no-store", async () => {
  for (const file of ["app/api/writing/capabilities/route.ts", "app/api/writing/submissions/route.ts"]) {
    const anonymous = route(file, { token: null });
    const res = await anonymous.api.GET(new Request("http://localhost/api/writing"));
    assert.equal(res.status, 401); assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(anonymous.calls.length, 0);
    const foreign = route(file, { sameOrigin: false });
    assert.equal((await foreign.api.GET(new Request("http://localhost/api/writing"))).status, 403);
  }
});

test("preflight BFF rejects unrelated content before invoking backend", async () => {
  const value = route("app/api/writing/preflight/route.ts");
  const res = await value.api.POST(new Request("http://localhost/api/writing/preflight", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ originalText: "I read.", corrections: true, topic: "not allowed" }),
  }));
  assert.equal(res.status, 400); assert.equal(value.calls.length, 0);
});

test("history BFF rejects cursor/query injection and validates upstream rows", async () => {
  const value = route("app/api/writing/submissions/route.ts", { reply: () => Response.json({ items: [], nextBeforeId: null }) });
  for (const query of ["beforeId=-1", "beforeId=2147483648", "limit=21", "userId=9"])
    assert.equal((await value.api.GET(new Request(`http://localhost/api/writing/submissions?${query}`))).status, 400);
  assert.equal(value.calls.length, 0);
  const res = await value.api.GET(new Request("http://localhost/api/writing/submissions?limit=10"));
  assert.equal(res.status, 200); assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(value.calls[0][1].headers.Authorization, "Bearer session");
});
