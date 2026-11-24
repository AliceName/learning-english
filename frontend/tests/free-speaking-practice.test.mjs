import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const source = fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const sandbox = { exports: {}, require: dependency => load(dependency.replace("./", "")) };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, sandbox);
  modules.set(name, sandbox.exports);
  return sandbox.exports;
}
const { practiceBand, practiceScore, speakingReviewPlan, comparePracticeAttempts } = load("free-speaking-practice");
const { recordingIssueAdvice, readRecordingIssue } = load("speaking-recording-issue");
function attempt(id, score, mode = "normal") {
  return { id, createdAt: Number(id), recording: {}, assessment: { modelVersion: "ref2-cal1", overallScore: score, coverage: 1,
    referenceTokenCount: 1, interpretation: { feedbackMode: mode }, words: [{ index: 0, text: "book", phones: [{ sourcePhone: "B", symbol: "b" }] }] } };
}

test("recordings needing retry never become low-score sentences or enter the score average", () => {
  for (const score of [0, 99]) {
    const sentence = { result: attempt("1", score, "record_again") };
    assert.equal(practiceBand(sentence), "record_again");
    assert.equal(practiceScore(sentence), null);
  }
  assert.equal(practiceBand({}), "pending");
  assert.equal(practiceBand({ result: attempt("2", 30) }), "priority");
});

test("history compares the selected attempt with its predecessor and blocks model/audio/mapping changes", () => {
  const items = [attempt("3", 90), attempt("2", 70), attempt("1", 60)];
  assert.equal(comparePracticeAttempts(items[1], items).delta, 10);
  assert.equal(comparePracticeAttempts(items[2], items), null);
  items[2].assessment.modelVersion = "other";
  assert.equal(comparePracticeAttempts(items[1], items).delta, null);
  items[2] = attempt("1", 60, "record_again");
  assert.equal(comparePracticeAttempts(items[1], items).delta, null);
  items[2] = attempt("1", 60);
  items[2].assessment.words[0].phones[0].symbol = "p";
  assert.equal(comparePracticeAttempts(items[1], items).delta, null);
});

test("review uses the chosen occurrence, preserves contractions and keeps the phrase within five words", () => {
  const text = "I can't see you, but I can hear you clearly.";
  const plan = speakingReviewPlan(text, 8);
  assert.equal(plan.word, "you");
  assert.equal(plan.steps[0].text, "you");
  assert.equal(plan.steps[1].text, "I can hear you clearly");
  assert.equal(plan.steps[2].text, text);
  const first = speakingReviewPlan(text, 1);
  assert.equal(first.steps[0].text, "can't");
  assert.equal(first.steps[0].context.sentenceText, text);
  assert.equal(first.steps[0].context.startWordIndex, 1);
  assert.equal(first.steps[1].text, "I can't see you, but");
  assert.equal(plan.steps[1].context.startWordIndex, 5);
  assert.equal(plan.steps[2].context, undefined);
  assert.equal(speakingReviewPlan(text, -1), null);
  assert.equal(speakingReviewPlan(text, 100), null);
});

test("one-word and short sentences do not create duplicate review steps", () => {
  assert.equal(speakingReviewPlan("Hello!", 0).steps.length, 1);
  assert.equal(speakingReviewPlan("I love books.", 2).steps.length, 2);
  assert.equal(speakingReviewPlan("I love books.", 2).steps[1].kind, "sentence");
  assert.equal(speakingReviewPlan("I love books.", 2).steps[1].text, "I love books.");
  assert.equal(speakingReviewPlan("", 0), null);
});

test("diagnostics describe acoustic evidence and discard unknown server fields", () => {
  assert.match(recordingIssueAdvice({ code: "clipping" }), /quá lớn/);
  assert.match(recordingIssueAdvice({ code: "phoneme_mismatch" }), /Chuỗi âm/);
  assert.equal(recordingIssueAdvice({ code: "__proto__" }), null);
  assert.equal(recordingIssueAdvice(null), null);
  assert.equal(readRecordingIssue({ code: "too_quiet", transcript: "invented text" }).transcript, undefined);
});
