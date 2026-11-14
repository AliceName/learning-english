const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(name) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib", name), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: dep => load(dep.replace('./', '') + '.ts') }, { filename: name });
  return module.exports;
}
const draft = load("writing-draft.ts");
const returns = load("writing-return.ts");
const input = (text = "An English draft.", baseSubmissionId = null) => ({ topic: "My topic", text, corrections: true, baseSubmissionId });
function storage() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}

test("session draft preserves Unicode, CRLF, topic and correction mode exactly", () => {
  const store = storage();
  const value = input("  I read books.\r\nTôi học English 😀.\n");
  assert.equal(draft.saveWritingDraft(store, null, value, 100), true);
  const restored = draft.loadWritingDraft(store, null, null);
  for (const key of Object.keys(value)) assert.equal(restored[key], value[key]);
  assert.equal(restored.updatedAt, 100);
});

test("custom and empty topics survive draft save and reload without choosing a preset", () => {
  const store = storage();
  for (const topic of ["Viết thư khiếu nại về thư viện / library complaint", "x".repeat(500), ""]) {
    assert.equal(draft.saveWritingDraft(store, 7, { ...input(), topic }), true);
    assert.equal(draft.loadWritingDraft(store, 7, null).topic, topic);
  }
});

test("account and saved-submission scopes never restore another owner's or unrelated draft", () => {
  const store = storage();
  draft.saveWritingDraft(store, 7, input("User 7 new"), 1);
  draft.saveWritingDraft(store, 7, input("User 7 edits saved 31", 31), 2);
  draft.saveWritingDraft(store, 8, input("User 8 new"), 3);
  assert.equal(draft.loadWritingDraft(store, null, null), null);
  assert.equal(draft.loadWritingDraft(store, 7, 32), null);
  assert.equal(draft.loadWritingDraft(store, 8, 31), null);
  assert.equal(draft.loadWritingDraft(store, 7, 31).text, "User 7 edits saved 31");
  assert.equal(draft.loadWritingDraft(store, 8, null).text, "User 8 new");
});

test("login adopts only matching anonymous scope and preserves the previous owner draft", () => {
  const store = storage();
  draft.saveWritingDraft(store, 7, input("Older owner draft"), 20);
  draft.saveWritingDraft(store, null, input("Current anonymous draft"), 10);
  draft.saveWritingDraft(store, null, input("Saved-route anonymous draft", 31), 11);
  assert.equal(draft.adoptAnonymousWritingDraft(store, 7, null, 30), true);
  assert.equal(draft.loadWritingDraft(store, 7, null).text, "Current anonymous draft");
  assert.equal(draft.loadPreviousWritingDraft(store, 7, null).text, "Older owner draft");
  assert.equal(draft.loadWritingDraft(store, null, null), null);
  assert.equal(draft.loadWritingDraft(store, null, 31).text, "Saved-route anonymous draft");
  assert.equal(draft.loadWritingDraft(store, 8, null), null);
  assert.equal(draft.loadPreviousWritingDraft(store, 8, null), null);
  assert.equal(draft.restorePreviousWritingDraft(store, 7, null).text, "Older owner draft");
  assert.equal(draft.loadWritingDraft(store, 7, null).text, "Older owner draft");
  assert.equal(draft.loadPreviousWritingDraft(store, 7, null), null);
});

test("failed anonymous cleanup cannot expose the adopted draft to another account or shadow a later save", () => {
  const store = storage();
  draft.saveWritingDraft(store, null, input("Private current draft"), 1);
  const remove = store.removeItem;
  store.removeItem = key => { if (key.includes("anonymous")) throw new Error("cleanup blocked"); return remove(key); };
  assert.equal(draft.adoptAnonymousWritingDraft(store, 7, null, 2), true);
  assert.equal(draft.loadWritingDraft(store, null, null), null);
  assert.equal(draft.adoptAnonymousWritingDraft(store, 8, null, 3), false);
  assert.equal(draft.loadWritingDraft(store, 8, null), null);
  assert.equal(draft.saveWritingDraft(store, 7, input("More recent edit"), 4), true);
  assert.equal(draft.loadWritingDraft(store, 7, null).text, "More recent edit");
});

test("quota during owner copy keeps a claimed draft recoverable only by its intended account", () => {
  const store = storage();
  draft.saveWritingDraft(store, null, input("Current anonymous draft"), 1);
  const set = store.setItem;
  store.setItem = (key, value) => { if (key.includes("user:7")) throw new Error("quota"); set(key, value); };
  assert.equal(draft.adoptAnonymousWritingDraft(store, 7, null, 2), false);
  assert.equal(draft.loadWritingDraft(store, 7, null).text, "Current anonymous draft");
  assert.equal(draft.loadWritingDraft(store, null, null), null);
  assert.equal(draft.adoptAnonymousWritingDraft(store, 8, null, 3), false);
  assert.equal(draft.loadWritingDraft(store, 8, null), null);
});

test("bad, oversized, outdated or wrong-owner storage is ignored instead of rendering it", () => {
  for (const change of ["not JSON", { version: 3 }, { owner: 8 }, { topic: "x".repeat(501) },
    { text: "x".repeat(12001) }, { corrections: "true" }, { updatedAt: -1 }, { updatedAt: 1.1 }, { baseSubmissionId: 31 }]) {
    const store = storage();
    draft.saveWritingDraft(store, 7, input(), 1);
    const key = [...store.entries.keys()][0];
    const original = JSON.parse(store.entries.get(key));
    store.setItem(key, typeof change === "string" ? change : JSON.stringify({ ...original, ...change }));
    assert.equal(draft.loadWritingDraft(store, 7, null), null);
  }
});

test("storage denial, SSR and invalid identifiers fail safely without affecting other drafts", () => {
  const denied = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
  assert.equal(draft.writingDraftStorage(), null);
  assert.equal(draft.loadWritingDraft(denied, 7, null), null);
  assert.equal(draft.saveWritingDraft(denied, 7, input()), false);
  assert.equal(draft.clearWritingDraft(denied, 7, null), false);
  assert.equal(draft.adoptAnonymousWritingDraft(denied, 7, null), false);
  for (const owner of [0, -1, 1.2, 2147483648, "7"]) assert.equal(draft.saveWritingDraft(storage(), owner, input()), false);
  assert.equal(draft.saveWritingDraft(storage(), 7, input("text", -1)), false);
  const store = storage();
  draft.saveWritingDraft(store, 7, input("Delete this"), 1);
  draft.saveWritingDraft(store, 8, input("Keep this"), 1);
  assert.equal(draft.clearWritingDraft(store, 7, null), true);
  assert.equal(draft.loadWritingDraft(store, 7, null), null);
  assert.equal(draft.loadWritingDraft(store, 8, null).text, "Keep this");
});

test("Writing return paths accept only the supported route and one bounded submission id", () => {
  assert.equal(returns.safeWritingReturnTo("/writing"), "/writing");
  assert.equal(returns.safeWritingReturnTo("/writing?submissionId=31"), "/writing?submissionId=31");
  assert.equal(returns.safeWritingReturnTo("/writing?submissionId=2147483647"), "/writing?submissionId=2147483647");
  assert.equal(returns.writingReturnSubmissionId("/writing?submissionId=31"), 31);
  assert.equal(returns.writingReturnSubmissionId("/writing"), null);
  assert.equal(returns.writingAuthHref("register", "/writing?submissionId=31"), "/register?returnTo=%2Fwriting%3FsubmissionId%3D31");
  assert.equal(returns.writingAuthHref("login", "/account"), "/login");
});

test("authentication return path rejects external, script, encoded and control-character redirects", () => {
  for (const value of [undefined, ["/writing"], "https://evil.example/writing", "//evil.example", "javascript:alert(1)",
    "/\\evil.example", "/writing/../account", "/writing#fragment", "/writing?submissionId=0", "/writing?submissionId=01",
    "/writing?submissionId=-1", "/writing?submissionId=2147483648", "/writing?submissionId=1&submissionId=2",
    "/writing?other=1", "%2Fwriting", "/writing\n", "/writing\u0000", " /writing", "/writing?submissionId=31&returnTo=//evil.example"])
    assert.equal(returns.safeWritingReturnTo(value), "/account", String(value));
});
