// Actual React components in an isolated browser harness; no server needs to be started.
// Accounts, media and HTTP responses are fixtures; Next routes and SQL persistence are tested separately.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildListeningHarness } from "./listening-browser-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const base = "http://listening.fixture";
const reports = path.resolve(root, "../reports"), checks = [], errors = [];
const calls = { start: 0, transcript: 0, submissions: 0, positions: 0 };
const history = [];
let failSubmission = true;
const mediaName = "b".repeat(32) + ".wav", prefix = "/api/v1/courses/1/lessons/2/listening";
const lesson = {
  courseId: 1, courseTitle: "Tiếng Anh Giao Tiếp Thực Tế", lessonId: 2, title: "Ordering Coffee & Fast-paced Flow", difficultyLevel: "B1", estimatedMinutes: 15,
  audioUrl: "/api/media/" + mediaName, contentVersion: "A".repeat(64), hideTranscriptFirstListen: true, positionSeconds: 0,
  attemptCount: 0, latestResult: null, progress: { completedLessons: 0, totalLessons: 2, percent: 0 },
  lessons: [{ lessonId: 2, title: "Ordering Coffee", completed: false }, { lessonId: 3, title: "At the office", completed: false }],
  questions: [
    { questionId: 0, type: "multiple_choice", prompt: "When is the meeting?", options: ["Monday", "Thursday"], matchingLeft: [], matchingRight: [], atSeconds: 0 },
    { questionId: 1, type: "fill_blank", prompt: "The meeting is on [blank].", options: [], matchingLeft: [], matchingRight: [], atSeconds: 1 },
    { questionId: 2, type: "matching", prompt: "Nối các từ với nghĩa tương ứng.", options: [], matchingLeft: ["meeting", "Thursday"], matchingRight: [{ id: "opaque-thursday", text: "thứ Năm" }, { id: "opaque-meeting", text: "cuộc họp" }], atSeconds: null },
  ],
};
const wav = Buffer.alloc(44 + 8000 * 2 * 4);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let index = 0; index < 32000; index++) wav.writeInt16LE(Math.round(Math.sin(index * Math.PI * 440 / 4000) * 200), 44 + index * 2);
const json = (route, data, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(data) });
const backend = async response => {
  const request = response.request();
  try {
    const url = new URL(request.url()), route = url.pathname.replace("/api/learning/", "/api/v1/").replace("/api/media/", "/api/v1/media/");
    if (route === "/api/v1/auth/me") return json(response, { userId: 42, email: "listening-test@example.com", fullName: "Học viên kiểm thử", role: "user", targetLevel: "B1", currentStreak: 2, createdAt: "2026-10-28T00:00:00" });
    if (route === "/api/v1/media/" + mediaName) {
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers()["range"] ?? "");
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(wav.length - 1, Number(range[2])) : wav.length - 1;
      if (start >= wav.length) return response.fulfill({ status: 416, headers: { "Content-Range": `bytes */${wav.length}` } });
      return response.fulfill({ status: range ? 206 : 200, headers: { "Content-Type": "audio/wav", "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${wav.length}` } : {}) }, body: wav.subarray(start, end + 1) });
    }
    if (route === prefix && request.method() === "GET") return json(response, { ...lesson, attemptCount: history.length, latestResult: history[0]?.result ?? null, progress: history[0]?.progress ?? lesson.progress });
    if (route === prefix + "/start") { calls.start++; return json(response, { positionSeconds: 0 }); }
    if (route === prefix + "/transcript") { calls.transcript++; return json(response, { transcript: "[00:00] Sarah: The meeting is on Thursday.\n[00:01] Please arrive early." }); }
    if (route === prefix + "/position") { calls.positions++; return json(response, { saved: true }); }
    if (route === prefix + "/submissions") {
      calls.submissions++;
      const body = request.postData();
      if (failSubmission) { failSubmission = false; return json(response, { title: "Mạng thử nghiệm tạm thời gián đoạn. Hãy nộp lại." }, 503); }
      const input = JSON.parse(body), find = index => input.answers.find(answer => answer.questionId === index);
      const correct = [find(0)?.optionIndex === 1, find(1)?.text?.trim().toLowerCase() === "thursday", find(2)?.matches?.length === 2 && find(2).matches.every(match => match.rightId === (match.leftIndex === 0 ? "opaque-meeting" : "opaque-thursday"))];
      const review = lesson.questions.map((question, index) => ({ questionId: index, type: question.type, prompt: question.prompt, correct: !!correct[index],
        submittedAnswer: find(index) ? index === 0 ? question.options[find(index).optionIndex] : find(index).text ?? "Các cặp đã chọn" : null,
        correctAnswer: index === 0 || index === 1 ? "Thursday" : "meeting → cuộc họp; Thursday → thứ Năm", explanation: "The meeting is on Thursday.", atSeconds: question.atSeconds, pairs: [] }));
      const count = correct.filter(Boolean).length, result = { resultId: history.length + 1, score: Math.round(count / 3 * 10000) / 100, totalQuestions: 3, correctAnswers: count, timeSpentSeconds: input.timeSpentSeconds, submittedAt: "2026-10-28T15:20:00" };
      const saved = { result, fullReview: true, review, progress: { completedLessons: 1, totalLessons: 2, percent: 50 } };
      history.unshift(saved); return json(response, saved);
    }
    if (route === prefix + "/results") return json(response, { items: history.map(item => item.result), totalCount: history.length, page: 1, pageSize: 10, totalPages: history.length ? 1 : 0 });
    if (route.startsWith(prefix + "/results/")) { const item = history.find(item => item.result.resultId === Number(route.split("/").at(-1))); return json(response, { ...item, fullReview: false, review: item.review.filter(review => !review.correct) }); }
    return json(response, { title: "Fixture route not found" }, 404);
  } catch (error) { return json(response, { title: String(error) }, 500); }
};
const harness = await buildListeningHarness();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin !== base) return route.abort();
  if (url.pathname === "/app.js") return route.fulfill({ contentType: "application/javascript; charset=utf-8", body: harness.bundle });
  if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer}a{text-decoration:none}</style></head><body><div id="app"></div><script>window.__LISTENING_FIXTURE__=${JSON.stringify({ ...lesson, attemptCount: history.length, latestResult: history[0]?.result ?? null, progress: history[0]?.progress ?? lesson.progress })}</script><script src="/app.js"></script></body></html>` });
  return backend(route);
});
await context.addCookies([{ name: "linguaai_session", value: "listening-ui-fixture", url: base, httpOnly: true, sameSite: "Lax" }]);
const page = await context.newPage(); page.setDefaultTimeout(25000);
page.on("pageerror", error => errors.push(error.message));
const href = base + "/courses/1/lessons/2/listening";
try {
  await page.goto(href);
  await page.getByRole("heading", { name: lesson.title, exact: true }).waitFor();
  assert.equal(calls.start, 0); assert.equal(calls.transcript, 0);
  assert.equal(await page.getByRole("button", { name: "Transcript", exact: true }).isDisabled(), true);
  assert.equal(await page.locator('input[type="radio"]').first().isDisabled(), true);
  checks.push("authored lesson renders without starting or fetching hidden transcript");
  await page.getByRole("button", { name: "Bắt đầu làm bài", exact: true }).click();
  await page.getByRole("button", { name: "Nộp bài & xem kết quả", exact: true }).waitFor();
  assert.equal(calls.start, 1);
  await page.getByRole("button", { name: "Tốc độ 1.25x", exact: true }).click();
  assert.equal(await page.locator('audio[aria-label="Audio bài nghe"]').evaluate(node => node.playbackRate), 1.25);
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Phát audio"]')?.disabled);
  await page.getByRole("button", { name: "Phát audio", exact: true }).click();
  await page.getByRole("button", { name: "Tạm dừng audio", exact: true }).waitFor();
  await page.getByRole("button", { name: "Tạm dừng audio", exact: true }).click();
  await page.getByRole("slider", { name: "Vị trí phát", exact: true }).focus();
  await page.getByRole("slider", { name: "Vị trí phát", exact: true }).press("ArrowRight");
  await page.locator('audio[aria-label="Audio bài nghe"]').evaluate(node => node.dispatchEvent(new Event("ended")));
  await page.getByRole("button", { name: "Transcript", exact: true }).click();
  await page.locator("#listening-transcript").waitFor(); assert.equal(calls.transcript, 1);
  checks.push("real audio playback, seek, speed, position save and first-listen transcript");
  await page.locator('input[type="radio"][value="1"]').check();
  await page.getByLabel("Câu trả lời của bạn", { exact: true }).fill("Thursday");
  await page.getByLabel("Câu 3: meeting", { exact: true }).selectOption("opaque-meeting");
  await page.getByLabel("Câu 3: Thursday", { exact: true }).selectOption("opaque-thursday");
  assert.equal(await page.getByRole("progressbar", { name: "Tiến độ trả lời", exact: true }).getAttribute("value"), "3");
  await page.getByRole("link", { name: "← Về khóa học", exact: true }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "Rời bài đang làm?" }).waitFor();
  await page.getByRole("button", { name: "Ở lại làm bài", exact: true }).click();
  checks.push("three answer types, question progress and unsaved navigation warning");
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: path.join(reports, "listening-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Nộp bài & xem kết quả", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Mạng thử nghiệm" }).waitFor();
  assert.equal(await page.getByLabel("Câu trả lời của bạn", { exact: true }).inputValue(), "Thursday");
  await page.getByRole("button", { name: "Đóng thông báo", exact: true }).click();
  await page.getByRole("button", { name: "Nộp bài & xem kết quả", exact: true }).click();
  await page.getByRole("heading", { name: "Kết quả bài nghe", exact: true }).waitFor();
  assert.equal(history[0].result.score, 100); assert.equal(await page.getByText("Chính xác!", { exact: true }).count(), 3);
  await page.getByRole("button", { name: "Nghe lại tại 00:00", exact: true }).click();
  checks.push("failed submission retains answers; successful submission shows full server review and replay");
  await page.getByRole("button", { name: "Xem lịch sử", exact: true }).click();
  await page.getByRole("button", { name: "Xem kết quả", exact: true }).click();
  await page.getByText("Bạn đã trả lời đúng tất cả câu hỏi trong lần làm này.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Làm lại bài nghe", exact: true }).click();
  await page.getByRole("button", { name: "Nộp bài & xem kết quả", exact: true }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "Bạn còn 3 câu chưa hoàn thành", exact: true }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Nộp bài", exact: true }).click();
  await page.getByRole("heading", { name: "Kết quả bài nghe", exact: true }).waitFor();
  assert.equal(history[0].result.score, 0); assert.equal(history[0].progress.completedLessons, 1);
  checks.push("history review, retry reset, incomplete confirmation and distinct completion progress");
  await page.reload();
  await page.getByText("Đã làm 2 lần", { exact: false }).waitFor();
  assert.equal(calls.start, 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Bắt đầu làm bài", exact: true }).click();
  await page.getByRole("button", { name: "Nộp bài & xem kết quả", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: path.join(reports, "listening-mobile.png"), fullPage: true });
  checks.push("reload history and responsive mobile layout without horizontal overflow");
  await page.getByLabel("Câu trả lời của bạn", { exact: true }).fill("private answer");
  await page.evaluate(() => window.dispatchEvent(new Event("linguaai:session-changed")));
  await page.getByRole("alert").filter({ hasText: "Phiên đăng nhập đã thay đổi" }).waitFor();
  assert.equal(await page.locator('input[value="private answer"]').count(), 0);
  assert.equal(await page.locator('audio[aria-label="Audio bài nghe"]').count(), 0);
  checks.push("session change aborts requests, stops audio and clears private answers");
  assert.equal(errors.length, 0, errors.join("\n"));
  const report = { status: "passed", checks, calls, pageErrors: errors };
  await fs.writeFile(path.join(reports, "Listening_browser_checks_2026-10-28.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(reports, "listening-browser-failure.png"), fullPage: true });
  console.error(JSON.stringify({ checks, calls, pageErrors: errors, buttons: await page.getByRole("button").allTextContents(), body: (await page.locator("body").innerText()).slice(0, 2200) }, null, 2));
  throw error;
} finally { await browser.close(); await harness.cleanup(); }
