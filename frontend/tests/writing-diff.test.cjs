const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const filename = path.join(__dirname, "../src/lib/writing-diff.ts");
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: moduleObject.exports, module: moduleObject, Uint32Array }, { filename });
const { diffWritingText } = moduleObject.exports;

function roundTrip(original, suggestion) {
  const result = diffWritingText(original, suggestion);
  assert.equal(result.parts.map(p => p.kind === "equal" ? p.text : p.before).join(""), original);
  assert.equal(result.parts.map(p => p.kind === "equal" ? p.text : p.after).join(""), suggestion);
  return result;
}
function changes(result) {
  return Array.from(result.parts.filter(p => p.kind === "change"), p => [p.before, p.after]);
}

test("a one-word typo marks that word without rewriting unchanged sentence context", () => {
  const diff = roundTrip("English is spoken nativelys, so I practise.", "English is spoken natively, so I practise.");
  assert.deepEqual(changes(diff), [["nativelys", "natively"]]);
  assert.equal(diff.parts[0].text, "English is spoken ");
});

test("sentence-level suggestions preserve each word change, including a wrong model capitalization", () => {
  assert.deepEqual(changes(roundTrip("It were Friends.", "It was friends.")), [["were", "was"], ["Friends", "friends"]]);
  assert.deepEqual(changes(roundTrip("When I started feeling mores confident.", "When I started feeling more confident.")), [["mores", "more"]]);
  assert.deepEqual(changes(roundTrip("I needed to geted used to the speed.", "I needed to get used to the speed.")), [["geted", "get"]]);
});

test("punctuation insertion, article removal, and space-only edits stay local", () => {
  assert.deepEqual(changes(roundTrip("After that I watched.", "After that, I watched.")), [["", ","]]);
  assert.deepEqual(changes(roundTrip("with the subtitles", "with subtitles")), [["the ", ""]]);
  assert.deepEqual(changes(roundTrip("in English ; paused", "in English; paused")), [[" ", ""]]);
});

test("repeated sentences do not highlight the earlier unchanged occurrence", () => {
  const diff = roundTrip("I work.\n\nI work.", "I work.\n\nI worked.");
  assert.equal(diff.parts[0].text, "I work.\n\nI ");
  assert.deepEqual(changes(diff), [["work", "worked"]]);
});

test("raw Unicode, contractions, paragraphs, tabs and punctuation reconstruct exactly", () => {
  for (const [a, b] of [["👩‍💻 I couldn’t writes.\r\n\r\nViệt", "👩‍💻 I couldn’t write.\r\n\r\nViệt"],
    ["A\tB  C\n", "A B C\r\n"], ["everyday", "every day"], ["", "new"], ["old", ""], ["", ""],
    ["unchanged", "unchanged"], ["<script>alert('x')</script>", "<script>alert('y')</script>"]]) roundTrip(a, b);
});

test("large adversarial responses use bounded work and explicitly decline detailed highlighting", () => {
  const diff = roundTrip("a ".repeat(2000), "b ".repeat(2000));
  assert.equal(diff.detailed, false);
});

test("all seven suggestions from the user's scenario preserve both source and target", () => {
  for (const [a, b] of [["But English is spoken nativelys.", "But English is spoken natively."],
    ["It were Friends.", "It was friends."], ["After that I always found what to watch.", "After that, I always found what to watch."],
    ["First, I watched films in English with the subtitles.", "First, I watched films in English with subtitles."],
    ["Later, English ; paused", "Later, English; paused"], ["I started feeling mores confident", "I started feeling more confident"],
    ["I needed to geted used", "I needed to get used"]]) {
    assert.equal(roundTrip(a, b).detailed, true);
  }
});
