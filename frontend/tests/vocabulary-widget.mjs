// Run against a Next.js server. Set PLAYWRIGHT_MODULE_PATH when using a bundled runtime.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function loadPureModule(relative) {
  const source = await fs.readFile(path.join(root, relative), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const sandbox = { exports: {}, URL };
  vm.runInNewContext(js, sandbox);
  return sandbox.exports;
}
const { isDictionaryVisible } = await loadPureModule("src/lib/dictionary-visibility.ts");
for (const route of ["/account", "/account#profile", "/account?tab=profile", "/account/security", "/settings", "/settings/audio", "/profile", "/admin/settings/preferences", "/admin/profile/"])
  assert.equal(isDictionaryVisible(route), false, route);
for (const route of ["/", "/login", "/register", "/courses", "/courses/1", "/admin/courses", "/accounting", "/profiles", "/admin/settings-help"])
  assert.equal(isDictionaryVisible(route), true, route);
const { safeDictionaryUrl } = await loadPureModule("src/lib/vocabulary.ts");
assert.equal(safeDictionaryUrl("//example.com/audio.mp3"), "https://example.com/audio.mp3");
for (const value of ["javascript:alert(1)", "data:text/html,test", "http://example.com", "https://user:password@example.com", "invalid"])
  assert.equal(safeDictionaryUrl(value), null);

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const base = process.env.VOCABULARY_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const reports = path.resolve(root, "../reports");
const checks = ["route exclusions and safe URLs"];
let authenticated = false;
const lookups = [];
const errors = [];
const entry = {
  word: "curious", phonetic: "/ˈkjʊəriəs/", origin: null, phonetics: [],
  meanings: [{ partOfSpeech: "adjective", definitions: [{ definition: "Wanting to know or learn something.", example: "She was curious about the new language.", synonyms: [], antonyms: [] }], synonyms: ["inquisitive"], antonyms: [] }],
  license: { name: "Test fixture", url: "https://example.com/license" }, sourceUrls: ["https://example.com/curious"],
};
await context.route("**/api/auth/me", route => route.fulfill({ status: authenticated ? 200 : 401, contentType: "application/json", body: JSON.stringify(authenticated ? { userId: 42, fullName: "Dictionary test" } : { title: "Đăng nhập" }) }));
await context.route("**/api/vocabulary?*", async route => {
  const word = new URL(route.request().url()).searchParams.get("word"); lookups.push(word);
  if (word === "missing") return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ title: "Chưa tìm thấy từ này." }) });
  if (word === "broken") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ title: "Dịch vụ đang bận." }) });
  if (word === "older") await new Promise(resolve => setTimeout(resolve, 500));
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({ word: word.toLowerCase(), language: "en", source: "mongodb", isPersisted: true,
    fetchedAtUtc: new Date().toISOString(), entries: [{ ...entry, word: word.toLowerCase() }] }) }).catch(() => {});
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
async function open() {
  await page.getByRole("button", { name: "Mở từ điển", exact: true }).click();
  await page.locator("#dictionary-panel[open]").waitFor();
}
async function search(word) {
  await page.getByLabel("Bạn muốn tra từ nào?").fill(word);
  await page.getByLabel("Bạn muốn tra từ nào?").press("Enter");
}
try {
  await page.goto(base);
  assert.equal(await page.getByRole("button", { name: "Mở từ điển", exact: true }).count(), 1);
  await open();
  await page.getByRole("link", { name: "Đăng nhập để tra từ" }).waitFor();
  assert.equal(lookups.length, 0);
  checks.push("guest sees sign-in prompt without any dictionary lookup");
  await page.getByRole("button", { name: "Đóng từ điển" }).click();
  authenticated = true;
  await open();
  await search("curious");
  await page.getByRole("heading", { name: "curious", exact: true }).waitFor();
  assert.equal(await page.locator("#dictionary-panel").evaluate(node => node.matches(":modal")), false);
  assert.equal(await page.locator("#dictionary-panel audio").count(), 0);
  await page.screenshot({ path: path.join(reports, "vocabulary-widget-desktop.png") });
  checks.push("authenticated desktop lookup; optional audio absent; nonmodal panel");
  await page.keyboard.press("Escape");
  await page.locator("#dictionary-panel[open]").waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "Mở từ điển", exact: true }).evaluate(node => node === document.activeElement), true);
  await open();
  await page.getByRole("heading", { name: "curious", exact: true }).waitFor();
  assert.equal(lookups.length, 1);
  await search("missing"); await page.getByText("Chưa tìm thấy từ này.", { exact: true }).waitFor();
  await search("broken"); await page.getByText("Dịch vụ đang bận.", { exact: true }).waitFor();
  checks.push("close/reopen preserves last result; 404 and temporary errors display correctly");
  await search("older");
  await page.waitForTimeout(80);
  await search("newer");
  await page.getByRole("heading", { name: "newer", exact: true }).waitFor();
  await page.waitForTimeout(600);
  assert.equal(await page.getByRole("heading", { name: "older", exact: true }).count(), 0);
  checks.push("older response cannot overwrite a newer search");
  await page.getByRole("button", { name: "Đóng từ điển" }).click();
  await page.locator("header").getByRole("link", { name: "Đăng nhập", exact: true }).first().click();
  await page.waitForURL("**/login");
  await page.goBack();
  await page.waitForURL(base + "/");
  assert.equal(await page.locator("#dictionary-panel[open]").count(), 0);
  checks.push("navigation and browser Back keep panel collapsed");
  await page.goto(base + "/settings");
  assert.equal(await page.getByRole("button", { name: "Mở từ điển", exact: true }).count(), 0);
  checks.push("excluded settings route hides widget even on not-found page");
  await page.goto(base);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(); await search("curious");
  await page.getByRole("heading", { name: "curious", exact: true }).waitFor();
  assert.equal(await page.locator("#dictionary-panel").evaluate(node => node.matches(":modal")), true);
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  assert.equal(await page.locator("#dictionary-panel").evaluate(node => node.contains(document.activeElement)), true);
  const rect = await page.locator("#dictionary-panel").boundingBox();
  assert.ok(rect.x >= 0 && rect.x + rect.width <= 391);
  await page.screenshot({ path: path.join(reports, "vocabulary-widget-mobile.png") });
  await page.keyboard.press("Escape");
  await page.locator("#dictionary-panel[open]").waitFor({ state: "hidden" });
  checks.push("mobile sheet fits viewport and uses native modal keyboard behavior");
  await open();
  await page.getByRole("heading", { name: "curious", exact: true }).waitFor();
  authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event("linguaai:session-changed")));
  await open();
  await page.getByRole("link", { name: "Đăng nhập để tra từ" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "curious", exact: true }).count(), 0);
  checks.push("session changes clear lookup data and require sign-in again");
  // A fresh context avoids the already decoded sprites in Chrome's memory cache.
  const fallbackPage = await browser.newPage();
  let blockedSprites = 0;
  await fallbackPage.route("**/mascots/*.webp", route => { blockedSprites++; return route.abort(); });
  await fallbackPage.route("**/api/auth/me", route => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await fallbackPage.goto(base);
  const launcher = fallbackPage.getByRole("button", { name: "Mở từ điển", exact: true });
  await fallbackPage.waitForFunction(() => document.querySelector('button[aria-label="Mở từ điển"]')?.textContent.includes("Aa"), null, { timeout: 10000 })
    .catch(async error => { console.log(JSON.stringify({ blockedSprites, images: await fallbackPage.locator("img").evaluateAll(nodes => nodes.map(node => ({ src: node.src, complete: node.complete, width: node.naturalWidth }))) })); throw error; });
  await launcher.click(); await fallbackPage.getByRole("link", { name: "Đăng nhập để tra từ" }).waitFor();
  await fallbackPage.close();
  checks.push("missing mascot asset falls back to functional Aa button");
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(reports, "Vocabulary_ui_checks_2026-10-26.json"), JSON.stringify({ testedAtUtc: new Date().toISOString(), browser: "Installed Chrome, headless", baseUrl: base, note: "Running Next.js server; browser auth/lookup responses mocked; backend/DB verified by .NET tests. Mobile viewport simulation, not a physical mobile device.", checks, pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally { await browser.close(); }
