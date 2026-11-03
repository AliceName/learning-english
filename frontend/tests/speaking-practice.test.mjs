import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const source = fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const sandbox = { exports: {}, Error, require: dependency => load(dependency.replace("./", "")) };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, sandbox);
  modules.set(name, sandbox.exports);
  return sandbox.exports;
}
const { completedSentences, compareAttempts, mergeHistory, nextUnpracticed, wordAudioRange, microphoneError,
  getPracticeTarget, allPracticeTargets, matchesPracticeTarget, completedPracticeTargets, matchesSentence } = load("speaking-practice");
const lesson = { lessonId: 12, sentences: [{ text: "We call it bear" }, { text: "I like playing" }] };
function attempt(id, overrides = {}) {
  return { attemptId: id, lessonId: 12, sentenceIndex: 0, referenceText: "We call it bear", createdAt: `2026-10-27T12:00:${String(id).padStart(2, "0")}Z`,
    assessment: { modelVersion: "ref2-cal1", overallScore: 80, referenceTokenCount: 9, coverage: 8 / 9,
      words: [{ index: 0, phones: [{ sourcePhone: "W", symbol: "w", startSeconds: 0, endSeconds: .4 }] }] }, ...overrides };
}

test("session progress counts each matching sentence once and excludes recordings needing retry", () => {
  const retry = attempt(3); retry.assessment.interpretation = { feedbackMode: "record_again" };
  const items = [attempt(1), attempt(2), retry, attempt(4, { sentenceIndex: 1, referenceText: "Old sentence" }), attempt(5, { lessonId: 99 })];
  assert.deepEqual([...completedSentences(items, lesson)], [0]);
  assert.equal(completedSentences([retry], lesson).size, 0);
  assert.equal(nextUnpracticed(1, 2, new Set([1])), 0);
  assert.equal(nextUnpracticed(0, 2, new Set([0, 1])), null);
});

test("comparison uses the latest earlier matching attempt, including tied timestamps", () => {
  const current = attempt(4); current.assessment.overallScore = 83.2;
  const earlier = attempt(3, { createdAt: current.createdAt });
  const value = compareAttempts(current, [attempt(5), attempt(1), current, earlier, attempt(2)]);
  assert.equal(value.previous.attemptId, 3); assert.equal(value.delta, 3.2);
  assert.equal(compareAttempts(current, [current, attempt(5)]), null);
});

test("comparison refuses different models, supported phone sequences, or unreliable audio", () => {
  const current = attempt(4);
  const previous = attempt(3); previous.assessment.modelVersion = "old-model";
  assert.equal(compareAttempts(current, [previous]).delta, null);
  previous.assessment.modelVersion = current.assessment.modelVersion;
  previous.assessment.words[0].phones[0].sourcePhone = "V";
  assert.equal(compareAttempts(current, [previous]).delta, null);
  previous.assessment.words = current.assessment.words;
  previous.assessment.interpretation = { feedbackMode: "record_again" };
  assert.equal(compareAttempts(current, [previous]).delta, null);
});

test("history merges concurrent refreshes without duplicating or dropping the newest attempts", () => {
  const history = mergeHistory([attempt(25), attempt(24)], Array.from({ length: 24 }, (_, i) => attempt(i + 1)));
  assert.equal(history.length, 20);
  assert.equal(new Set(history.map(item => item.attemptId)).size, 20);
  assert.equal(history[0].attemptId, 25); assert.equal(history[19].attemptId, 6);
});

test("word playback stays inside the recording and rejects missing or invalid timing", () => {
  const range = wordAudioRange(attempt(1).assessment.words[0], .45);
  assert.equal(range.start, 0); assert.equal(range.end, .45);
  assert.equal(wordAudioRange({ phones: [] }, 1), null);
  assert.equal(wordAudioRange({ phones: [{ startSeconds: 1, endSeconds: 2 }] }, 1), null);
  assert.equal(wordAudioRange({ phones: [{ startSeconds: 0, endSeconds: NaN }] }, 1), null);
});

test("microphone failures give device-specific recovery instructions", () => {
  for (const [name, expected] of [["NotAllowedError", "quyền"], ["NotFoundError", "Không tìm thấy"], ["NotReadableError", "ứng dụng khác"]]) {
    const error = new Error("native error"); error.name = name;
    assert.ok(microphoneError(error).includes(expected));
  }
});

const phraseLesson = { ...lesson, segmentationVersion: "phrase-v1", sentences: [
  { text: "There is probably titanium in your eyeglass frames ." }, { text: "Go go go go" }, { text: "A short sentence." }],
  segments: [[{ index: 0, text: "There is probably titanium", startWordIndex: 0, wordCount: 4 },
    { index: 1, text: "in your eyeglass frames .", startWordIndex: 4, wordCount: 4 }],
  [{ index: 0, text: "Go go", startWordIndex: 0, wordCount: 2 }, { index: 1, text: "go go", startWordIndex: 2, wordCount: 2 }]] };
function phraseAttempt(id, sentenceIndex = 0, segmentIndex = 0, overrides = {}) {
  const target = getPracticeTarget(phraseLesson, sentenceIndex, segmentIndex);
  return attempt(id, { sentenceIndex, referenceText: target.text,
    scope: { kind: "segment", segmentIndex, startWordIndex: target.segment.startWordIndex, wordCount: target.segment.wordCount,
      sentenceText: phraseLesson.sentences[sentenceIndex].text, segmentationVersion: phraseLesson.segmentationVersion }, ...overrides });
}

test("practice targets use server phrase text, stable draft keys, and reject invalid segment metadata", () => {
  const first = getPracticeTarget(phraseLesson, 0, 0);
  const second = getPracticeTarget(phraseLesson, 0, 1);
  assert.equal(first.text, "There is probably titanium"); assert.equal(first.key, "segment:0:0:phrase-v1");
  assert.equal(second.text, "in your eyeglass frames ."); assert.notEqual(second.key, first.key);
  const full = getPracticeTarget(phraseLesson, 0, null);
  assert.equal(full.text, phraseLesson.sentences[0].text); assert.equal(full.key, "sentence:0");
  for (const [sentenceIndex, segmentIndex] of [[-1, null], [.5, null], [99, null], [0, -.1], [0, 99], [0, .5]])
    assert.equal(getPracticeTarget(phraseLesson, sentenceIndex, segmentIndex), null);
  assert.equal(getPracticeTarget({ ...phraseLesson, segmentationVersion: null }, 0, 0), null);
  assert.equal(getPracticeTarget({ ...phraseLesson, segments: [[{ ...first.segment, index: 1 }]] }, 0, 0), null);
  assert.equal(getPracticeTarget({ ...phraseLesson, segments: [[{ ...first.segment, wordCount: 0 }]] }, 0, 0), null);
});

test("target enumeration never invents phrase splits for legacy or incomplete lesson data", () => {
  const targets = allPracticeTargets(phraseLesson, "segment");
  assert.deepEqual(Array.from(targets, target => [target.sentenceIndex, target.segmentIndex]), [[0, 0], [0, 1], [1, 0], [1, 1], [2, null]]);
  assert.equal(new Set(targets.map(target => target.key)).size, 5);
  assert.deepEqual(Array.from(allPracticeTargets(phraseLesson, "sentence"), target => target.segmentIndex), [null, null, null]);
  assert.deepEqual(Array.from(allPracticeTargets(lesson, "segment"), target => target.key), ["sentence:0", "sentence:1"]);
  assert.equal(allPracticeTargets({ ...phraseLesson, segmentationVersion: null }, "segment").length, 3);
});

test("a whole-sentence-looking phrase never counts as or matches a whole-sentence recording", () => {
  const short = { ...lesson, segments: [[{ index: 0, text: lesson.sentences[0].text, startWordIndex: 0, wordCount: 4 }]], segmentationVersion: "phrase-v1" };
  const part = attempt(1, { scope: { kind: "segment", segmentIndex: 0, startWordIndex: 0, wordCount: 4,
    sentenceText: lesson.sentences[0].text, segmentationVersion: "phrase-v1" } });
  assert.equal(matchesSentence(part, short, 0), false);
  assert.equal(matchesPracticeTarget(part, short, 0, null), false);
  assert.equal(matchesPracticeTarget(part, short, 0, 0), true);
  assert.equal(matchesPracticeTarget(attempt(2), short, 0, 0), false);
  assert.equal(completedSentences([part], short).size, 0);
  assert.equal(completedPracticeTargets([part], short, "sentence").size, 0);
});

test("a phrase must match the current source sentence, index, word range and segmentation version", () => {
  const valid = phraseAttempt(1);
  assert.equal(matchesPracticeTarget(valid, phraseLesson, 0, 0), true);
  assert.equal(matchesPracticeTarget(valid, phraseLesson, 0, 1), false);
  for (const changes of [{ kind: "other" }, { segmentIndex: 1 }, { startWordIndex: 1 }, { wordCount: 3 },
    { sentenceText: "Changed original sentence" }, { segmentationVersion: "phrase-v2" }]) {
    assert.equal(matchesPracticeTarget({ ...valid, scope: { ...valid.scope, ...changes } }, phraseLesson, 0, 0), false);
  }
  assert.equal(matchesPracticeTarget({ ...valid, referenceText: "Other phrase" }, phraseLesson, 0, 0), false);
  assert.equal(matchesPracticeTarget({ ...valid, lessonId: 999 }, phraseLesson, 0, 0), false);
  const staleLesson = { ...phraseLesson, sentences: [{ text: "Changed original sentence" }, ...phraseLesson.sentences.slice(1)] };
  assert.equal(matchesPracticeTarget(valid, staleLesson, 0, 0), false);
});

test("repeated identical phrase text stays distinct in progress and comparisons", () => {
  const first = phraseAttempt(1, 1, 0);
  const second = phraseAttempt(3, 1, 1);
  assert.equal(matchesPracticeTarget(first, phraseLesson, 1, 1), false);
  assert.equal(matchesPracticeTarget(second, phraseLesson, 1, 1), true);
  assert.deepEqual([...completedPracticeTargets([first], phraseLesson, "segment")], ["segment:1:0:phrase-v1"]);
  assert.equal(compareAttempts(second, [first]), null);
  const previous = phraseAttempt(2, 1, 1);
  assert.equal(compareAttempts(second, [first, previous]).previous.scope.segmentIndex, 1);
});

test("phrase progress excludes full attempts, stale snapshots and recordings needing retry", () => {
  const good = phraseAttempt(1), retry = phraseAttempt(2, 0, 1);
  retry.assessment.interpretation = { feedbackMode: "record_again" };
  const stale = phraseAttempt(3, 1, 0); stale.scope.segmentationVersion = "old";
  const full = attempt(4, { referenceText: phraseLesson.sentences[0].text });
  const fallback = attempt(5, { sentenceIndex: 2, referenceText: phraseLesson.sentences[2].text });
  assert.deepEqual([...completedPracticeTargets([good, retry, stale, full, fallback], phraseLesson, "segment")], ["segment:0:0:phrase-v1", "sentence:2"]);
  assert.deepEqual([...completedPracticeTargets([good, full], phraseLesson, "sentence")], ["sentence:0"]);
});

test("comparison keeps phrase and full scores separate and ignores other source scopes", () => {
  const current = phraseAttempt(5);
  const old = phraseAttempt(1);
  const full = attempt(4, { referenceText: current.referenceText });
  const stale = phraseAttempt(3); stale.scope.sentenceText += " changed";
  const moved = phraseAttempt(2); moved.scope.startWordIndex++;
  assert.equal(compareAttempts(current, [full, stale, moved, old]).previous.attemptId, 1);
  assert.equal(compareAttempts(current, [full, stale, moved]), null);
  const nextVersion = phraseAttempt(6); nextVersion.scope.segmentationVersion = "phrase-v2";
  assert.equal(compareAttempts(nextVersion, [current]), null);
  assert.equal(compareAttempts(attempt(3, { scope: null }), [attempt(2)]).previous.attemptId, 2);
});
