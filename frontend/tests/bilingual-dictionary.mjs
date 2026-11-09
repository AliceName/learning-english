import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const base = process.env.VOCABULARY_TEST_BASE_URL ?? "http://localhost:3000";
const directions = [];
const prepared = [];
let prepareFailure = false;
const errors = [];
const firstId = "a".repeat(64), secondId = "b".repeat(64);
const key = "c".repeat(64);
const bytes = Buffer.alloc(128, 1);
await context.addInitScript(() => {
  window.__dictionaryPlayback = [];
  window.__dictionaryLiveUrls = new Set();
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = create(blob); window.__dictionaryLiveUrls.add(url); return url; };
  URL.revokeObjectURL = url => { window.__dictionaryLiveUrls.delete(url); revoke(url); };
  HTMLMediaElement.prototype.play = async function () { window.__dictionaryPlayback.push(this.src); };
  HTMLMediaElement.prototype.pause = function () {};
  Object.defineProperty(HTMLMediaElement.prototype, "src", { configurable: true,
    get() { return this.__dictionaryMockSrc ?? ""; }, set(value) { this.__dictionaryMockSrc = value; } });
});
await context.route("**/api/auth/me", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ userId: 1 }) }));
await context.route("**/api/vocabulary?*", async route => {
  const query = new URL(route.request().url()).searchParams;
  const direction = query.get("direction"), word = query.get("word");
  directions.push({ direction, word });
  if (word === "older") await new Promise(resolve => setTimeout(resolve, 500));
  const meanings = direction === "en-vi" ? ["Sách.", "Sổ sách kế toán."] : direction === "vi-en" ? ["a student"] : ["A greeting."];
  const phonetic = direction === "vi-en" ? "[học-sinh-fallback]" : direction === "en-vi" ? "/hə.ˈloʊ̯/" : "/english-ipa/";
  const phonetics = direction === "vi-en" ? [
    { text: "[học-sinh-hanoi]", region: "Hà-Nội", audio: null, sourceUrl: null, license: null },
    { text: "[học-sinh-hue]", region: "Huế", audio: null, sourceUrl: null, license: null },
  ] : direction === "en-vi" ? ["/hə.ˈloʊ̯/", "həˈloʊ̯", "/hə.ˈləʊ̯/", "/hɛ.ˈloʊ̯/", "/hɛ.ˈləʊ̯/"].map(text =>
    ({ text, region: null, audio: null, sourceUrl: null, license: null })) : [{ text: "/english-ipa/", region: "US", audio: null, sourceUrl: null, license: null }];
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({ word, direction, language: direction === "vi-en" ? "vi" : "en",
    provider: direction === "en-en" ? "dictionaryApi" : "minhqnd", source: "mongodb", isPersisted: true, fetchedAtUtc: new Date().toISOString(),
    entries: [{ word, phonetic, origin: null, phonetics, license: null, sourceUrls: ["https://dict.minhqnd.com/"],
      meanings: [{ partOfSpeech: "Danh từ", synonyms: [], antonyms: [], definitions: meanings.map((definition, index) => ({ definition,
        example: null, synonyms: [], antonyms: [], definitionId: index ? secondId : firstId,
        definitionAudio: { canPrepare: direction === "en-vi", language: "vi", reason: null } })) }] }] }) }).catch(() => {});
});
await context.route("**/api/vocabulary/definition-audio/prepare", async route => {
  const selection = route.request().postDataJSON(); prepared.push(selection);
  if (prepareFailure) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ title: "Nguồn giọng đọc đang bận." }) });
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "ready", definitionId: selection.definitionId,
    audioKey: key, playbackUrl: `/api/vocabulary/definition-audio?key=${key}`, contentType: "audio/mpeg", sizeBytes: bytes.length }) });
});
await context.route("**/api/vocabulary/definition-audio?*", route => route.fulfill({ contentType: "audio/mpeg", body: bytes }));
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
async function search(word) {
  await page.getByLabel("Bạn muốn tra từ nào?").fill(word);
  await page.getByLabel("Bạn muốn tra từ nào?").press("Enter");
}
try {
  await page.goto(base);
  await page.getByRole("button", { name: "Mở từ điển", exact: true }).click();
  const english = page.getByRole("button", { name: "Anh – Anh", exact: true });
  const bilingual = page.getByRole("button", { name: "Anh – Việt", exact: true });
  const vietnamese = page.getByRole("button", { name: "Việt – Anh", exact: true });
  await english.waitFor();
  await page.getByRole("heading", { name: "Tra một từ mới nhé!" }).waitFor();
  if (process.env.DICTIONARY_SCREENSHOT_DIR) {
    await page.locator('#dictionary-panel img').evaluateAll(nodes => Promise.all(nodes.map(node => node.decode())));
    await page.screenshot({ path: `${process.env.DICTIONARY_SCREENSHOT_DIR}/dictionary-redesign-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.DICTIONARY_SCREENSHOT_DIR}/dictionary-redesign-mobile.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await search("hello");
  await page.getByText("A greeting.", { exact: true }).waitFor();
  assert.equal(directions.at(-1).direction, "en-en");
  assert.equal(await page.getByText("/english-ipa/", { exact: true }).isVisible(), true);
  const panel = page.locator("#dictionary-panel");
  const originalBounds = await panel.boundingBox();
  const lookupCount = directions.length;
  await page.getByRole("button", { name: "Phóng to từ điển", exact: true }).click();
  const expandedBounds = await panel.boundingBox();
  assert.ok(expandedBounds.width > originalBounds.width && expandedBounds.height > originalBounds.height);
  assert.ok(expandedBounds.x >= 0 && expandedBounds.x + expandedBounds.width <= 1280);
  assert.equal(await page.getByLabel("Bạn muốn tra từ nào?").inputValue(), "hello");
  assert.equal(await page.getByText("A greeting.", { exact: true }).isVisible(), true);
  assert.equal(directions.length, lookupCount);
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Mở từ điển", exact: true }).click();
  await page.getByRole("button", { name: "Thu nhỏ từ điển", exact: true }).click();
  const restoredBounds = await panel.boundingBox();
  assert.ok(Math.abs(restoredBounds.width - originalBounds.width) < 1 && Math.abs(restoredBounds.height - originalBounds.height) < 1);
  assert.equal(await page.getByText("A greeting.", { exact: true }).isVisible(), true);
  await bilingual.click();
  await search("book");
  await page.getByText("Sổ sách kế toán.", { exact: true }).waitFor();
  assert.equal(await page.locator("[data-pronunciation]").count(), 2);
  assert.equal(await page.getByText("/hə.ˈloʊ̯/", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "Xem thêm 2 phiên âm", exact: true }).click();
  assert.equal(await page.locator("[data-pronunciation]").count(), 4);
  await page.getByRole("button", { name: "Thu gọn phiên âm", exact: true }).click();
  assert.equal(await page.locator("[data-pronunciation]").count(), 2);
  if (process.env.DICTIONARY_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DICTIONARY_SCREENSHOT_DIR}/dictionary-redesign-results.png` });
  assert.equal(prepared.length, 0);
  await page.getByRole("button", { name: "Nghe nghĩa Sổ sách kế toán.", exact: true }).click();
  await page.waitForFunction(() => window.__dictionaryPlayback.length === 1);
  assert.equal(prepared.length, 1); assert.equal(prepared[0].definitionId, secondId);
  await page.getByRole("button", { name: "Dừng nghĩa Sổ sách kế toán.", exact: true }).click();
  await page.getByRole("button", { name: "Nghe nghĩa Sổ sách kế toán.", exact: true }).click();
  await page.waitForFunction(() => window.__dictionaryPlayback.length === 2);
  assert.equal(prepared.length, 1);
  await page.getByRole("button", { name: "Nghe nghĩa Sách.", exact: true }).click();
  await page.waitForFunction(() => window.__dictionaryPlayback.length === 3);
  assert.equal(prepared[1].definitionId, firstId);
  await vietnamese.click();
  await page.waitForFunction(() => window.__dictionaryLiveUrls.size === 0);
  await search("học sinh");
  await page.getByText("a student", { exact: true }).waitFor();
  assert.equal(directions.at(-1).word, "học sinh"); assert.equal(directions.at(-1).direction, "vi-en");
  assert.equal(await page.getByText(/học-sinh-(fallback|hanoi|hue)/).count(), 0);
  assert.equal(await page.getByText("Hà-Nội", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Huế", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /Nghe nghĩa/ }).count(), 0);
  await bilingual.click(); await search("book");
  await page.getByText("Sách.", { exact: true }).waitFor();
  prepareFailure = true;
  await page.getByRole("button", { name: "Nghe nghĩa Sách.", exact: true }).click();
  await page.getByText("Nguồn giọng đọc đang bận.", { exact: true }).waitFor();
  assert.equal(await page.getByText("Sổ sách kế toán.", { exact: true }).isVisible(), true);
  prepareFailure = false;
  await page.getByRole("button", { name: "Nghe nghĩa Sách.", exact: true }).click();
  await page.waitForFunction(() => window.__dictionaryPlayback.length === 4);
  await bilingual.click(); await search("older"); await english.click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator("[data-dictionary-results]").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await english.isVisible(), true); assert.equal(await vietnamese.isVisible(), true);
  await page.getByRole("button", { name: "Phóng to từ điển", exact: true }).click();
  const mobileBounds = await panel.boundingBox();
  assert.equal(mobileBounds.x, 0); assert.equal(mobileBounds.y, 0);
  assert.equal(mobileBounds.width, 390); assert.equal(mobileBounds.height, 844);
  assert.equal(await page.getByRole("button", { name: "Thu nhỏ từ điển", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "Thu nhỏ từ điển", exact: true }).click();
  assert.ok((await panel.boundingBox()).width < mobileBounds.width);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, lookups: directions.length, audioPreparations: prepared.length,
    checks: ["three directions", "Vietnamese phrase", "Vietnamese IPA hidden and English IPA visible", "equivalent IPA deduplicated and variants collapsible", "on-demand selected meaning", "audio cache", "URL cleanup", "audio failure and retry", "stale request canceled", "mobile tabs", "maximize and restore preserve results", "mobile maximize fits viewport"] }));
} catch (error) {
  console.error(JSON.stringify({ prepared, errors, panel: await page.locator("#dictionary-panel").innerText().catch(() => ""),
    playback: await page.evaluate(() => window.__dictionaryPlayback).catch(() => []) }));
  throw error;
} finally { await browser.close(); }
