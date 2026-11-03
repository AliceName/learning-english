// Run against a Next.js server. Set PLAYWRIGHT_MODULE_PATH for a bundled runtime.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const base = process.env.AUTH_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const reports = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../reports");
await fs.mkdir(reports, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const checks = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
await context.route("**/api/auth/me", route => route.fulfill({ status: 401, json: { title: "Đăng nhập" } }));
let loginRequests = 0;
await context.route("**/api/auth/login", async route => {
  loginRequests++;
  assert.deepEqual(route.request().postDataJSON(), { email: "learner@example.com", password: "StrongPass123!" });
  await new Promise(resolve => setTimeout(resolve, 300));
  await route.fulfill({ status: 401, json: { detail: "Email hoặc mật khẩu chưa đúng." } });
});
let registrationRequests = 0;
await context.route("**/api/auth/register", async route => {
  registrationRequests++;
  assert.deepEqual(route.request().postDataJSON(), { fullName: "Nguyễn Văn A", email: "learner@example.com", password: "StrongPass123!", confirmPassword: "StrongPass123!", targetLevel: "B2" });
  await new Promise(resolve => setTimeout(resolve, 300));
  await route.fulfill({ status: 201, json: { user: { fullName: "Nguyễn Văn A", email: "learner@example.com" } } });
});
const mascot = page.getByRole("button", { name: "Boop the Cáo LEWA", exact: true });
const stage = mascot.locator("..");
const overlay = stage.locator(":scope > span");
const nativeDirection = mascot.locator("span > span").first();
async function waitReaction(expression, position) {
  await page.waitForFunction(value => document.querySelector(`[data-reaction="${value}"]`), expression);
  assert.equal(await overlay.evaluate(node => node.style.backgroundPosition), position);
  assert.match(await overlay.evaluate(node => node.style.backgroundImage), /fox-reactions\.webp/);
  assert.equal(await mascot.evaluate(node => getComputedStyle(node).opacity), "0");
}
async function waitReset() {
  await page.waitForFunction(() => !document.querySelector("[data-reaction]"));
}
async function noOverflow(target) {
  assert.equal(await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
}

try {
  await page.goto(base + "/login");
  await mascot.waitFor();
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "Đăng nhập", exact: true }).click();
  await waitReaction("heart", "50% 0%");
  await waitReset();
  for (const name of ["fox-directions.webp", "fox-reactions.webp"]) {
    const response = await context.request.get(base + "/mascots/" + name);
    assert.equal(response.status(), 200);
    assert.match(response.headers()["content-type"], /image\/webp/);
  }
  // Exercise the package's actual pointer tracking in all eight sectors.
  const box = await mascot.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const aims = [[200, 0, "100% 50%"], [180, 180, "100% 100%"], [0, 200, "50% 100%"], [-180, 180, "0% 100%"], [-200, 0, "0% 50%"], [-180, -180, "0% 0%"], [0, -200, "50% 0%"], [180, -180, "100% 0%"]];
  for (const [dx, dy, expected] of aims) {
    await page.mouse.move(cx + dx, cy + dy);
    await page.waitForFunction(({ label, expected }) => document.querySelector(`button[aria-label="${label}"] > span > span`).style.backgroundPosition === expected, { label: "Boop the Cáo LEWA", expected });
    assert.equal(await nativeDirection.evaluate(node => node.style.backgroundPosition), expected);
  }
  await page.mouse.move(cx, cy);
  await page.waitForFunction(() => document.querySelector('button[aria-label="Boop the Cáo LEWA"] > span > span').style.backgroundPosition === "50% 50%");
  checks.push("page-mascot tracks eight pointer directions and returns to center");

  await page.getByLabel("Địa chỉ email", { exact: true }).focus();
  await page.waitForFunction(() => document.querySelector("[data-look]"));
  assert.match(await overlay.evaluate(node => node.style.backgroundImage), /fox-directions\.webp/);
  const emailBox = await page.locator("#email").boundingBox();
  const angle = Math.atan2(emailBox.y + emailBox.height / 2 - cy, emailBox.x + emailBox.width / 2 - cx);
  assert.equal(await stage.getAttribute("data-look"), String([5, 8, 7, 6, 3, 0, 1, 2][(Math.round(angle / (Math.PI / 4)) + 8) % 8]));
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("button", { name: "Quên mật khẩu?", exact: true }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#password").evaluate(node => node === document.activeElement), true);
  await page.mouse.move(15, 15);
  await page.waitForFunction(() => !document.querySelector("[data-look]"));
  await mascot.click();
  await page.waitForFunction(() => document.querySelector('button[aria-label="Boop the Cáo LEWA"] > span > span:nth-child(2)').style.opacity === "1");
  assert.equal(await stage.getAttribute("data-override"), null);
  checks.push("keyboard focus aims at fields; mouse movement resumes native tracking");

  await page.getByRole("tab", { name: "Tạo tài khoản", exact: true }).click();
  await page.waitForURL("**/register");
  await waitReaction("sparkle", "50% 50%");
  await page.getByRole("heading", { name: "Khởi đầu miễn phí" }).waitFor();
  await noOverflow(page);
  await page.screenshot({ path: path.join(reports, "auth-register-desktop.png") });
  await page.goBack();
  await page.getByRole("heading", { name: "Chào mừng trở lại" }).waitFor();
  await page.goForward();
  await page.getByRole("heading", { name: "Khởi đầu miễn phí" }).waitFor();
  await page.getByRole("tab", { name: "Tạo tài khoản", exact: true }).press("ArrowLeft");
  await page.waitForURL("**/login");
  await waitReaction("heart", "50% 0%");
  checks.push("tabs, arrow keys and browser history keep route and form synchronized");

  // A newer reaction must survive the older reaction's original timeout.
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Quên mật khẩu?", exact: true }).click();
  await waitReaction("delighted", "100% 100%");
  await page.waitForTimeout(950);
  await waitReaction("delighted", "100% 100%");
  await page.getByText(/Tính năng đặt lại mật khẩu qua email chưa được hỗ trợ/).waitFor();
  await page.screenshot({ path: path.join(reports, "auth-login-desktop.png") });
  await waitReset();
  checks.push("forgot-password smile and helpful notice; latest reaction timer wins and resets");

  await page.getByRole("button", { name: "Đăng nhập vào không gian học", exact: true }).click();
  await waitReaction("heart", "50% 0%");
  assert.equal(await page.locator("#email").getAttribute("aria-invalid"), "true");
  assert.equal(await page.locator("#email").evaluate(node => node === document.activeElement), true);
  assert.equal(loginRequests, 0);
  await page.locator("#email").fill("learner@example.com");
  await page.locator("#password").fill("StrongPass123!");
  await page.getByRole("button", { name: "Hiện mật khẩu", exact: true }).click();
  assert.equal(await page.locator("#password").getAttribute("type"), "text");
  await page.locator("#password").press("Enter");
  await waitReaction("heart", "50% 0%");
  await page.getByRole("alert").filter({ hasText: "Email hoặc mật khẩu chưa đúng." }).waitFor();
  assert.equal(loginRequests, 1);
  checks.push("login validation, password reveal, Enter submission and API errors are preserved");

  await page.goto(base + "/register?email=learner%40example.com");
  assert.equal(await page.locator("#email").inputValue(), "learner@example.com");
  await page.getByRole("button", { name: "Tạo tài khoản miễn phí", exact: true }).click();
  assert.equal(registrationRequests, 0);
  await page.locator("#fullName").fill("Nguyễn Văn A");
  await page.locator("#password").fill("StrongPass123!");
  assert.equal(await page.getByRole("meter").getAttribute("aria-valuenow"), "4");
  await page.locator("#confirmPassword").fill("DoesNotMatch!");
  await page.getByRole("button", { name: "Tạo tài khoản miễn phí", exact: true }).click();
  await page.getByText("Mật khẩu xác nhận không khớp.", { exact: true }).waitFor();
  assert.equal(registrationRequests, 0);
  await page.locator("#confirmPassword").fill("StrongPass123!");
  await page.locator("#targetLevel").selectOption("B2");
  await page.getByRole("button", { name: "Tạo tài khoản miễn phí", exact: true }).click();
  await waitReaction("sparkle", "50% 50%");
  await page.getByRole("heading", { name: "Tạo tài khoản thành công!" }).waitFor();
  assert.equal(registrationRequests, 1);
  await page.getByRole("tabpanel").getByRole("button", { name: "Đăng nhập ngay", exact: true }).click();
  await page.waitForURL("**/login");
  await waitReaction("heart", "50% 0%");
  checks.push("registration prefill, mismatch validation, strength, CEFR payload and success work");

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await mobileContext.route("**/api/auth/me", route => route.fulfill({ status: 401, json: {} }));
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", error => errors.push(error.message));
  await mobile.goto(base + "/login");
  await mobile.locator("#email").tap();
  await mobile.waitForFunction(() => document.querySelector("[data-look]"));
  await noOverflow(mobile);
  await mobile.getByRole("button", { name: "Quên mật khẩu?", exact: true }).tap();
  await mobile.waitForFunction(() => document.querySelector('[data-reaction="delighted"]'));
  assert.equal(await mobile.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
  await mobile.screenshot({ path: path.join(reports, "auth-login-mobile.png"), fullPage: true });
  await mobile.getByRole("tab", { name: "Tạo tài khoản", exact: true }).tap();
  await mobile.waitForURL("**/register");
  await mobile.locator("#fullName").tap();
  await noOverflow(mobile);
  await mobile.screenshot({ path: path.join(reports, "auth-register-mobile.png"), fullPage: true });
  await mobile.getByRole("tab", { name: "Đăng nhập", exact: true }).tap();
  await mobile.waitForFunction(() => document.querySelector('[data-reaction="heart"]'));
  await mobile.getByRole("tab", { name: "Tạo tài khoản", exact: true }).tap();
  await mobile.setViewportSize({ width: 320, height: 740 });
  await noOverflow(mobile);
  await mobileContext.close();
  checks.push("touch focus and all expressions work with reduced motion; no overflow at 390px or 320px");
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(reports, "Auth_mascot_ui_checks_2026-10-26.json"), JSON.stringify({ checks, errors }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  await browser.close();
}
