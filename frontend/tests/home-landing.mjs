// Run against a Next.js server; PLAYWRIGHT_MODULE_PATH supports the bundled runtime.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const base = process.env.HOME_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const reports = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../reports");
await fs.mkdir(reports, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const checks = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await context.route("**/api/auth/me", route => route.fulfill({ status: 401, json: {} }));
await context.addInitScript(() => {
  window.__samples = [];
  Object.defineProperty(window, "speechSynthesis", { value: {
    cancel() {}, getVoices() { return []; }, speak(utterance) { window.__samples.push({ text: utterance.text, rate: utterance.rate, language: utterance.lang }); },
  } });
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
const main = page.locator("#main-content");
const sectionNav = page.getByRole("navigation", { name: "Các phần trang chủ", exact: true });
const heroBear = page.getByRole("button", { name: "Boop the Gấu LEWA", exact: true });
const slides = page.getByRole("region", { name: "Trải nghiệm 5 kỹ năng AI", exact: true });
async function settledAt(id) {
  await page.waitForFunction(id => {
    const main = document.getElementById("main-content");
    const section = document.getElementById(id);
    return Math.abs(main.scrollTop - section.offsetTop) < 3;
  }, id);
  await page.waitForFunction(id => {
    const index = ["introduction", "features", "courses"].indexOf(id);
    return !!document.querySelector(`nav[aria-label="Các phần trang chủ"] button:nth-child(${index + 1})[aria-current]`);
  }, id);
}
async function skill(id) {
  await slides.press("Home");
  for (let index = 0; index < ["Speaking", "Reading", "Writing", "Listening", "Grammar"].indexOf(id); index++) await slides.press("ArrowRight");
  await page.waitForFunction(id => document.querySelector(`[data-skill]`)?.dataset.skill === id.toLowerCase(), id);
  return page.locator(`#skill-${id.toLowerCase()}`);
}
async function screenshot(name) {
  // Exclude Next.js development diagnostics from the design reference captures.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: path.join(reports, name) });
}
async function noOverflow(target) {
  assert.equal(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await target.locator("#main-content").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
}

try {
  await page.goto(base);
  await page.waitForLoadState("networkidle");
  await heroBear.waitFor();
  assert.equal(await page.locator("main > section").count(), 3);
  assert.equal(await page.locator('img[src*="googleusercontent"]').count(), 0);
  for (const file of ["bear-directions.webp", "bear-reactions.webp"]) {
    const response = await context.request.get(`${base}/mascots/${file}`);
    assert.equal(response.status(), 200);
    assert.match(response.headers()["content-type"], /image\/webp/);
  }
  const box = await heroBear.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (const [dx, dy, position] of [[200, 0, "100% 50%"], [180, 180, "100% 100%"], [0, 200, "50% 100%"], [-180, 180, "0% 100%"], [-200, 0, "0% 50%"], [-180, -180, "0% 0%"], [0, -200, "50% 0%"], [180, -180, "100% 0%"]]) {
    await page.mouse.move(cx + dx, cy + dy);
    await page.waitForFunction(expected => document.querySelector('button[aria-label="Boop the Gấu LEWA"] > span > span').style.backgroundPosition === expected, position);
  }
  await heroBear.click();
  await page.waitForFunction(() => document.querySelector('button[aria-label="Boop the Gấu LEWA"] > span > span:nth-child(2)').style.opacity === "1");
  await noOverflow(page);
  await screenshot("home-bear-desktop.png");
  checks.push("three-section layout; local bear assets, eight look directions and click reactions");

  await page.getByRole("button", { name: "Start", exact: true }).click();
  await settledAt("features");
  assert.equal(await sectionNav.getByRole("button", { name: "Cuộn tới 5 kỹ năng AI", exact: true }).getAttribute("aria-current"), "step");
  assert.equal(await slides.getByRole("group", { includeHidden: true }).count(), 5);
  const speaking = page.locator("#skill-speaking");
  assert.equal(await speaking.getByRole("button", { name: "Boop the Gấu Coach", exact: true }).count(), 1);
  await speaking.getByRole("button", { name: "Nghe câu mẫu", exact: true }).click();
  assert.match((await page.evaluate(() => window.__samples))[0].text, /flat white/);
  await speaking.getByRole("button", { name: "Dừng câu mẫu", exact: true }).click();
  await screenshot("home-skills-desktop.png");

  const reading = await skill("Reading");
  await reading.getByRole("button", { name: "unprecedented ⓘ", exact: true }).click();
  assert.equal(await reading.locator("#reading-definition").count(), 0);
  await reading.getByRole("button", { name: "unprecedented ⓘ", exact: true }).click();
  await reading.getByRole("button", { name: "B. Đầu tư năng lượng giảm", exact: true }).click();
  await reading.getByRole("status").filter({ hasText: "Thử lại nhé" }).waitFor();
  await reading.getByRole("button", { name: "A. Năng lượng tái tạo tăng kỷ lục", exact: true }).click();
  await reading.getByRole("status").filter({ hasText: "Chính xác!" }).waitFor();

  const writing = await skill("Writing");
  await writing.getByRole("button", { name: "Áp dụng", exact: true }).click();
  assert.match(await writing.locator("ins").last().textContent(), /acquire in-depth knowledge/);
  assert.equal(await writing.getByRole("button", { name: "Đã áp dụng", exact: true }).isDisabled(), true);

  const listening = await skill("Listening");
  await listening.getByRole("button", { name: "1.25x", exact: true }).click();
  await listening.getByRole("button", { name: "Nghe câu mẫu", exact: true }).click();
  assert.equal((await page.evaluate(() => window.__samples)).at(-1).rate, 1.25);
  await listening.getByLabel("Từ còn thiếu trong câu nghe").fill("clarify");
  await listening.getByLabel("Từ còn thiếu trong câu nghe").press("Enter");
  await listening.getByRole("status").filter({ hasText: "Đúng rồi!" }).waitFor();

  const grammar = await skill("Grammar");
  await grammar.getByRole("button", { name: "he knew", exact: true }).click();
  await grammar.getByRole("status").filter({ hasText: "Chưa đúng" }).waitFor();
  await grammar.getByRole("button", { name: "did he know", exact: true }).click();
  await grammar.getByRole("status").filter({ hasText: "Chính xác!" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Kỹ năng tiếp theo", exact: true }).isDisabled(), true);
  checks.push("all five skill previews, glossary, writing suggestion, audio controls and quizzes work");

  await slides.focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => document.querySelector("[data-skill]")?.dataset.skill === "listening");
  await page.getByRole("button", { name: "Kỹ năng trước", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-skill]")?.dataset.skill === "writing");
  await skill("Speaking");
  const dragBox = await speaking.locator("blockquote").boundingBox();
  await page.mouse.move(dragBox.x + dragBox.width - 15, dragBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + 10, dragBox.y + 8, { steps: 15 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector("[data-skill]")?.dataset.skill === "reading");
  checks.push("carousel arrows, keyboard and mouse dragging keep selection synchronized");

  await main.focus();
  await page.keyboard.press("PageDown");
  await settledAt("courses");
  assert.equal(await page.locator("#courses article").count(), 3);
  assert.deepEqual(await page.locator("#courses article > a").evaluateAll(nodes => nodes.map(node => node.getAttribute("href"))), ["/register", "/register", "/register"]);
  await screenshot("home-courses-desktop.png");
  await page.getByRole("button", { name: "↑ Về đầu trang", exact: true }).click();
  await settledAt("introduction");
  await page.getByRole("button", { name: "Thêm", exact: true }).click();
  await settledAt("courses");
  await sectionNav.getByRole("button", { name: "Cuộn tới Giới thiệu", exact: true }).click();
  await settledAt("introduction");
  await page.getByRole("navigation", { name: "Điều hướng chính", exact: true }).getByRole("link", { name: "Tính năng", exact: true }).click();
  await settledAt("features");
  checks.push("Start, Thêm, section dots, PageDown, footer and header anchors navigate correctly");

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await mobileContext.route("**/api/auth/me", route => route.fulfill({ status: 401, json: {} }));
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", error => errors.push(error.message));
  await mobile.goto(base);
  await mobile.waitForLoadState("networkidle");
  await noOverflow(mobile);
  await mobile.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await mobile.screenshot({ path: path.join(reports, "home-bear-mobile.png") });
  await mobile.getByRole("button", { name: "Mở menu", exact: true }).tap();
  await mobile.getByRole("navigation", { name: "Điều hướng chính", exact: true }).getByRole("link", { name: "Đăng nhập", exact: true }).waitFor();
  await mobile.getByRole("button", { name: "Đóng menu", exact: true }).tap();
  await mobile.getByRole("button", { name: "Start", exact: true }).tap();
  await mobile.getByRole("region", { name: "Trải nghiệm 5 kỹ năng AI", exact: true }).press("End");
  await mobile.waitForFunction(() => document.querySelector("[data-skill]")?.dataset.skill === "grammar");
  await noOverflow(mobile);
  await mobile.screenshot({ path: path.join(reports, "home-skills-mobile.png") });
  const mobileMain = mobile.locator("#main-content");
  assert.equal(await mobileMain.evaluate(node => getComputedStyle(node).scrollBehavior), "auto");
  await mobile.getByRole("navigation", { name: "Các phần trang chủ", exact: true }).getByRole("button", { name: "Cuộn tới Khóa học", exact: true }).tap();
  await noOverflow(mobile);
  await mobile.locator("#courses article").last().getByRole("link", { name: /Học ngay/ }).scrollIntoViewIfNeeded();
  assert.equal(await mobile.locator("#courses article").last().getByRole("link", { name: /Học ngay/ }).evaluate(node => {
    const box = node.getBoundingClientRect();
    return box.top >= 80 && box.bottom <= innerHeight;
  }), true);
  await mobile.screenshot({ path: path.join(reports, "home-courses-mobile.png") });
  await mobile.setViewportSize({ width: 320, height: 740 });
  await mobile.getByRole("navigation", { name: "Các phần trang chủ", exact: true }).getByRole("button", { name: "Cuộn tới 5 kỹ năng AI", exact: true }).tap();
  await noOverflow(mobile);
  await mobileContext.close();
  checks.push("mobile menu, touch selection, tall sections and 320px layout work with reduced motion");
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(reports, "Home_landing_ui_checks_2026-10-27.json"), JSON.stringify({ checks, errors }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  await browser.close();
}
