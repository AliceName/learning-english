import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lesson = { courseId: 1, lessonId: 2, contentVersion: "version-one", questions: [
  { questionId: 0, type: "multiple_choice", options: ["Monday", "Thursday"] },
  { questionId: 1, type: "fill_blank" },
  { questionId: 2, type: "matching", matchingLeft: ["meeting"], matchingRight: [{ id: "meeting-meaning" }] },
] };

function setup() {
  const data = new Map();
  const exports = {};
  const source = fs.readFileSync(path.join(root, "src/lib/listening-draft.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, sessionStorage: {
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key),
  } });
  return { data, draft: exports };
}

test("draft answers and elapsed time survive reopening only for the same user and lesson version", () => {
  const { draft } = setup();
  const key = draft.listeningDraftKey(42, lesson);
  const saved = { contentVersion: lesson.contentVersion, timeSpentSeconds: 725, answers: {
    0: { questionId: 0, optionIndex: 1, matches: [] },
    1: { questionId: 1, text: "Thursday", matches: [] },
    2: { questionId: 2, matches: [{ leftIndex: 0, rightId: "meeting-meaning" }] },
  } };
  assert.equal(draft.writeListeningDraft(key, saved), true);
  assert.deepEqual(JSON.parse(JSON.stringify(draft.readListeningDraft(key, lesson))), saved);
  assert.equal(draft.readListeningDraft(draft.listeningDraftKey(43, lesson), lesson), null);
  assert.equal(draft.readListeningDraft(key, { ...lesson, contentVersion: "new-version" }), null);
});

test("stale option indexes, foreign question IDs and unknown matching IDs are discarded", () => {
  const { data, draft } = setup();
  const key = draft.listeningDraftKey(42, lesson);
  data.set(key, JSON.stringify({ contentVersion: lesson.contentVersion, timeSpentSeconds: 90, answers: {
    0: { questionId: 0, optionIndex: 99 }, 1: { questionId: 1, text: "valid" },
    2: { questionId: 2, matches: [{ leftIndex: 0, rightId: "unknown" }] },
    99: { questionId: 99, text: "foreign question" },
  } }));
  const restored = draft.readListeningDraft(key, lesson);
  assert.equal(restored.answers[0], undefined);
  assert.equal(restored.answers[99], undefined);
  assert.equal(restored.answers[1].text, "valid");
  assert.equal(restored.answers[2].matches.length, 0);
});

test("corrupt drafts fail safely and clearing removes saved answers", () => {
  const { data, draft } = setup();
  const key = draft.listeningDraftKey(42, lesson);
  data.set(key, "not JSON");
  assert.equal(draft.readListeningDraft(key, lesson), null);
  draft.writeListeningDraft(key, { contentVersion: lesson.contentVersion, timeSpentSeconds: 5, answers: { 1: { questionId: 1, text: "draft" } } });
  draft.clearListeningDraft(key);
  assert.equal(draft.readListeningDraft(key, lesson), null);
});
