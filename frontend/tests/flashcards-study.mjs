import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { webpack } = require("next/dist/compiled/webpack/webpack");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "englishlearning-flashcards-study-"));
const modulePath = value => JSON.stringify(value.replaceAll("\\", "/"));
const deck = { deckId: 1, title: "Từ vựng công nghệ", description: "Ôn từ cùng mèo học tập", cardCount: 2, dueCount: 2, canEdit: true, isAdminDeck: false };
const cards = [{ cardId: 10, deckId: 1, frontText: "operating system", backText: "Hệ điều hành\nPhần mềm quản lý phần cứng và cung cấp các dịch vụ cơ bản.",
  exampleSentence: "Windows is a popular operating system.", intervalDays: 0, repetition: 0, nextReviewAt: null, updatedAt: "2026-11-07T00:00:00Z", isDue: true },
{ cardId: 11, deckId: 1, frontText: "opportunity", backText: "Cơ hội", exampleSentence: null, intervalDays: 0, repetition: 0, nextReviewAt: null, updatedAt: "2026-11-07T00:00:00Z", isDue: true }];
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
let browser;
try {
  await fs.writeFile(path.join(temporary, "typescript.cjs"), `module.exports = source => require(${modulePath(path.join(root, "node_modules/typescript"))}).transpileModule(source,{compilerOptions:{target:7,module:99,jsx:4,esModuleInterop:true}}).outputText;`);
  await fs.writeFile(path.join(temporary, "css.cjs"), `module.exports = function(source) {
    const prefix='f_'+require('node:crypto').createHash('sha256').update(this.resourcePath).digest('hex').slice(0,8)+'_';
    const classes={}; const css=source.replace(/\\.([A-Za-z_][\\w-]*)/g,(_,name)=>{classes[name]=prefix+name;return '.'+prefix+name});
    return 'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.appendChild(style);module.exports='+JSON.stringify(classes)+';';
  };`);
  await fs.writeFile(path.join(temporary, "image.tsx"), `import React from 'react';export default function Image({src,alt,unoptimized,fill,priority,...props}){return <img src={src} alt={alt} {...props}/>}`);
  await fs.writeFile(path.join(temporary, "link.tsx"), `import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`);
  await fs.writeFile(path.join(temporary, "entry.tsx"), `import React from 'react';import {createRoot} from 'react-dom/client';
    import Workspace from ${modulePath(path.join(root, "src/app/flashcards/workspace.tsx"))};
    window.__preferencesReady.then(()=>createRoot(document.getElementById('app')).render(<Workspace initialDecks={[${JSON.stringify(deck)}]} account="42:fixture" isAdmin={false}/>));`);
  const compiler = webpack({ mode: "development", devtool: false, context: root, entry: path.join(temporary, "entry.tsx"), output: { path: temporary, filename: "app.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(root, "node_modules"), "node_modules"], alias: {
      "@": path.join(root, "src"), "next/image$": path.join(temporary, "image.tsx"), "next/link$": path.join(temporary, "link.tsx") } },
    module: { rules: [{ test: /\.tsx?$/, use: path.join(temporary, "typescript.cjs") }, { test: /\.css$/, use: path.join(temporary, "css.cjs") }] } });
  try { await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : resolve())); }
  finally { await new Promise(resolve => compiler.close(resolve)); }
  const bundle = await fs.readFile(path.join(temporary, "app.js"));
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = []; page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  let failReview = true, reviews = 0;
  await page.addInitScript(() => {
    window.__spoken = [];
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() {}, speak(utterance) { window.__spoken.push(utterance.text); } } });
    window.__preferencesReady = new Promise((resolve, reject) => {
      const request = indexedDB.open("lewa-flashcards", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("preferences");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("preferences", "readwrite");
        transaction.objectStore("preferences").put({ level: "B1", image: "", phonetic: "/ˈɒpəreɪtɪŋ ˈsɪstəm/" }, "42:fixture:deck:1:10");
        transaction.oncomplete = () => { request.result.close(); resolve(); };
      };
    });
  });
  await page.route("http://flashcards.fixture/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript; charset=utf-8", body: bundle });
    if (url.pathname.startsWith("/illustrations/")) return route.fulfill({ contentType: url.pathname.endsWith(".svg") ? "image/svg+xml" : "image/webp", body: await fs.readFile(path.join(root, "public", url.pathname)) });
    if (url.pathname === "/api/flashcards/decks/1") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ deck, cards }) });
    if (url.pathname.endsWith("/review")) {
      reviews++;
      if (failReview) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ title: "Chưa lưu được đánh giá." }) });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...cards[0], isDue: false, repetition: 1, intervalDays: 1 }) });
    }
    if (url.pathname === "/api/vocabulary") return route.fulfill({ contentType: "application/json", body: '{"entries":[]}' });
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif;background:#f1f2ff}button,input{font:inherit}</style></head><body><div id="app"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://flashcards.fixture/");
  await page.getByRole("button", { name: /Từ vựng công nghệ.*2 từ/ }).click({ timeout: 10000 }).catch(async error => {
    console.error(await page.locator("body").innerText()); throw error;
  });
  await page.getByRole("button", { name: "Ôn thẻ đến lịch", exact: true }).click();
  const study = page.getByRole("region", { name: "Ôn tập thẻ" });
  const flip = page.getByRole("button", { name: "Bấm để lật thẻ và xem nghĩa.", exact: true });
  await flip.waitFor();
  await study.getByText("/ˈɒpəreɪtɪŋ ˈsɪstəm/", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Nghe từ vựng", exact: true }).click();
  assert.equal(await flip.getAttribute("aria-pressed"), "false");
  assert.equal(await page.evaluate(() => window.__spoken[0]), "operating system");
  if (process.env.FLASHCARDS_SCREENSHOT_DIR) await study.screenshot({ path: `${process.env.FLASHCARDS_SCREENSHOT_DIR}/flashcards-study-front.png` });
  await flip.focus(); await page.keyboard.press("Enter");
  await study.getByText("B1", { exact: true }).waitFor();
  assert.ok((await study.innerText()).includes("CEFR"));
  assert.equal(await study.getByText(/Lĩnh vực/).count(), 0);
  assert.equal(await study.locator("mark").innerText(), "operating system");
  await page.getByRole("button", { name: "Nghe câu ví dụ", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__spoken.at(-1)), "Windows is a popular operating system.");
  assert.equal(await page.getByRole("button", { name: "Đang xem nghĩa. Bấm để xem từ.", exact: true }).getAttribute("aria-pressed"), "true");
  if (process.env.FLASHCARDS_SCREENSHOT_DIR) await study.screenshot({ path: `${process.env.FLASHCARDS_SCREENSHOT_DIR}/flashcards-study-back.png` });
  await page.getByRole("button", { name: "Nhớ Lên lịch lần tới", exact: true }).click();
  await page.getByRole("alert").getByText("Chưa lưu được đánh giá.", { exact: true }).waitFor();
  assert.ok((await study.innerText()).includes("0 / 2 thẻ"));
  failReview = false;
  await page.getByRole("button", { name: "Nhớ Lên lịch lần tới", exact: true }).click();
  await study.getByText("opportunity", { exact: true }).waitFor();
  assert.ok((await study.innerText()).includes("1 / 2 thẻ")); assert.equal(reviews, 2);
  await page.getByRole("button", { name: "Xem mặt sau", exact: true }).click();
  await study.getByText("Chưa chọn", { exact: true }).waitFor();
  await study.getByText("Thẻ này chưa có câu ví dụ.", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.equal(await page.getByRole("button", { name: "Xem mặt trước", exact: true }).isVisible(), true);
  if (process.env.FLASHCARDS_SCREENSHOT_DIR) await study.screenshot({ path: `${process.env.FLASHCARDS_SCREENSHOT_DIR}/flashcards-study-mobile.png` });
  await page.getByRole("button", { name: "Xem mặt trước", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Bấm để lật thẻ và xem nghĩa.", exact: true }).getAttribute("aria-pressed"), "false");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ["front and back layout", "Enter flips", "saved CEFR", "missing CEFR", "audio does not flip", "example highlighting", "failed review preserved", "successful review advances", "mobile fits viewport"] }));
} finally {
  await browser?.close();
  const resolved = path.resolve(temporary);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("englishlearning-flashcards-study-")) throw new Error("Unsafe cleanup path");
  await fs.rm(resolved, { recursive: true, force: true });
}
