const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
function load(file, imports, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, URL, Request, Response, Headers, AbortSignal, Buffer, require: name => { if (!(name in imports)) throw Error(name); return imports[name]; }, ...globals });
  return module.exports;
}
test("reading/writing proxy enforces routes, method, session, origin and streams the bounded submission", async () => {
  let token = "session", same = true; const calls = [];
  const api = load("app/api/learning/[...path]/route.ts", {
    "next/headers": { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
    "@/lib/server-auth": { SESSION_COOKIE: "session", isSameOrigin: () => same, backendUrl: value => new URL(value, "http://backend") },
    "@/lib/backend-request": { backendRequestSignal: signal => signal, isBackendTimeout: () => false },
  }, { fetch: async (url, init) => { calls.push({ url: String(url), ...init }); return Response.json({ ok: true }); } });
  const context = route => ({ params: Promise.resolve({ path: route.split("/") }) });
  for (const skill of ["reading", "writing"]) {
    const route = `courses/3/lessons/7/${skill}`;
    const get = () => api.GET(new Request(`http://site/${route}`), context(route));
    const post = body => api.POST(new Request(`http://site/${route}/submissions`, { method: "POST", body }), context(route + "/submissions"));
    assert.equal((await get()).status, 200);
    assert.equal(calls.at(-1).headers.Authorization, "Bearer session");
    assert.equal((await post('{"answers":[]}')).status, 200);
    assert.equal(calls.at(-1).body, '{"answers":[]}');
    if (skill === "writing") assert.ok(calls.at(-1).signal instanceof AbortSignal);
    assert.equal((await api.POST(new Request(`http://site/${route}`, { method: "POST" }), context(route))).status, 404);
    assert.equal((await api.GET(new Request(`http://site/${route}/submissions`), context(route + "/submissions"))).status, 404);
    token = ""; assert.equal((await get()).status, 401); token = "session";
    same = false; assert.equal((await post("{}")).status, 403); same = true;
    assert.equal((await post("x".repeat(128 * 1024 + 1))).status, 413);
  }
});
test("writing word counts include contractions and hyphenated words consistently", () => {
  const api = load("lib/course-text.ts", {});
  assert.equal(api.courseWordCount("I don't study twenty-five words."), 5);
  assert.equal(api.courseWordCount("  "), 0);
  assert.equal(api.textLessonPath(3, 7, "writing"), "/api/learning/courses/3/lessons/7/writing");
});

test("reading progress counts valid options, nonblank text and complete matching answers", () => {
  const { readingAnswered } = load("lib/course-text.ts", {});
  const choice = { options: ["True", "False", "Not Given"], type: "true_false_not_given" };
  assert.equal(readingAnswered(choice, { optionIndex: 0 }), true);
  for (const optionIndex of [undefined, -1, 3, 0.5, "0"])
    assert.equal(readingAnswered(choice, { optionIndex }), false);
  assert.equal(readingAnswered(choice), false);
  const text = { options: [], type: "short_answer" };
  assert.equal(readingAnswered(text, { text: "  " }), false);
  assert.equal(readingAnswered(text, { text: " public transport " }), true);
  const matching = { options: [], type: "matching", matchingLeft: ["Bus", "Bike"], matchingRight: [{ id: "bus" }, { id: "bike" }] };
  assert.equal(readingAnswered(matching, { matches: [{ leftIndex: 0, rightId: "bus" }] }), false);
  assert.equal(readingAnswered(matching, { matches: [{ leftIndex: 0, rightId: "bus" }, { leftIndex: 1, rightId: "foreign" }] }), false);
  assert.equal(readingAnswered(matching, { matches: [{ leftIndex: 0, rightId: "bus" }, { leftIndex: 1, rightId: "bike" }] }), true);
});
