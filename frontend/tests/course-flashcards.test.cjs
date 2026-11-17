const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function load(file, imports, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, URL, Request, Response, Headers, AbortSignal, Buffer, TextDecoder, Uint8Array,
    require(name) { if (name in imports) return imports[name]; throw new Error(name); }, ...globals });
  return module.exports;
}
test("course deck proxy forwards only a valid course filter and preserves authenticated create bodies", async () => {
  let token = "session", same = true; const calls = [];
  const api = load("app/api/flashcards/[...path]/route.ts", {
    "next/server": { NextResponse: Response },
    "next/headers": { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
    "@/lib/server-auth": { SESSION_COOKIE: "session", isSameOrigin: () => same, backendUrl: value => new URL(value, "http://backend") },
    "@/lib/backend-request": { backendRequestSignal: signal => signal },
  }, { fetch: async (url, init) => { calls.push({ url: String(url), ...init }); return Response.json([]); } });
  const ctx = route => ({ params: Promise.resolve({ path: route.split("/") }) });
  const get = query => api.GET(new Request("http://site/api/flashcards/decks" + query), ctx("decks"));
  assert.equal((await get("?courseId=12")).status, 200);
  assert.equal(calls.at(-1).url, "http://backend/api/v1/flashcards/decks?courseId=12");
  assert.equal(calls.at(-1).headers.Authorization, "Bearer session");
  const count = calls.length;
  for (const query of ["?courseId=0", "?courseId=-1", "?courseId=no", "?courseId=2147483648"])
    assert.equal((await get(query)).status, 400);
  assert.equal(calls.length, count);
  token = ""; assert.equal((await get("?courseId=12")).status, 401); token = "session";
  const post = () => api.POST(new Request("http://site/api/flashcards/decks", { method: "POST", body: JSON.stringify({ title: "Course vocabulary", courseId: 12 }) }), ctx("decks"));
  same = false; assert.equal((await post()).status, 403); same = true;
  assert.equal((await post()).status, 200);
  assert.equal(JSON.parse(calls.at(-1).body).courseId, 12);
});

test("learner and admin pages preserve reading cards when the saved-deck API fails and retain access checks", async () => {
  for (const admin of [false, true]) {
    let vocabularyStatus = "ok", deckStatus = "unavailable";
    const vocabulary = { courseId: 1038, courseTitle: "Course", readingDecks: [{ lessonId: 7, cards: [{ frontText: "commute" }] }] };
    const jsx = (type, props) => ({ type, props });
    const api = load(`app/${admin ? "admin/" : ""}courses/[courseId]/flashcards/page.tsx`, {
      "react/jsx-runtime": { jsx, jsxs: jsx }, "react": { Suspense: "Suspense" },
      "next/navigation": { redirect: path => { throw new Error("redirect:" + path); }, notFound: () => { throw new Error("not_found"); } },
      "next/link": { default: "Link" }, "@/components/navigation/member-shell": { default: "MemberShell" },
      "@/components/courses/course-flashcards": { default: "CourseFlashcards" },
      "@/lib/server-auth": { getCurrentUser: async () => ({ status: "authenticated", user: { userId: 73, role: admin ? "admin" : "user", createdAt: "2026-11-14" } }) },
      "@/lib/server-courses": {
        getCourseVocabulary: async () => ({ status: vocabularyStatus, data: vocabulary }),
        getCourseDecks: async () => ({ status: deckStatus, data: [] }),
      },
    });
    const props = { params: Promise.resolve({ courseId: "1038" }), searchParams: Promise.resolve({}) };
    const render = async () => { const child = api.default(props).props.children; return child.type(child.props); };
    const partial = await render();
    const component = admin ? partial : partial.props.children;
    assert.equal(component.type, "CourseFlashcards");
    assert.equal(component.props.data.decks, null);
    assert.equal(component.props.data.vocabulary.readingDecks.length, 1);
    deckStatus = "ok";
    const recovered = await render();
    assert.ok(Array.isArray((admin ? recovered : recovered.props.children).props.data.decks));
    vocabularyStatus = "not_found";
    await assert.rejects(render, /not_found/);
    vocabularyStatus = "ok"; deckStatus = "anonymous";
    await assert.rejects(render, /redirect:/);
  }
});
test("reading vocabulary proxy allows read and explicit copy while rejecting other operations", async () => {
  let token = "session", same = true; const calls = [];
  const api = load("app/api/learning/[...path]/route.ts", {
    "next/headers": { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
    "@/lib/server-auth": { SESSION_COOKIE: "session", isSameOrigin: () => same, backendUrl: value => new URL(value, "http://backend") },
    "@/lib/backend-request": { backendRequestSignal: signal => signal, isBackendTimeout: () => false },
  }, { fetch: async (url, init) => { calls.push({ url: String(url), ...init }); return Response.json({ ok: true }); } });
  const invoke = (method, route) => api[method](new Request("http://site/" + route, { method, ...(method === "POST" ? { body: JSON.stringify({ contentVersion: "a".repeat(64) }) } : {}) }), { params: Promise.resolve({ path: route.split("/") }) });
  assert.equal((await invoke("GET", "courses/12/vocabulary")).status, 200);
  assert.equal((await invoke("POST", "courses/12/vocabulary/7/copy")).status, 200);
  assert.equal(calls.at(-1).url, "http://backend/api/v1/courses/12/vocabulary/7/copy");
  assert.equal(JSON.parse(calls.at(-1).body).contentVersion, "a".repeat(64));
  for (const [method, route] of [["POST","courses/12/vocabulary"],["GET","courses/12/vocabulary/7/copy"],["PUT","courses/12/vocabulary/7/copy"],["GET","courses/2147483648/vocabulary"],["POST","courses/12/vocabulary/0/copy"]])
    assert.equal((await invoke(method, route)).status, 404);
  same = false; assert.equal((await invoke("POST", "courses/12/vocabulary/7/copy")).status, 403); same = true;
  token = ""; assert.equal((await invoke("GET", "courses/12/vocabulary")).status, 401);
});
