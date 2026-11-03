import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/pronunciation-feedback.ts", import.meta.url), "utf8");
const sandbox = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
const { practiceTargets, feedbackMode, feedbackThresholds, wordFeedback, sentenceFeedback } = sandbox.exports;
const word = (index, score, status = "scored") => ({ index, text: "playing", status, score: status === "scored" ? 1.9 : null,
  phones: status === "scored" ? [{ sourcePhone: "P", symbol: "p", score }] : [], reason: null });
const assessment = (words = [], overrides = {}) => ({ coverage: 1, words,
  interpretation: { practiceThreshold: 1.1, reviewThreshold: 1.5, feedbackMode: "normal" }, ...overrides });

test("weak phones and borderline phones produce different suggestions", () => {
  const targets = practiceTargets([word(0, 1.3), word(1, .9), word(2, 1.9), word(3, 0, "unsupported")], 1.1, 1.5);
  assert.deepEqual(Array.from(targets, t => [t.word.index, t.band]), [[1, "practice"], [0, "listen"]]);
});
test("threshold boundaries, partial support and maximum three targets remain conservative", () => {
  const targets = practiceTargets([word(0, 1.1), word(1, 1.5), word(2, .5), word(3, .6), word(4, .7)], 1.1, 1.5);
  assert.deepEqual(Array.from(targets, t => t.word.index), [2, 3, 4]);
  assert.equal(practiceTargets([word(0, 1.1)], 1.1, 1.5)[0].band, "listen");
  assert.equal(practiceTargets([word(0, 1.5)], 1.1, 1.5).length, 0);
  assert.equal(practiceTargets([word(0, .5, "unsupported")], 1.1, 1.5).length, 0);
});
test("rerecord policy is separate from low coverage and legacy results have a safe fallback", () => {
  assert.equal(feedbackMode({ coverage: 1, interpretation: { feedbackMode: "record_again" } }), "record_again");
  assert.equal(feedbackMode({ coverage: .7 }), "limited_coverage");
  assert.equal(feedbackMode({ coverage: 1 }), "normal");
});

test("every word color follows exact phoneme thresholds, including equality boundaries", () => {
  const value = assessment();
  for (const [score, tone] of [[0, "practice"], [1.0999, "practice"], [1.1, "listen"], [1.4999, "listen"], [1.5, "good"], [2, "good"]]) {
    assert.equal(wordFeedback(word(0, score), value).tone, tone, `score ${score}`);
  }
  const custom = assessment([], { interpretation: { practiceThreshold: 1.3, reviewThreshold: 1.7, feedbackMode: "normal" } });
  assert.equal(wordFeedback(word(0, 1.2), custom).tone, "practice");
  assert.equal(wordFeedback(word(0, 1.3), custom).tone, "listen");
  assert.equal(wordFeedback(word(0, 1.7), custom).tone, "good");
});

test("a high word average cannot hide its weakest supported phoneme", () => {
  const mixed = word(0, 1.9);
  mixed.phones.push({ sourcePhone: "L", symbol: "l", score: .8 });
  const value = wordFeedback(mixed, assessment());
  assert.equal(value.tone, "practice");
  assert.ok(value.description.includes("0.80/2"));
});

test("all low-score words are colored even when detailed advice is capped at three", () => {
  const words = Array.from({ length: 6 }, (_, index) => word(index, .9));
  const parts = sentenceFeedback(words.map(item => item.text).join(" "), assessment(words));
  assert.equal(practiceTargets(words, 1.1, 1.5).length, 3);
  assert.deepEqual(Array.from(parts).filter(part => part.feedback).map(part => part.feedback.tone), Array(6).fill("practice"));
});

test("partial mapping is never unqualified green, while supported low-score phones keep their warning", () => {
  const partial = { ...word(0, 1.9), reason: "Từ này chỉ được chấm một phần." };
  const high = wordFeedback(partial, assessment());
  assert.equal(high.tone, "unassessed"); assert.equal(high.partial, true);
  assert.ok(high.label.includes("một phần"));
  partial.phones[0].score = .7;
  assert.equal(wordFeedback(partial, assessment()).tone, "practice");
  assert.equal(wordFeedback(partial, assessment()).partial, true);
  assert.equal(wordFeedback({ ...word(0, 1.9), reason: "   " }, assessment()).tone, "good");
});

test("record-again overrides every score with neutral uncertainty instead of right-or-wrong colors", () => {
  const words = [word(0, .1), word(1, 1.3), word(2, 2), word(3, 0, "unsupported")];
  const value = assessment(words, { interpretation: { practiceThreshold: 1.1, reviewThreshold: 1.5, feedbackMode: "record_again" } });
  const colors = sentenceFeedback("playing playing playing playing", value).filter(part => part.feedback);
  assert.equal(colors.length, 4);
  for (const part of colors) {
    assert.equal(part.feedback.tone, "unassessed");
    assert.equal(part.feedback.label, "Cần ghi âm lại");
  }
});

test("missing, unsupported, non-finite or out-of-range scores remain neutral", () => {
  const value = assessment();
  const invalid = [undefined, word(0, 0, "unsupported"), { ...word(0, 1.9), phones: [] }, { ...word(0, 1.9), score: null }];
  for (const score of [NaN, Infinity, -.01, 2.01]) {
    invalid.push(word(0, score), { ...word(0, 1.9), score });
  }
  for (const item of invalid) assert.equal(wordFeedback(item, value).tone, "unassessed");
});

test("repeated words and apostrophe variants retain their own indices without changing punctuation", () => {
  const text = "Go, go! Don't stop—don’t stop.";
  const words = [["Go", 1.8], ["go", .8], ["Don't", 1.2], ["stop", 1.9], ["don't", 1.8], ["stop", 1.3]]
    .map(([text, score], index) => ({ ...word(index, score), text }));
  const parts = sentenceFeedback(text, assessment(words));
  assert.equal(Array.from(parts, part => part.text).join(""), text);
  const tokens = Array.from(parts).filter(part => part.feedback);
  assert.deepEqual(tokens.map(part => part.wordIndex), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(tokens.map(part => part.feedback.tone), ["good", "practice", "listen", "good", "good", "listen"]);
  assert.ok(Array.from(parts).filter(part => part.wordIndex === null).every(part => part.feedback === null));
});

test("missing or mismatched word positions are neutral, and source array order does not decide a word color", () => {
  const words = [{ ...word(1, .7), text: "same" }, { ...word(0, 1.9), text: "different" }, { ...word(4, 1.9), text: "absent" }];
  const tokens = Array.from(sentenceFeedback("same same absent", assessment(words))).filter(part => part.feedback);
  assert.deepEqual(tokens.map(part => part.feedback.tone), ["unassessed", "practice", "unassessed"]);
});

test("low sentence coverage preserves valid supported-word colors with partial scope", () => {
  const words = [word(0, 1.9), word(1, .7)];
  const value = assessment(words, { coverage: .5, interpretation: { practiceThreshold: 1.1, reviewThreshold: 1.5, feedbackMode: "limited_coverage" } });
  assert.deepEqual(Array.from(sentenceFeedback("playing playing", value)).filter(part => part.feedback).map(part => part.feedback.tone), ["good", "practice"]);
});

test("legacy results and invalid thresholds use finite ordered fallback thresholds", () => {
  const legacy = assessment([], { interpretation: undefined });
  assert.deepEqual({ ...feedbackThresholds(legacy) }, { practice: 1.5, review: 1.5 });
  assert.equal(wordFeedback(word(0, 1.49), legacy).tone, "practice");
  assert.equal(wordFeedback(word(0, 1.5), legacy).tone, "good");
  const invalid = assessment([], { interpretation: { practiceThreshold: NaN, reviewThreshold: Infinity } });
  assert.deepEqual({ ...feedbackThresholds(invalid) }, { practice: 1.5, review: 1.5 });
  const reversed = assessment([], { interpretation: { practiceThreshold: 1.8, reviewThreshold: 1.2 } });
  assert.deepEqual({ ...feedbackThresholds(reversed) }, { practice: 1.8, review: 1.8 });
});
