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
const deck = { deckId: 1, title: "Từ vựng công nghệ", description: "Ôn từ cùng mèo học tập", cardCount: 2, dueCount: 2, canEdit: true, isAdminDeck: false, recallCount: 0 };
const cards = [{ cardId: 10, deckId: 1, frontText: "operating system", backText: "Hệ điều hành\nPhần mềm quản lý phần cứng và cung cấp các dịch vụ cơ bản.",
  exampleSentence: "Windows is a popular operating system.", intervalDays: 0, repetition: 0, nextReviewAt: null, updatedAt: "2026-11-07T00:00:00Z", isDue: true },
{ cardId: 11, deckId: 1, frontText: "opportunity", backText: "Cơ hội", exampleSentence: null, intervalDays: 0, repetition: 0, nextReviewAt: null, updatedAt: "2026-11-07T00:00:00Z", isDue: true }];
const travel = { ...deck, deckId: 2, title: "Từ vựng du lịch", cardCount: 1, dueCount: 1, recallCount: 1 };
const shared = { ...deck, deckId: 3, title: "Từ vựng admin", cardCount: 1, dueCount: 0, canEdit: false, isAdminDeck: true };
const decks = [deck, travel, shared];
const courseData = {
  vocabulary: { courseId: 1, courseTitle: "Từ vựng trong khóa học", readingDecks: [
    { lessonId: 9, title: "Reading technology", difficultyLevel: "B1", contentVersion: "a".repeat(64), cards },
  ] },
  decks: [{ ...deck, courseId: 1, courseTitle: "Từ vựng trong khóa học" }],
};
const cardsByDeck = new Map([
  [1, cards],
  [2, [{ ...cards[1], deckId: 2, cardId: 20, frontText: "passport", backText: "Hộ chiếu", nextReviewAt: "2026-11-08T00:00:00Z", repetition: 1, intervalDays: 1 }]],
  [3, [{ ...cards[1], deckId: 3, cardId: 30, frontText: "library", backText: "Thư viện", isDue: false }]],
]);
function summarize(deck) {
  const cards = cardsByDeck.get(deck.deckId);
  return { ...deck, dueCount: cards.filter(card => card.isDue).length, recallCount: cards.filter(card => card.repetition > 0).length };
}
const bookmarkTargets = {
  "course/21": { title: "Tiếng Anh du lịch" },
  "lesson/101": { title: "Phát âm đuôi ed", parentTitle: "Tiếng Anh du lịch", parentId: 21, skillType: "speaking" },
  "lesson/102": { title: "Thông báo ở sân bay", parentTitle: "Tiếng Anh du lịch", parentId: 21, skillType: "listening" },
  "writing/7": { title: "Email đặt phòng" },
  "flashcard/10": { title: cards[0].frontText, parentTitle: deck.title, parentId: deck.deckId },
};
const localSentence = { account: "42:fixture", id: "how does this work?", text: "How does this work?", saved: true, updatedAt: Date.parse("2026-11-16T00:00:00Z") };
function bookmark(key, note = null) {
  const [targetType, id] = key.split("/");
  return { targetType, targetId: Number(id), createdAt: "2026-11-16T12:00:00Z", target: bookmarkTargets[key], note };
}
const bookmarks = new Map(Object.keys(bookmarkTargets).filter(key => !key.startsWith("flashcard")).map(key => [key, bookmark(key)]));
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
  await fs.writeFile(path.join(temporary, "navigation.ts"), `export const useRouter = () => ({ replace() {} });`);
  await fs.writeFile(path.join(temporary, "entry.tsx"), `import React from 'react';import {createRoot} from 'react-dom/client';
    import Workspace from ${modulePath(path.join(root, "src/app/flashcards/workspace.tsx"))};
    import CourseFlashcards from ${modulePath(path.join(root, "src/components/courses/course-flashcards.tsx"))};
    import BookmarkList from ${modulePath(path.join(root, "src/app/bookmarks/bookmark-list.tsx"))};
    import { BookmarkProvider } from ${modulePath(path.join(root, "src/components/bookmarks/bookmark-provider.tsx"))};
    import bookmarkStyles from ${modulePath(path.join(root, "src/app/bookmarks/bookmarks.module.css"))};
    window.__preferencesReady.then(()=>createRoot(document.getElementById('app')).render(<BookmarkProvider>
      {location.pathname === '/bookmarks' ? <main className={bookmarkStyles.page}><BookmarkList account="42:fixture"/></main>
        : location.pathname === '/course-flashcards' ? <CourseFlashcards data={${JSON.stringify(courseData)}} account="42:fixture" isAdmin={false}/>
        : <Workspace initialDecks={${JSON.stringify(decks)}} initialDetail={null} linkedCardId={null} account="42:fixture" isAdmin={false}/>}
    </BookmarkProvider>));`);
  const compiler = webpack({ mode: "development", devtool: false, context: root, entry: path.join(temporary, "entry.tsx"), output: { path: temporary, filename: "app.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(root, "node_modules"), "node_modules"], alias: {
      "@": path.join(root, "src"), "next/image$": path.join(temporary, "image.tsx"), "next/link$": path.join(temporary, "link.tsx"), "next/navigation$": path.join(temporary, "navigation.ts") } },
    module: { rules: [{ test: /\.tsx?$/, use: path.join(temporary, "typescript.cjs") }, { test: /\.css$/, use: path.join(temporary, "css.cjs") }] } });
  try { await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : resolve())); }
  finally { await new Promise(resolve => compiler.close(resolve)); }
  const bundle = await fs.readFile(path.join(temporary, "app.js"));
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = []; page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  let failReview = true, failNote = false;
  const mutations = [];
  const bookmarkMutations = [];
  await page.addInitScript(sentence => {
    window.__spoken = [];
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() {}, speak(utterance) { window.__spoken.push(utterance.text); } } });
    const preferencesReady = new Promise((resolve, reject) => {
      const request = indexedDB.open("lewa-flashcards", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("preferences");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("preferences", "readwrite");
        transaction.objectStore("preferences").put({ level: "B1", image: "", phonetic: "/ˈɒpəreɪtɪŋ ˈsɪstəm/" }, "42:fixture:deck:1:10");
        transaction.oncomplete = () => { request.result.close(); resolve(); };
      };
    });
    const sentencesReady = new Promise((resolve, reject) => {
      const request = indexedDB.open("lewa-free-speaking", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("sentences", { keyPath: ["account", "id"] });
        store.createIndex("account", "account");
        store.put(sentence);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    window.__preferencesReady = Promise.all([preferencesReady, sentencesReady]);
  }, localSentence);
  await page.route("http://flashcards.fixture/**", async route => {
    const url = new URL(route.request().url());
    const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript; charset=utf-8", body: bundle });
    if (url.pathname.startsWith("/illustrations/")) return route.fulfill({ contentType: url.pathname.endsWith(".svg") ? "image/svg+xml" : "image/webp", body: await fs.readFile(path.join(root, "public", url.pathname)) });
    if (url.pathname === "/api/bookmarks") return json([...bookmarks.values()]);
    if (url.pathname.startsWith("/api/bookmarks/")) {
      const key = url.pathname.slice("/api/bookmarks/".length);
      const method = route.request().method();
      const data = route.request().postDataJSON();
      bookmarkMutations.push({ key, method, data });
      if (method === "DELETE") {
        bookmarks.delete(key);
        return route.fulfill({ status: 204 });
      }
      if (method === "PATCH") {
        if (failNote) return json({ title: "Bookmark note unavailable" }, 503);
        bookmarks.get(key).note = data.note;
        return route.fulfill({ status: 204 });
      }
      if (!bookmarkTargets[key]) return json({}, 404);
      if (!bookmarks.has(key)) bookmarks.set(key, bookmark(key, data?.note));
      return json(bookmarks.get(key));
    }
    if (url.pathname === "/api/flashcards/decks") return json(decks.map(summarize));
    const deckMatch = /^\/api\/flashcards\/decks\/(\d+)$/.exec(url.pathname);
    if (deckMatch && route.request().method() === "GET") {
      const match = decks.find(deck => deck.deckId === Number(deckMatch[1]));
      return json({ deck: summarize(match), cards: cardsByDeck.get(match.deckId) });
    }
    if (url.pathname === "/api/flashcards/review/due") {
      return json([travel, deck].flatMap(deck => cardsByDeck.get(deck.deckId).filter(card => card.isDue).map(card => ({ card, deckTitle: deck.title }))));
    }
    if (url.pathname.startsWith("/api/flashcards/") && route.request().method() !== "GET") {
      const body = route.request().postDataJSON();
      mutations.push({ path: url.pathname, body });
      const reviewMatch = /^\/api\/flashcards\/cards\/(\d+)\/review$/.exec(url.pathname);
      if (!reviewMatch) return json({ title: "Unexpected mutation" }, 404);
      if (failReview) return json({ title: "Chưa lưu được đánh giá." }, 503);
      const card = [...cardsByDeck.values()].flat().find(card => card.cardId === Number(reviewMatch[1]));
      Object.assign(card, { isDue: false, repetition: body.rating === 0 ? 0 : card.repetition + 1, intervalDays: body.rating === 0 ? 0 : 1, nextReviewAt: "2026-11-18T00:00:00Z" });
      return json(card);
    }
    if (url.pathname === "/api/vocabulary") return route.fulfill({ contentType: "application/json", body: '{"entries":[]}' });
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif;background:#f1f2ff}button,input{font:inherit}</style></head><body><div id="app"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://flashcards.fixture/");
  await page.getByRole("button", { name: /Từ vựng công nghệ.*2 từ/ }).click({ timeout: 10000 }).catch(async error => {
    console.error(await page.locator("body").innerText()); throw error;
  });
  await page.getByRole("button", { name: "Ôn thẻ đến hạn", exact: true }).click();
  const study = page.getByRole("region", { name: "Ôn tập thẻ" });
  const flip = page.getByRole("button", { name: "Bấm để lật thẻ và xem nghĩa.", exact: true });
  const previous = study.getByRole("button", { name: "Thẻ trước", exact: true });
  const next = study.getByRole("button", { name: "Thẻ tiếp", exact: true });
  await flip.waitFor();
  assert.equal(await previous.isDisabled(), true);
  await next.click();
  await study.getByText("opportunity", { exact: true }).waitFor();
  await study.getByText("Thẻ 2 / 2", { exact: true }).waitFor();
  assert.equal(await next.isDisabled(), true);
  assert.equal(await flip.getAttribute("aria-pressed"), "false");
  await previous.click();
  await study.getByText("operating system", { exact: true }).waitFor();
  assert.equal(mutations.length, 0);
  await study.getByRole("button", { name: "Dấu trang cho thẻ đang ôn" }).click();
  await study.getByText("Đã đánh dấu", { exact: true }).waitFor();
  assert.equal(bookmarks.get("flashcard/10").target.parentId, deck.deckId);
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
  assert.ok((await study.innerText()).includes("1 / 2 thẻ")); assert.equal(mutations.length, 2);
  await previous.click();
  await study.getByText("Bạn đã chọn Nhớ.", { exact: true }).waitFor();
  await flip.click();
  assert.equal(await study.getByRole("group", { name: "Tự đánh giá mức ghi nhớ" }).count(), 0);
  await next.click();
  await study.getByText("opportunity", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Xem mặt sau", exact: true }).click();
  await study.getByText("Chưa chọn", { exact: true }).waitFor();
  await study.getByText("Thẻ này chưa có câu ví dụ.", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.equal(await page.getByRole("button", { name: "Xem mặt trước", exact: true }).isVisible(), true);
  if (process.env.FLASHCARDS_SCREENSHOT_DIR) await study.screenshot({ path: `${process.env.FLASHCARDS_SCREENSHOT_DIR}/flashcards-study-mobile.png` });
  await page.getByRole("button", { name: "Xem mặt trước", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Bấm để lật thẻ và xem nghĩa.", exact: true }).getAttribute("aria-pressed"), "false");

  await study.getByRole("button", { name: "Về bộ thẻ", exact: true }).click();
  await page.getByRole("button", { name: "Ôn thẻ đến hạn", exact: true }).click();
  await study.getByText("Phiên này có 1 thẻ đến hạn.", { exact: true }).waitFor();
  assert.equal(await previous.isDisabled(), true);
  assert.equal(await next.isDisabled(), true);
  await study.getByRole("button", { name: "Ôn tất cả thẻ", exact: true }).click();
  await study.getByText("operating system", { exact: true }).waitFor();
  await study.getByText("Thẻ 1 / 2", { exact: true }).waitFor();
  await flip.click();
  await study.getByRole("button", { name: "Nhớ", exact: true }).click();
  await study.getByText("opportunity", { exact: true }).waitFor();
  assert.equal(mutations.length, 2);

  await study.getByRole("button", { name: "Về bộ thẻ", exact: true }).click();
  await page.getByRole("navigation", { name: "Đường dẫn trang" }).getByRole("button", { name: "Flashcards", exact: true }).click();
  await page.getByRole("button", { name: "Ôn hôm nay", exact: true }).click();
  await study.getByText(travel.title, { exact: true }).waitFor();
  await study.getByRole("button", { name: "Việt → Anh", exact: true }).click();
  await study.getByText("Hộ chiếu", { exact: true }).waitFor();
  assert.equal(await study.getByText("passport", { exact: true }).count(), 0);
  assert.equal(await study.getByRole("button", { name: "Nghe từ vựng", exact: true }).count(), 0);
  await study.getByRole("checkbox", { name: "Gõ đáp án trước khi lật" }).check();
  const answer = study.getByRole("textbox", { name: "Câu trả lời của bạn" });
  await answer.fill("passporte");
  await answer.press("Enter");
  await study.getByText("passport", { exact: true }).waitFor();
  await study.getByText("passporte", { exact: true }).waitFor();
  const hard = study.getByRole("button", { name: "Khó Lên lịch lần tới", exact: true });
  failReview = true;
  await hard.click();
  await study.getByRole("alert").getByText("Chưa lưu được đánh giá.").waitFor();
  assert.ok(await study.getByText("passporte", { exact: true }).isVisible());
  assert.ok(await study.getByText("Đã đánh giá 0 / 2 thẻ", { exact: true }).isVisible());
  failReview = false;
  await next.click();
  await study.getByText(deck.title, { exact: true }).waitFor();
  await study.getByText("Cơ hội", { exact: true }).waitFor();
  assert.equal(await answer.inputValue(), "");
  assert.equal(await study.getByRole("alert").count(), 0);
  await study.getByRole("button", { name: "Xem đáp án", exact: true }).click();
  await study.getByRole("button", { name: "Quên Ôn lại sau 5 phút", exact: true }).click();
  await study.getByText("Hộ chiếu", { exact: true }).waitFor();
  assert.deepEqual(mutations.at(-1), { path: "/api/flashcards/cards/11/review", body: { rating: 0, expectedUpdatedAt: cards[1].updatedAt } });
  await answer.fill("passport");
  await answer.press("Enter");
  await hard.click();
  await study.getByText("Đã lưu đánh giá cho 2 thẻ.").waitFor();
  assert.deepEqual(mutations.at(-1), { path: "/api/flashcards/cards/20/review", body: { rating: 1, expectedUpdatedAt: cards[1].updatedAt } });
  await study.getByRole("button", { name: "Ôn tiếp", exact: true }).click();
  await study.getByText("Chưa có thẻ đến hạn").waitFor();
  await study.getByRole("button", { name: "Về thư viện", exact: true }).click();
  await page.getByRole("button", { name: "Có thẻ đến hạn (0)", exact: true }).waitFor();
  await page.getByRole("button", { name: /Từ vựng du lịch.*1\/1 thẻ có chuỗi nhớ/ }).waitFor();
  assert.equal(await page.getByText("Đã hoàn thành", { exact: true }).count(), 0);

  const mutationCount = mutations.length;
  await page.getByRole("button", { name: /Từ vựng admin.*Chỉ đọc/ }).click();
  assert.equal(await page.getByRole("button", { name: "Sửa bộ", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Tạo bản sao để ôn", exact: true }).waitFor();
  await page.getByRole("button", { name: "Ôn thử", exact: true }).click();
  await flip.click();
  await study.getByRole("button", { name: "Dễ", exact: true }).click();
  const results = study.getByRole("list", { name: "Kết quả tự đánh giá" });
  assert.match(await results.getByRole("listitem").filter({ hasText: "Dễ" }).innerText(), /Dễ\s+1/);
  await study.getByRole("button", { name: "Ôn thử lại", exact: true }).click();
  await study.getByText("Đã đánh giá 0 / 1 thẻ", { exact: true }).waitFor();
  assert.equal(mutations.length, mutationCount);

  await page.goto("http://flashcards.fixture/bookmarks");
  const saved = page.getByRole("region", { name: "Nội dung đã lưu" });
  const search = saved.getByRole("searchbox", { name: "Tìm dấu trang" });
  const row = title => saved.getByRole("listitem").filter({ has: page.getByRole("link", { name: title, exact: true }) });
  await saved.getByText("6 dấu trang", { exact: true }).waitFor();
  await saved.getByRole("button", { name: "Luyện nói", exact: true }).click();
  await saved.getByText("2 / 6 dấu trang", { exact: true }).waitFor();
  await search.fill("DU LICH duoi");
  await saved.getByText("1 / 6 dấu trang", { exact: true }).waitFor();
  assert.equal(await row("Phát âm đuôi ed").getByRole("link", { name: "Luyện lại Phát âm đuôi ed" }).getAttribute("href"), "/courses/21/speaking/101");
  await search.fill("không có kết quả");
  await saved.getByRole("button", { name: "Xóa bộ lọc", exact: true }).click();
  assert.equal(await row("Email đặt phòng").getByRole("link", { name: "Xem bài viết Email đặt phòng" }).getAttribute("href"), "/writing?submissionId=7");
  assert.equal(await row(cards[0].frontText).getByRole("link", { name: "Mở thẻ " + cards[0].frontText }).getAttribute("href"), "/flashcards?deckId=1&cardId=10");

  const serverRow = row("Phát âm đuôi ed");
  const personalNote = "Luyện lại âm cuối trong worked.";
  await serverRow.getByRole("button", { name: /Thêm ghi chú/ }).click();
  const noteField = serverRow.getByRole("textbox", { name: /Ghi chú cá nhân/ });
  await noteField.fill(personalNote);
  failNote = true;
  await serverRow.getByRole("button", { name: "Lưu ghi chú", exact: true }).click();
  await serverRow.getByRole("alert").waitFor();
  assert.equal(await noteField.inputValue(), personalNote);
  failNote = false;
  await serverRow.getByRole("button", { name: "Lưu ghi chú", exact: true }).click();
  await serverRow.getByText(personalNote, { exact: true }).waitFor();
  await search.fill("luyen lai am cuoi");
  await saved.getByText("1 / 6 dấu trang", { exact: true }).waitFor();
  await serverRow.getByRole("button", { name: /Bỏ lưu/ }).click();
  const undo = page.getByRole("button", { name: "Hoàn tác", exact: true });
  await serverRow.waitFor({ state: "hidden" });
  await undo.click();
  await serverRow.getByText(personalNote, { exact: true }).waitFor();
  assert.deepEqual(bookmarkMutations.at(-1), { key: "lesson/101", method: "PUT", data: { note: personalNote } });
  await search.clear();

  const localRow = row(localSentence.text);
  const localNote = "Đọc chậm phần cuối câu.";
  const beforeLocal = bookmarkMutations.length;
  await localRow.getByText("Trên thiết bị này", { exact: true }).waitFor();
  await localRow.getByRole("button", { name: /Thêm ghi chú/ }).click();
  await localRow.getByRole("textbox", { name: /Ghi chú cá nhân/ }).fill(localNote);
  await localRow.getByRole("button", { name: "Lưu ghi chú", exact: true }).click();
  await localRow.getByText(localNote, { exact: true }).waitFor();
  await localRow.getByRole("button", { name: /Bỏ lưu/ }).click();
  await localRow.waitFor({ state: "hidden" });
  await undo.click();
  await localRow.getByText(localNote, { exact: true }).waitFor();
  await page.reload();
  await localRow.getByText(localNote, { exact: true }).waitFor();
  await serverRow.getByText(personalNote, { exact: true }).waitFor();
  assert.equal(bookmarkMutations.length, beforeLocal);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  if (process.env.FLASHCARDS_SCREENSHOT_DIR) await saved.screenshot({ path: `${process.env.FLASHCARDS_SCREENSHOT_DIR}/bookmarks-mobile.png` });
  await page.clock.install();
  await localRow.getByRole("button", { name: /Bỏ lưu/ }).click();
  await undo.waitFor();
  await page.clock.fastForward(8100);
  await undo.waitFor({ state: "hidden" });
  await saved.getByText("5 dấu trang", { exact: true }).waitFor();
  await page.goto("http://flashcards.fixture/course-flashcards");
  await page.getByRole("button", { name: "Xem thẻ", exact: true }).click();
  const reading = page.getByRole("region", { name: "Xem trước bộ thẻ Reading" });
  const readingFlip = reading.getByRole("button", { name: "Nhấn đúp để lật thẻ và xem nghĩa.", exact: true });
  await readingFlip.click();
  assert.equal(await readingFlip.getAttribute("aria-pressed"), "false");
  await readingFlip.dblclick();
  await reading.getByText("B1", { exact: true }).waitFor();
  await reading.getByRole("button", { name: "Thẻ tiếp", exact: true }).click();
  await reading.getByText("opportunity", { exact: true }).waitFor();
  const beforeCourseReview = mutations.length;
  await page.getByRole("button", { name: "Mở bộ thẻ & ôn tập", exact: true }).click();
  await page.getByRole("button", { name: "Ôn tất cả thẻ", exact: true }).click();
  await study.getByText("operating system", { exact: true }).waitFor();
  await study.getByRole("button", { name: "Thẻ tiếp", exact: true }).click();
  await study.getByText("opportunity", { exact: true }).waitFor();
  assert.equal(mutations.length, beforeCourseReview);
  await page.getByRole("button", { name: /← Bộ thẻ khóa học/ }).click();
  await page.getByRole("heading", { name: "Từ vựng & Flashcards", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ["front and back layout", "Enter flips", "saved CEFR", "missing CEFR", "audio does not flip", "example highlighting", "previous and next work without rating", "rated cards can be revisited", "failed review preserved", "successful review advances", "out-of-order ratings save the selected card and return to skipped cards", "all-card practice leaves the review schedule intact", "mobile fits viewport", "daily review crosses decks", "reverse hides English", "optional answer survives failure and stays local", "due counts refresh", "admin preview never writes a review", "bookmark during review", "bookmark filters and search without accents", "deep links by type", "note survives failed save", "undo restores both kinds of notes", "notes survive reload"] }));
} finally {
  await browser?.close();
  const resolved = path.resolve(temporary);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("englishlearning-flashcards-study-")) throw new Error("Unsafe cleanup path");
  await fs.rm(resolved, { recursive: true, force: true });
}
