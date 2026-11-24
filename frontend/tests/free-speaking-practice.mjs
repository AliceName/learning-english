import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reports = path.resolve(root, "../reports");
await fs.mkdir(reports, { recursive: true });
const temporary = await fs.mkdtemp(path.join(reports, "speaking-ui-fixture-"));
const originalTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP };
process.env.TEMP = temporary;
process.env.TMP = temporary;
const require = createRequire(path.join(root, "package.json"));
const { webpack } = require("next/dist/compiled/webpack/webpack");
const modulePath = value => JSON.stringify(value.replaceAll("\\", "/"));
const origin = "http://localhost:51803";
const account = "speaking-ui-fixture";
const lowText = "She enjoys playing badminton with her friends every weekend.";
const highText = "We practice English together every morning.";
const retryText = "This recording needs a clearer microphone.";
const newText = "I practice speaking every day.";

function assessment(text, score, retry = false) {
  const words = [...text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)].map((match, index) => {
    const wordScore = match[0] === "playing" && score < 60 ? 1 : 1.8;
    return { index, text: match[0], status: "scored", score: wordScore, reason: null,
      feedbackEligible: !retry,
      phones: [{ sourcePhone: "P", symbol: "p", score: wordScore, startSeconds: index * .2, endSeconds: index * .2 + .15 }] };
  });
  return { status: "scored", modelVersion: "fixture-v1", durationSeconds: 2.4, overallScore: score,
    coverage: 1, referenceTokenCount: words.length, words,
    warnings: retry ? ["Fixture recording requires another take."] : [], feedback: "Fixture pronunciation feedback.",
    interpretation: { calibrationVersion: "fixture", calibrationMethod: "identity", practiceThreshold: 1.5,
      reviewThreshold: 1.7, thresholdFitted: false, minimumCoverage: .8,
      feedbackMode: retry ? "record_again" : "normal", evidenceScope: "fixture" },
    recordingIssue: retry ? { code: "too_quiet" } : null };
}

function wav(value) {
  const rate = 16000;
  const dataSize = rate * 2;
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + dataSize, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(dataSize, 40);
  for (let index = 44; index < bytes.length; index += 2) bytes.writeInt16LE(value, index);
  return bytes;
}
const oldWav = wav(500), latestWav = wav(700), firstWav = wav(900), secondWav = wav(1100), failureWav = wav(1300);
const fixtures = [
  { text: lowText, score: 40 },
  { text: highText, score: 90, oldScore: 60 },
  { text: retryText, score: 0, retry: true },
];
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
let browser;
try {
  await fs.writeFile(path.join(temporary, "typescript.cjs"), `module.exports = source => require(${modulePath(path.join(root, "node_modules/typescript"))}).transpileModule(source,{compilerOptions:{target:7,module:99,jsx:4,esModuleInterop:true}}).outputText;`);
  await fs.writeFile(path.join(temporary, "css.cjs"), `module.exports = function(source) {
    const prefix='fixture_'+require('node:crypto').createHash('sha256').update(this.resourcePath).digest('hex').slice(0,8)+'_';
    const classes={};const css=source.replace(/\\.([A-Za-z_][\\w-]*)/g,(_,name)=>{classes[name]=prefix+name;return '.'+prefix+name});
    return 'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.appendChild(style);module.exports='+JSON.stringify(classes)+';';
  };`);
  await fs.writeFile(path.join(temporary, "image.tsx"), `import React from 'react';export default function Image({src,alt,unoptimized,fill,priority,...props}){return <img src={src} alt={alt} {...props}/>}`);
  await fs.writeFile(path.join(temporary, "link.tsx"), `import React from 'react';export default function Link({href,children,prefetch,...props}){return <a href={href} {...props}>{children}</a>}`);
  await fs.writeFile(path.join(temporary, "entry.tsx"), `import React from 'react';import {createRoot} from 'react-dom/client';
    import FreeSpeaking from ${modulePath(path.join(root, "src/components/speaking/free-speaking.tsx"))};
    window.__historyReady.then(()=>createRoot(document.getElementById('app')).render(<FreeSpeaking account=${JSON.stringify(account)}/>));`);
  const compiler = webpack({ mode: "development", devtool: false, context: root,
    entry: path.join(temporary, "entry.tsx"), output: { path: temporary, filename: "app.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(root, "node_modules"), "node_modules"], alias: {
      "@": path.join(root, "src"), "next/image$": path.join(temporary, "image.tsx"), "next/link$": path.join(temporary, "link.tsx") } },
    module: { rules: [{ test: /\.tsx?$/, use: path.join(temporary, "typescript.cjs") }, { test: /\.css$/, use: path.join(temporary, "css.cjs") }] } });
  try {
    await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error)
      : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  } finally { await new Promise(resolve => compiler.close(resolve)); }
  const bundle = await fs.readFile(path.join(temporary, "app.js"));
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], requests = [], checks = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.addInitScript(({ fixtures, account, oldBytes, latestBytes }) => {
    window.__historyReady = new Promise((resolve, reject) => {
      const request = indexedDB.open("lewa-free-speaking", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("sentences", { keyPath: ["account", "id"] });
        store.createIndex("account", "account");
        for (const fixture of fixtures) {
          const latest = { id: fixture.text + "-latest", createdAt: 2000,
            assessment: fixture.assessment, recording: new Blob([new Uint8Array(latestBytes)], { type: "audio/wav" }) };
          const attempts = [latest];
          if (fixture.oldAssessment) attempts.push({ id: "older-60", createdAt: 1000,
            assessment: fixture.oldAssessment, recording: new Blob([new Uint8Array(oldBytes)], { type: "audio/wav" }) });
          store.put({ account, id: fixture.text.toLowerCase(), text: fixture.text, updatedAt: 2000,
            saved: false, attempts, result: { assessment: latest.assessment, recording: latest.recording } });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
  }, { account, fixtures: fixtures.map(fixture => ({ ...fixture,
    assessment: assessment(fixture.text, fixture.score, fixture.retry),
    oldAssessment: fixture.oldScore ? assessment(fixture.text, fixture.oldScore) : null })),
  oldBytes: [...oldWav], latestBytes: [...latestWav] });
  const scorePlan = [70, 85, 75, 80, 95, "failure", 88];
  await page.route(origin + "/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript; charset=utf-8", body: bundle });
    if (url.pathname.startsWith("/illustrations/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    if (url.pathname === "/api/speaking/free/score") {
      assert.equal(route.request().method(), "POST");
      const body = route.request().postDataBuffer();
      const text = /name="text"\r\n\r\n([^\r]*)/.exec(body.toString("utf8"))?.[1];
      assert.ok(text, "The actual component sends the scoped reference text in multipart form data");
      const sentenceText = /name="sentenceText"\r\n\r\n([^\r]*)/.exec(body.toString("utf8"))?.[1];
      const startWordIndex = /name="startWordIndex"\r\n\r\n([^\r]*)/.exec(body.toString("utf8"))?.[1];
      requests.push({ text, sentenceText, startWordIndex, body });
      const score = scorePlan.shift();
      assert.notEqual(score, undefined, "Unexpected scoring request");
      return route.fulfill({ status: score === "failure" ? 422 : 200, contentType: "application/json",
        body: JSON.stringify(score === "failure" ? { title: "Fixture generic failure", recordingIssue: { code: "too_quiet" } }
          : assessment(text, score)) });
    }
    assert.equal(url.pathname, "/", "Unexpected fixture network request");
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="app"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto(origin + "/");
  const row = text => page.locator("li[data-band]").filter({ hasText: text });
  const stat = label => page.locator("dl[aria-label='Thống kê luyện nói'] dt").filter({ hasText: label }).locator("..").locator("dd");
  await page.getByRole("button", { name: "Tất cả (3)", exact: true }).waitFor();
  assert.equal((await stat("Điểm phát âm trung bình").innerText()).replace(/\s/g, ""), "65/100");
  assert.equal(await stat("Câu cần luyện lại").innerText(), "1");
  await page.getByRole("button", { name: "Cần luyện lại (1)", exact: true }).click();
  assert.equal(await row(retryText).count(), 0);
  await row(lowText).waitFor();
  await page.getByRole("button", { name: "Cần ghi âm lại (1)", exact: true }).click();
  await row(retryText).waitFor();
  assert.equal(await row(lowText).count(), 0);
  assert.equal(await row(retryText).getByText("0", { exact: true }).count(), 0);
  checks.push("Retry recordings have a separate filter and do not lower average or low-score counts");
  await page.getByRole("button", { name: "Tất cả (3)", exact: true }).click();

  await row(highText).getByRole("button", { name: "Xem chi tiết · 2 lần chấm", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const summary = dialog.locator("[aria-label='Tóm tắt kết quả phát âm']");
  const selector = dialog.getByRole("combobox", { name: "Chọn lần chấm" });
  async function assertAudio(label, bytes) {
    const audio = dialog.locator(`audio[aria-label='${label}']`);
    await page.waitForFunction(label => document.querySelector(`audio[aria-label='${label}']`)?.src.startsWith("blob:"), label);
    const actual = await audio.evaluate(async element => [...new Uint8Array(await (await fetch(element.src)).arrayBuffer())]);
    assert.deepEqual(Buffer.from(actual), bytes);
  }
  assert.match(await summary.innerText(), /90\s*\/100/);
  await assertAudio("Nghe lại bản ghi đã chấm", latestWav);
  await selector.selectOption("older-60");
  await summary.getByText("60", { exact: false }).waitFor();
  assert.match(await summary.innerText(), /60\s*\/100/);
  await assertAudio("Nghe lại bản ghi đã chấm", oldWav);
  checks.push("Selecting a previous attempt switches both its score and the exact stored WAV");

  async function uploadAndScore(bytes) {
    await dialog.locator("input[type=file]").setInputFiles({ name: "fixture.wav", mimeType: "audio/wav", buffer: bytes });
    await assertAudio("Nghe thử bản ghi", bytes);
    await dialog.getByRole("button", { name: "Chấm bằng AI", exact: true }).click();
  }
  await dialog.getByRole("button", { name: "● Ghi âm lại câu này", exact: true }).click();
  await uploadAndScore(firstWav);
  await summary.getByText("70", { exact: false }).waitFor();
  assert.equal(await selector.locator("option").count(), 3);
  await dialog.getByRole("button", { name: "● Ghi âm lại câu này", exact: true }).click();
  await uploadAndScore(secondWav);
  await summary.getByText("85", { exact: false }).waitFor();
  assert.equal(await selector.locator("option").count(), 4);
  assert.match(await dialog.getByRole("status").filter({ hasText: "So với lần chấm" }).innerText(), /70\.0 → 85\.0/);
  await assertAudio("Nghe lại bản ghi đã chấm", secondWav);
  await selector.selectOption({ index: 1 });
  await summary.getByText("70", { exact: false }).waitFor();
  await assertAudio("Nghe lại bản ghi đã chấm", firstWav);
  assert.deepEqual(requests.slice(0, 2).map(request => request.text), [highText, highText]);
  checks.push("Two successive scoring requests retain both results, recordings, and their comparison");
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();

  await row(lowText).getByRole("button", { name: "Xem chi tiết · 1 lần chấm", exact: true }).click();
  await dialog.getByRole("button", { name: "Luyện “playing” theo từ → cụm → câu", exact: true }).click();
  await dialog.getByRole("heading", { name: "playing", exact: true }).waitFor();
  await uploadAndScore(firstWav);
  await dialog.getByRole("button", { name: "Tiếp: Cụm ngắn →", exact: true }).click();
  await dialog.getByRole("heading", { name: "She enjoys playing badminton with", exact: true }).waitFor();
  await uploadAndScore(secondWav);
  await dialog.getByRole("button", { name: "Tiếp: Cả câu →", exact: true }).click();
  await dialog.getByRole("heading", { name: lowText, exact: true }).waitFor();
  await uploadAndScore(firstWav);
  await summary.getByText("95", { exact: false }).waitFor();
  assert.deepEqual(requests.slice(2, 5).map(({ text, sentenceText, startWordIndex }) => ({ text, sentenceText, startWordIndex })), [
    { text: "playing", sentenceText: lowText, startWordIndex: "2" },
    { text: "She enjoys playing badminton with", sentenceText: lowText, startWordIndex: "0" },
    { text: lowText, sentenceText: undefined, startWordIndex: undefined },
  ]);
  checks.push("Targeted practice sends each scope with the source sentence and word position needed for pronunciation context");
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();

  await page.getByRole("button", { name: "Tạo câu & thực hành ngay", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Câu tiếng Anh bạn muốn luyện" }).fill(newText);
  await dialog.getByRole("button", { name: "Luyện nói", exact: true }).click();
  await dialog.getByRole("heading", { name: newText, exact: true }).waitFor();
  await uploadAndScore(failureWav);
  await dialog.getByRole("alert").getByText("Âm thanh quá nhỏ hoặc gần như im lặng. Kiểm tra microphone và mức thu, rồi ghi âm lại.", { exact: true }).waitFor();
  await assertAudio("Nghe thử bản ghi", failureWav);
  assert.equal(await dialog.getByRole("button", { name: "Chấm bằng AI", exact: true }).isEnabled(), true);
  await dialog.getByRole("button", { name: "Chấm bằng AI", exact: true }).click();
  await summary.getByText("88", { exact: false }).waitFor();
  assert.deepEqual(requests.slice(5).map(request => request.text), [newText, newText]);
  assert.ok(requests[5].body.includes(failureWav) && requests[6].body.includes(failureWav));
  checks.push("Failed scoring shows diagnostic advice and preserves the WAV for resubmission");
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.reload();
  await row(highText).getByRole("button", { name: "Xem chi tiết · 4 lần chấm", exact: true }).waitFor();
  await row(newText).getByRole("button", { name: "Xem chi tiết · 1 lần chấm", exact: true }).waitFor();
  const contextRows = await page.evaluate(account => new Promise((resolve, reject) => {
    const request = indexedDB.open("lewa-free-speaking", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction("sentences").objectStore("sentences").index("account").getAll(account);
      read.onerror = () => { database.close(); reject(read.error); };
      read.onsuccess = () => {
        resolve(read.result.filter(sentence => sentence.context).map(({ text, context, attempts }) => ({ text, context, attempts: attempts.length })));
        database.close();
      };
    };
  }), account);
  assert.deepEqual(contextRows.sort((a, b) => a.context.startWordIndex - b.context.startWordIndex), [
    { text: "She enjoys playing badminton with", context: { sentenceText: lowText, startWordIndex: 0 }, attempts: 1 },
    { text: "playing", context: { sentenceText: lowText, startWordIndex: 2 }, attempts: 1 },
  ]);
  assert.equal(scorePlan.length, 0);
  assert.deepEqual(errors, []);
  checks.push("Only successful scoring results persist in isolated IndexedDB after reload");
  console.log(JSON.stringify({ passed: true, checks,
    scoringRequests: requests.map(({ text, sentenceText, startWordIndex }) => ({ text, sentenceText, startWordIndex })) }));
} finally {
  await browser?.close();
  for (const [key, value] of Object.entries(originalTemp)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const resolved = path.resolve(temporary);
  if (!resolved.startsWith(reports + path.sep) || !path.basename(resolved).startsWith("speaking-ui-fixture-")) throw new Error("Unsafe fixture cleanup path");
  await fs.rm(resolved, { recursive: true, force: true });
}
