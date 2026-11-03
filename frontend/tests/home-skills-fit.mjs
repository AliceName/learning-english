// Regression: every skill and its action must fit without vertical scrolling.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const base = process.env.HOME_TEST_BASE_URL ?? "http://localhost:3000";
const reports = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../reports");
await fs.mkdir(reports, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
const results = [];
const failures = [];
page.on("pageerror", error => errors.push(error.message));
const viewports = [[1440, 900], [1366, 768], [1280, 720], [1024, 600], [768, 1024], [390, 844], [375, 667], [360, 640], [320, 568], [844, 390]];

async function inspect(skill, phase, before) {
  const fit = await page.locator(`#skill-${skill.toLowerCase()}`).evaluate(card => {
    const body = card.querySelector('[class*="skillBody"]');
    const action = card.querySelector('a[href="/register"]');
    const cardBox = card.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    const actionBox = action.getBoundingClientRect();
    const hit = document.elementFromPoint(actionBox.x + actionBox.width / 2, actionBox.y + actionBox.height / 2);
    const visible = [...body.querySelectorAll("button, input, p, blockquote, strong, [role=status]")]
      .filter(node => node.checkVisibility() && !node.closest('[aria-hidden="true"]'))
      .map(node => ({ text: (node.textContent ?? "").slice(0, 35), top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom }));
    return {
      sectionHeight: document.getElementById("features").getBoundingClientRect().height,
      viewport: innerHeight, scrollTop: document.getElementById("main-content").scrollTop,
      cardTop: cardBox.top, cardBottom: cardBox.bottom, cardHeight: cardBox.height,
      bodyHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight,
      bodyTop: bodyBox.top, bodyBottom: bodyBox.bottom,
      actionBottom: actionBox.bottom, actionClickable: !!hit && action.contains(hit),
      overflowing: visible.filter(node => node.top < bodyBox.top - 2 || node.bottom > bodyBox.bottom + 2),
    };
  });
  results.push({ size: page.viewportSize(), skill, phase, ...fit });
  const label = `${page.viewportSize().width}×${page.viewportSize().height} ${skill} ${phase}: ${JSON.stringify(fit)}`;
  if (Math.abs(fit.sectionHeight - fit.viewport) > 2 || Math.abs(fit.scrollTop - before) > 2 || fit.cardTop < 80 || fit.cardBottom > fit.viewport || fit.bodyScrollHeight > fit.bodyHeight + 2 || fit.overflowing.length || !fit.actionClickable) failures.push(label);
}

try {
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.goto(base);
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.getByRole("navigation", { name: "Các phần trang chủ", exact: true }).getByRole("button", { name: "Cuộn tới 5 kỹ năng AI", exact: true }).click();
    await page.waitForFunction(() => Math.abs(document.getElementById("main-content").scrollTop - document.getElementById("features").offsetTop) < 2);
    const before = await page.locator("#main-content").evaluate(node => node.scrollTop);
    const carousel = page.getByRole("region", { name: "Trải nghiệm 5 kỹ năng AI", exact: true });
    await carousel.press("Home");
    for (const [index, skill] of ["Speaking", "Reading", "Writing", "Listening", "Grammar"].entries()) {
      if (index) await carousel.press("ArrowRight");
      await page.waitForFunction(skill => document.querySelector("[data-skill]")?.dataset.skill === skill.toLowerCase(), skill);
      await inspect(skill, "initial", before);
      const card = page.locator(`#skill-${skill.toLowerCase()}`);
      const quiz = card.getByRole("button", { name: "A. Năng lượng tái tạo tăng kỷ lục", exact: true });
      if (skill === "Reading" && await quiz.isVisible()) await quiz.click();
      if (skill === "Writing") await card.getByRole("button", { name: "Áp dụng", exact: true }).click();
      if (skill === "Listening") {
        await card.getByLabel("Từ còn thiếu trong câu nghe").fill("clarify");
        await card.getByRole("button", { name: "Kiểm tra", exact: true }).click();
      }
      if (skill === "Grammar") await card.getByRole("button", { name: "did he know", exact: true }).click();
      await inspect(skill, "feedback", before);
      if ((width === 1366 && skill === "Grammar") || (width === 390 && skill === "Reading") || (width === 320 && skill === "Writing") || (width === 844 && skill === "Listening")) {
        await page.screenshot({ path: path.join(reports, `skills-fit-${width}x${height}.png`) });
      }
    }
  }
  assert.deepEqual(errors, []);
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(JSON.stringify({ passed: results.length, viewports: viewports.length, errors }, null, 2));
} finally {
  await fs.writeFile(path.join(reports, "Skills_viewport_checks.json"), JSON.stringify({ results, failures, errors }, null, 2) + "\n");
  await browser.close();
}
