const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function load(file, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require(name) { if (name in imports) return imports[name]; throw new Error(name); } });
  return module.exports;
}
const authoring = load("admin-courses.ts");
const api = load("ai-course-personalization.ts", { "./admin-courses": authoring });
const plain = value => JSON.parse(JSON.stringify(value));
test("uses a valid profile target and falls back to B1 without sharing mutable config", () => {
  for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"]) assert.equal(api.personalizedAiConfig(level).difficultyLevel, level);
  for (const level of [undefined, null, "", "b2", "C9"]) assert.equal(api.personalizedAiConfig(level).difficultyLevel, "B1");
  const first = api.personalizedAiConfig("B2"), second = api.personalizedAiConfig("B2");
  first.skills.pop();
  assert.equal(second.skills.length, 5);
  assert.equal(authoring.authoringSkills.length, 5);
});
test("goal presets suggest useful skills and keep the learner's other choices intact", () => {
  const original = { ...api.personalizedAiConfig("C1"), lessonCount: 3, questionsPerLesson: 5, targetAudioSeconds: 90, voice: "Puck" };
  for (const [id, expected] of [["daily", ["speaking", "listening"]], ["work", ["speaking", "reading", "writing"]], ["study", ["listening", "reading", "writing", "grammar"]]]) {
    const config = api.aiConfigForGoal(original, id);
    assert.deepEqual(plain(config.skills), expected);
    assert.ok(config.goal.length >= 5 && config.goal.length <= 1000);
    for (const field of ["difficultyLevel", "lessonCount", "questionsPerLesson", "targetAudioSeconds", "voice"]) assert.equal(config[field], original[field]);
    assert.notEqual(config.skills, original.skills);
  }
  assert.equal(original.skills.length, 5);
  assert.equal(api.aiConfigForGoal(original, "unknown"), original);
});
test("validates source files at the exact 10 MB boundary before sending them", () => {
  assert.equal(api.courseFileError({ name: "Source.PDF", size: 10 * 1024 * 1024 }), null);
  assert.equal(api.courseFileError({ name: "notes.docx", size: 128 }), null);
  assert.ok(api.courseFileError({ name: "notes.pdf", size: 0 }));
  assert.ok(api.courseFileError({ name: "notes.pdf", size: 10 * 1024 * 1024 + 1 }));
  for (const name of ["notes.doc", "notes.pdf.exe", "notes.txt", "notes"]) assert.ok(api.courseFileError({ name, size: 128 }));
});
