import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const reports = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../reports");
const plan = JSON.parse(await fs.readFile(path.join(reports, "Cloudinary_media_migration_plan.json"), "utf8"));
const verified = JSON.parse(await fs.readFile(path.join(reports, "Cloudinary_media_migration_verify.json"), "utf8"));
assert.equal(verified.status, "verified"); assert.equal(verified.planId, plan.planId); assert.equal(verified.snapshotHash, plan.snapshotHash);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
const page = await context.newPage(); const errors = [], checks = []; let bytesLoaded = 0;
page.on("pageerror", error => errors.push(error.message));
try {
  // The bytes were independently verified from cloud by native workers. Read the
  // matching rollback backup, without writing a new runtime media cache or exposing a signed URL.
  const fixtures = [];
  for (const asset of plan.snapshot.assets) {
    const expected = verified.assets.find(result => result.kind === asset.kind && result.reference === asset.reference && result.sourceFile === asset.sourceFile && result.legacyUrl === asset.legacyUrl);
    assert.ok(expected?.sha256); assert.ok(asset.sourceFile, "Browser decode requires the verified backup for each migrated source");
    const file = verified.files.find(file => file.file === asset.sourceFile);
    assert.ok(file?.backupPath); const full = path.resolve(file.backupPath), backup = path.resolve(verified.backupRoot);
    assert.ok(full.toLowerCase().startsWith((backup + path.sep).toLowerCase()));
    const body = await fs.readFile(full); assert.equal(body.length, expected.sizeBytes);
    assert.equal(createHash("sha256").update(body).digest("hex"), expected.sha256);
    fixtures.push({ asset, body, expected, url: `https://cutover.invalid/fixture/${fixtures.length}` });
  }
  await page.route("https://cutover.invalid/**", async route => {
    if (route.request().url() === "https://cutover.invalid/") return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><main id='media'></main></body></html>" });
    const fixture = fixtures.find(fixture => fixture.url === route.request().url()); assert.ok(fixture);
    bytesLoaded += fixture.body.length;
    return route.fulfill({ contentType: fixture.asset.contentType, body: fixture.body, headers: { "Cache-Control": "private, no-store" } });
  });
  await page.goto("https://cutover.invalid/");
  for (let index = 0; index < fixtures.length; index++) {
    const fixture = fixtures[index], image = fixture.asset.contentType.startsWith("image/");
    await page.evaluate(async ({ url, index, image }) => {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error("Fixture fetch failed");
      const blob = await response.blob(), objectUrl = URL.createObjectURL(blob);
      const element = document.createElement(image ? "img" : "audio"); element.id = `fixture-${index}`; element.src = objectUrl;
      element.dataset.objectUrl = objectUrl; document.getElementById("media").append(element);
      const decoding = image ? element.decode() : new Promise((resolve, reject) => {
        element.preload = "auto"; element.controls = true;
        element.addEventListener("canplay", resolve, { once: true }); element.addEventListener("error", () => reject(new Error("Browser cannot decode migrated audio")), { once: true });
        element.load(); if (element.readyState >= 3) resolve();
      });
      await Promise.race([decoding, new Promise((_, reject) => setTimeout(() => reject(new Error("Media decode timed out")), 20_000))]);
    }, { url: fixture.url, index, image });
    if (image) assert.ok(await page.locator(`#fixture-${index}`).evaluate(element => element.naturalWidth > 0 && element.naturalHeight > 0));
    else assert.ok(await page.locator(`#fixture-${index}`).evaluate(element => Number.isFinite(element.duration) && element.duration > 0));
    checks.push({ kind: fixture.asset.kind, reference: fixture.asset.reference, sha256: fixture.expected.sha256, decoded: true });
  }
  const loaded = bytesLoaded; await context.setOffline(true);
  for (let index = 0; index < fixtures.length; index++) {
    if (fixtures[index].asset.contentType.startsWith("image/")) continue;
    await page.evaluate(index => {
      const audio = document.getElementById(`fixture-${index}`), button = document.createElement("button"); button.id = `play-${index}`; button.textContent = "Play verified audio";
      audio.addEventListener("playing", () => { audio.dataset.played = "true"; }, { once: true });
      button.addEventListener("click", () => { audio.currentTime = 0; audio.play().catch(error => { audio.dataset.failure = error.name; }); }); document.body.append(button);
    }, index);
    await page.locator(`#play-${index}`).click();
    await page.waitForFunction(index => document.getElementById(`fixture-${index}`).dataset.played === "true", index);
    await page.locator(`#fixture-${index}`).evaluate(element => { element.pause(); element.currentTime = 0; });
  }
  assert.equal(bytesLoaded, loaded); assert.deepEqual(errors, []);
  await page.evaluate(() => document.querySelectorAll("[data-object-url]").forEach(element => { if (element instanceof HTMLMediaElement) element.pause(); URL.revokeObjectURL(element.dataset.objectUrl); element.remove(); }));
  const report = { status: "passed", planId: plan.planId, snapshotHash: plan.snapshotHash, testedAtUtc: new Date().toISOString(), assetsVerified: fixtures.length,
    imagesDecoded: fixtures.filter(fixture => fixture.asset.contentType.startsWith("image/")).length,
    audioPlayedOffline: fixtures.filter(fixture => fixture.asset.contentType.startsWith("audio/")).length, checks, errors,
    scope: "Chrome codec/Blob/offline test using migration-verified backup bytes; native cold/restart workers independently read the same hashes from Cloudinary. This is not a logged-in application end-to-end test." };
  await fs.writeFile(path.join(reports, "Cloudinary_cutover_browser.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, assetsVerified: report.assetsVerified, imagesDecoded: report.imagesDecoded, audioPlayedOffline: report.audioPlayedOffline }));
} catch (error) {
  await fs.writeFile(path.join(reports, "Cloudinary_cutover_browser.json"), JSON.stringify({ status: "failed", planId: plan.planId, snapshotHash: plan.snapshotHash,
    assetsVerified: checks.length, testedAtUtc: new Date().toISOString(), error: error instanceof Error ? error.message : "browser_cutover_failed" }, null, 2));
  throw error;
} finally { await context.setOffline(false).catch(() => {}); await browser.close(); }
