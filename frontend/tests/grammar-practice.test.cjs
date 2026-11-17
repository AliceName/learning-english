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
    module, exports: module.exports, URL, Request, Response, AbortSignal, Buffer,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    }, ...globals,
  }, { filename });
  return module.exports;
}

const grammar = loadTs("lib/grammar.ts");
const lesson = { courseId: 7, lessonId: 12, contentVersion: "a".repeat(64), questions: [
  { questionId: 0, type: "multiple_choice", options: ["lived", "have lived"] },
  { questionId: 1, type: "fill_blank", options: [] },
  { questionId: 2, type: "error_correction", options: ["He", "have lived", "here"] },
] };
const draft = { answers: { 0: { questionId: 0, optionIndex: 1 }, 1: { questionId: 1, text: "had known" } },
  current: 1, elapsed: 65, notes: "S + have/has + V3" };

test("all three question types distinguish unanswered values and option zero", () => {
  assert.equal(grammar.grammarAnswered(lesson.questions[0], { questionId: 0, optionIndex: 0 }), true);
  assert.equal(grammar.grammarAnswered(lesson.questions[2], { questionId: 2, optionIndex: 1 }), true);
  for (const optionIndex of [undefined, -1, 2, "0", 0.5])
    assert.equal(grammar.grammarAnswered(lesson.questions[0], { questionId: 0, optionIndex }), false);
  assert.equal(grammar.grammarAnswered(lesson.questions[1], { questionId: 1, text: "  " }), false);
  assert.equal(grammar.grammarAnswered(lesson.questions[1], { questionId: 1, text: "had known" }), true);
});

test("draft keys isolate users, lessons and authored content versions", () => {
  const key = grammar.grammarDraftKey(3, lesson);
  for (const candidate of [grammar.grammarDraftKey(4, lesson), grammar.grammarDraftKey(3, { ...lesson, lessonId: 13 }),
    grammar.grammarDraftKey(3, { ...lesson, contentVersion: "b".repeat(64) })]) assert.notEqual(key, candidate);
  assert.deepEqual(JSON.parse(JSON.stringify(grammar.parseGrammarDraft(JSON.stringify(draft), lesson))), draft);
});

test("corrupted drafts and malicious answer shapes cannot become active answers", () => {
  for (const value of ["broken", "null", "[]", JSON.stringify({ ...draft, current: 99 }),
    JSON.stringify({ ...draft, elapsed: -1 }), JSON.stringify({ ...draft, notes: "x".repeat(5001) })])
    assert.equal(grammar.parseGrammarDraft(value, lesson), null);
  const restored = grammar.parseGrammarDraft(JSON.stringify({ ...draft, answers: {
    0: { questionId: 0, optionIndex: 99 }, 1: { questionId: 1, text: 42 }, 2: { questionId: 0, optionIndex: 1 },
    99: { questionId: 99, optionIndex: 0 },
  } }), lesson);
  assert.equal(Object.keys(restored.answers).length, 0);
});

test("clock and login return URL remain stable", () => {
  assert.equal(grammar.grammarTime(125), "02:05");
  assert.equal(grammar.grammarTime(NaN), "00:00");
  assert.equal(new URL(grammar.grammarLoginHref(7, 12), "http://local").searchParams.get("next"), "/courses/7/lessons/12/grammar");
});

function proxy({ token = "test-session", sameOrigin = true } = {}) {
  const calls = [];
  const api = loadTs("app/api/learning/[...path]/route.ts", {
    "next/headers": { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
    "@/lib/server-auth": { SESSION_COOKIE: "session", backendUrl: value => new URL(value, "http://backend.local"), isSameOrigin: () => sameOrigin },
    "@/lib/backend-request": { backendRequestSignal: signal => signal, isBackendTimeout: () => false },
  }, { fetch: async (url, init) => { calls.push({ url: String(url), ...init }); return Response.json({ result: { score: 100 } }); } });
  return { ...api, calls };
}
const context = route => ({ params: Promise.resolve({ path: route.split("/") }) });

test("grammar proxy forwards submission with server cookie and preserves the listening route", async () => {
  const api = proxy();
  const route = "courses/7/lessons/12/grammar/submissions";
  const body = JSON.stringify({ contentVersion: lesson.contentVersion, answers: [], timeSpentSeconds: 25 });
  const response = await api.POST(new Request(`http://local/api/learning/${route}`, { method: "POST", body }), context(route));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(api.calls[0].url, `http://backend.local/api/v1/${route}`);
  assert.equal(api.calls[0].body, body); assert.equal(api.calls[0].headers.Authorization, "Bearer test-session");
  assert.equal((await api.GET(new Request("http://local/api/learning/courses/7/lessons/12/listening"), context("courses/7/lessons/12/listening"))).status, 200);
});

test("grammar proxy rejects unsupported methods, paths, oversized payloads and invalid origins", async () => {
  for (const [route, method] of [["courses/7/lessons/12/grammar", "POST"], ["courses/7/lessons/12/grammar/submissions", "GET"],
    ["courses/2147483648/lessons/12/grammar", "GET"], ["courses/7/lessons/12/grammar/results", "GET"]]) {
    const api = proxy();
    assert.equal((await api[method](new Request(`http://local/${route}`, { method }), context(route))).status, 404);
    assert.equal(api.calls.length, 0);
  }
  const route = "courses/7/lessons/12/grammar/submissions";
  const request = () => new Request(`http://local/${route}`, { method: "POST", body: "{}" });
  assert.equal((await proxy({ token: null }).POST(request(), context(route))).status, 401);
  assert.equal((await proxy({ sameOrigin: false }).POST(request(), context(route))).status, 403);
  assert.equal((await proxy().POST(new Request(`http://local/${route}`, { method: "POST", body: "x".repeat(128 * 1024 + 1) }), context(route))).status, 413);
});

test("server grammar loader maps unavailable content and never caches personal results", async () => {
  for (const [status, expected] of [[200, "ok"], [401, "anonymous"], [404, "not_found"], [409, "unsupported"], [503, "unavailable"]]) {
    const calls = [];
    const api = loadTs("lib/server-grammar.ts", {
      "server-only": {}, "next/headers": { cookies: async () => ({ get: () => ({ value: "test-session" }) }) },
      "next/server": { connection: async () => {} }, "./grammar": grammar,
      "./backend-request": { backendRequestSignal: () => AbortSignal.timeout(1000) },
      "./server-auth": { SESSION_COOKIE: "session", backendUrl: value => new URL(value, "http://backend.local") },
    }, { fetch: async (url, init) => { calls.push({ url: String(url), ...init }); return Response.json(lesson, { status }); } });
    assert.equal((await api.getGrammarLesson(7, 12)).status, expected);
    assert.equal(calls[0].cache, "no-store"); assert.equal(calls[0].headers.Authorization, "Bearer test-session");
  }
});
