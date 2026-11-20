const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const filename = path.join(__dirname, "..", "src", "lib", "course-catalog.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sandbox = { exports: {}, URLSearchParams };
vm.runInNewContext(compiled, sandbox, { filename });
const { courseCompletion, lessonHasAttempted } = sandbox.exports;
const plain = value => JSON.parse(JSON.stringify(value));

test("completion includes all five skills in the course denominator", () => {
  const lessons = ["speaking", "listening", "grammar", "reading", "writing"].map((skillType, lessonId) => ({
    lessonId, skillType, hasAttempted: skillType === "listening", listeningStatus: skillType === "listening" ? { attemptCount: 3, latestScore: 100 } : null,
  }));
  assert.deepEqual(plain(courseCompletion(lessons)), { completedLessons: 1, totalLessons: 5, percent: 20 });
  lessons[0].hasAttempted = true;
  lessons[4].hasAttempted = true;
  assert.deepEqual(plain(courseCompletion(lessons)), { completedLessons: 3, totalLessons: 5, percent: 60 });
});

test("empty, unstarted and completed courses have valid bounded percentages", () => {
  assert.deepEqual(plain(courseCompletion([])), { completedLessons: 0, totalLessons: 0, percent: 0 });
  assert.equal(courseCompletion([{ hasAttempted: false }, {}]).percent, 0);
  assert.equal(courseCompletion([{ hasAttempted: true }, { hasAttempted: true }]).percent, 100);
  assert.equal(courseCompletion([{ hasAttempted: true }, ...Array.from({ length: 5 }, () => ({ hasAttempted: false }))]).percent, 16.67);
});

test("retries and low scores still count a lesson once and preserve legacy listening results", () => {
  const lessons = [
    { listeningStatus: { attemptCount: 10, latestScore: 0 } },
    { listeningStatus: { attemptCount: 0, latestScore: 0 } },
    { hasAttempted: true, listeningStatus: null },
    { hasAttempted: false },
  ];
  assert.deepEqual(plain(courseCompletion(lessons)), { completedLessons: 2, totalLessons: 4, percent: 50 });
  assert.equal(lessonHasAttempted({}), false);
});
