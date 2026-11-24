import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const source = await fs.readFile(path.join(root, "src/lib/free-speaking-history.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://localhost:51799/**", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><html><body>Speaking history fixture</body></html>",
  }));
  await page.goto("http://localhost:51799/");
  const result = await page.evaluate(async compiled => {
    const api = {};
    new Function("exports", compiled)(api);
    const { appendPracticeResult, changeSentenceBookmark, loadSentences, practiceAttempts,
      practiceAttemptLimit, practiceSentenceKey, savePracticeResult, saveSentence, sentenceKey } = api;
    const checks = [];
    function check(condition, label) {
      if (!condition) throw new Error(label);
      checks.push(label);
    }
    const recording = text => new Blob([text], { type: "audio/wav" });
    const assessment = score => ({ modelVersion: "fixture", overallScore: score });
    const legacy = {
      account: "owner", id: "legacy sentence", text: "Legacy sentence", updatedAt: 1000, saved: true,
      bookmarkNote: "Original note", result: { assessment: assessment(60), recording: recording("legacy") },
    };
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("lewa-free-speaking", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("sentences", { keyPath: ["account", "id"] });
        store.createIndex("account", "account");
        store.put(legacy);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });

    const loaded = (await loadSentences("owner"))[0];
    check(loaded.attempts === undefined && practiceAttempts(loaded).length === 1, "Version-one records expose their original recording");
    check(practiceAttempts(loaded)[0].id === practiceAttempts((await loadSentences("owner"))[0])[0].id,
      "Legacy attempt identifiers remain stable across reads");

    await Promise.all([
      savePracticeResult(loaded, { assessment: assessment(70), recording: recording("first") }),
      saveSentence(loaded, { saved: false, bookmarkNote: "Concurrent bookmark note" }),
    ]);
    let current = (await loadSentences("owner"))[0];
    check(current.attempts.length === 2 && current.result.assessment.overallScore === 70,
      "A newly scored result keeps the original attempt");
    check(!current.saved && current.bookmarkNote === "Concurrent bookmark note",
      "Concurrent scoring and bookmark changes preserve both updates");

    await Promise.all([
      savePracticeResult(loaded, { assessment: assessment(80), recording: recording("second") }),
      savePracticeResult(loaded, { assessment: assessment(90), recording: recording("third") }),
    ]);
    current = (await loadSentences("owner"))[0];
    check(current.attempts.length === 4 && new Set(current.attempts.map(attempt => attempt.id)).size === 4,
      "Concurrent results from stale callers retain every distinct attempt");
    check(current.result.assessment.overallScore === current.attempts[0].assessment.overallScore,
      "The latest result agrees with the newest retained attempt");
    check(await current.attempts.find(attempt => attempt.id.startsWith("legacy-")).recording.text() === "legacy",
      "Original recording bytes survive IndexedDB round trips");

    const previousPut = IDBObjectStore.prototype.put;
    let failed = false;
    try {
      IDBObjectStore.prototype.put = () => { throw new DOMException("Fixture quota", "QuotaExceededError"); };
      await savePracticeResult(loaded, { assessment: assessment(100), recording: recording("failed") });
    } catch (error) {
      failed = error.name === "QuotaExceededError";
    } finally {
      IDBObjectStore.prototype.put = previousPut;
    }
    const afterFailure = (await loadSentences("owner"))[0];
    check(failed && afterFailure.attempts.length === 4 && afterFailure.result.assessment.overallScore === current.result.assessment.overallScore,
      "A failed storage transaction leaves previous results available");

    await changeSentenceBookmark("owner", legacy.id, { saved: true, bookmarkNote: "Restored note" });
    current = (await loadSentences("owner"))[0];
    check(current.saved && current.bookmarkNote === "Restored note" && current.attempts.length === 4,
      "Bookmark restoration keeps all retained attempts");
    await saveSentence({ ...legacy, account: "other" });
    check((await loadSentences("owner"))[0].attempts.length === 4 && (await loadSentences("other"))[0].attempts === undefined,
      "Attempt history stays within the owning account");

    const pastContext = { sentenceText: "I read a book yesterday.", startWordIndex: 1 };
    const presentContext = { sentenceText: "I read books every day.", startWordIndex: 1 };
    const contextualSentence = context => ({ account: "contexts", text: "read", id: practiceSentenceKey("read", context),
      ...(context ? { context } : {}), saved: false, updatedAt: 2000 });
    const standalone = contextualSentence();
    const past = contextualSentence(pastContext);
    const present = contextualSentence(presentContext);
    check(standalone.id === sentenceKey("read") && new Set([standalone.id, past.id, present.id]).size === 3,
      "Standalone, past-tense, and present-tense practice receive separate sentence identities");
    check(practiceSentenceKey("READ", { ...pastContext, sentenceText: "I  READ a book yesterday." }) === past.id
      && practiceSentenceKey("read", { ...pastContext, startWordIndex: 2 }) !== past.id,
      "Context identifiers normalize text while retaining the original word position");
    await Promise.all([standalone, past, present].map((sentence, index) => savePracticeResult(sentence,
      { assessment: assessment(50 + index), recording: recording(sentence.id) })));
    await Promise.all([
      savePracticeResult(past, { assessment: assessment(75), recording: recording("past-new") }),
      changeSentenceBookmark("contexts", past.id, { saved: true, bookmarkNote: "Past-tense read" }),
    ]);
    const contextRows = await loadSentences("contexts");
    const savedPast = contextRows.find(sentence => sentence.id === past.id);
    check(contextRows.length === 3 && savedPast.context.sentenceText === pastContext.sentenceText
      && savedPast.context.startWordIndex === 1 && savedPast.attempts.length === 2
      && contextRows.find(sentence => sentence.id === present.id).result.assessment.overallScore === 52
      && contextRows.find(sentence => sentence.id === standalone.id).result.assessment.overallScore === 50,
      "Contextual results keep their source sentence and do not replace other readings of the same word");
    check(savedPast.saved && savedPast.bookmarkNote === "Past-tense read"
      && contextRows.find(sentence => sentence.id === present.id).saved === false,
      "Bookmarks remain attached to the correct contextual reading during concurrent scoring");

    let bounded = legacy;
    for (let index = 1; index <= 12; index++) {
      bounded = appendPracticeResult(bounded, { assessment: assessment(index), recording: recording(String(index)) }, 1000 + index, "attempt-" + index);
    }
    check(bounded.attempts.length === practiceAttemptLimit && bounded.attempts[0].id === "attempt-12" && bounded.attempts.at(-1).id === "attempt-3",
      "Retention removes the oldest audio attempts after ten results");
    bounded = appendPracticeResult(bounded, bounded.result, 1012, "attempt-12");
    check(bounded.attempts.length === practiceAttemptLimit && bounded.attempts.filter(attempt => attempt.id === "attempt-12").length === 1,
      "Reusing an attempt identifier does not duplicate it");
    const delayed = appendPracticeResult(bounded, { assessment: assessment(20), recording: recording("delayed") }, 1005, "delayed");
    check(delayed.result.assessment.overallScore === bounded.result.assessment.overallScore
      && delayed.updatedAt === 1012 && delayed.attempts[0].id === "attempt-12",
      "Out-of-order timestamps preserve the latest result and ordering");
    const tied = appendPracticeResult(bounded, { assessment: assessment(99), recording: recording("same-time") }, 1012, "same-time");
    check(tied.attempts[0].id === "same-time" && tied.attempts[1].id === "attempt-12"
      && tied.result.assessment.overallScore === 99,
      "Equal timestamps use the most recently appended attempt first");
    return checks;
  }, compiled);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: result }));
} finally {
  await browser.close();
}
