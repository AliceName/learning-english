import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const base = process.env.VOCABULARY_TEST_BASE_URL ?? "http://localhost:3000";
const reports = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../reports");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
await context.addInitScript(() => {
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  window.__dictionaryAudioBlobs = { live: new Set(), created: 0, revoked: 0 };
  URL.createObjectURL = blob => {
    const url = create(blob);
    if (blob.type?.startsWith("audio/")) { window.__dictionaryAudioBlobs.live.add(url); window.__dictionaryAudioBlobs.created++; }
    return url;
  };
  URL.revokeObjectURL = url => {
    if (window.__dictionaryAudioBlobs.live.delete(url)) window.__dictionaryAudioBlobs.revoked++;
    revoke(url);
  };
});

// Two seconds of valid PCM, for deterministic browser readiness/playback tests.
const wave = Buffer.alloc(44 + 32000);
wave.write("RIFF", 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8); wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28);
wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(32000, 40);
let media = wave, mediaType = "audio/wav";
const liveOgg = process.env.ENGLISHLEARNING_RUN_LIVE_AUDIO_TEST === "1";
if (liveOgg) {
  // A fixed, public original recording; this opt-in test does not use a user-provided URL.
  const response = await fetch("https://upload.wikimedia.org/wikipedia/commons/a/ad/En-us-match.ogg", { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200); assert.ok(["audio/ogg", "application/ogg"].includes(response.headers.get("content-type")?.split(";")[0]));
  media = Buffer.from(await response.arrayBuffer()); mediaType = "audio/ogg";
  assert.ok(media.length > 32 && media.length < 5 * 1024 * 1024); assert.equal(media.subarray(0, 4).toString(), "OggS");
}
const phonetic = (id, accent) => ({ text: "/mætʃ/", audio: `https://api.dictionaryapi.dev/media/pronunciations/en/match-${accent}.mp3`,
  sourceUrl: `https://commons.wikimedia.org/w/index.php?curid=${id}`, license: { name: "Test fixture license", url: "https://example.com/license" } });
const uk = phonetic(9023225, "uk"), us = phonetic(825478, "us");
function result(word) {
  const entry = { word, phonetic: "/mætʃ/", origin: null, phonetics: [uk, us, uk],
    meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "A test dictionary entry.", example: null, synonyms: [], antonyms: [] }], synonyms: [], antonyms: [] }], license: null, sourceUrls: [] };
  return { word, language: "en", source: "mongodb", isPersisted: true, fetchedAtUtc: new Date().toISOString(), entries: [entry, { ...entry, phonetics: [us] }] };
}
let mode = "normal", failUS = false;
const prepared = [], files = [], unexpectedSources = [], pageErrors = [];
let inFlight = 0, maxInFlight = 0;
await context.route("**/api/auth/me", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ userId: 42, fullName: "Audio test" }) }));
await context.route("**/api/vocabulary?*", route => {
  const word = new URL(route.request().url()).searchParams.get("word");
  return route.fulfill({ contentType: "application/json", body: JSON.stringify(result(word)) });
});
await context.route("**/api/vocabulary/audio/prepare", async route => {
  const selection = route.request().postDataJSON(); prepared.push(selection); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    const requestMode = mode;
    await new Promise(resolve => setTimeout(resolve, selection.word === "older" ? 1500 : 500));
    if (requestMode === "unauthorized") return await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ title: "Phiên đã hết hạn." }) });
    const isUS = selection.entry === 1 || selection.phonetic === 1;
    if (failUS && isUS) return await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ title: "Giọng Mỹ tạm thời chưa sẵn sàng." }) });
    const query = new URLSearchParams({ word: selection.word, entry: String(selection.entry), phonetic: String(selection.phonetic) });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "ready", playbackUrl: `/api/vocabulary/audio?${query}`, contentType: mediaType, sizeBytes: media.length,
      attribution: { provider: "wikimedia", sourceUrl: us.sourceUrl, fileUrl: "https://example.com/test.wav", author: "Test speaker", licenseName: "Test fixture license", licenseUrl: "https://example.com/license", locale: isUS ? "en-US" : "en-GB" } }) });
  } catch { /* Expected when closing or changing the word aborts the request. */ }
  finally { inFlight--; }
});
await context.route("**/api/vocabulary/audio?*", route => {
  files.push(route.request().url());
  return route.fulfill({ contentType: mediaType, headers: { "Content-Length": String(media.length) }, body: media });
});
await context.route("https://api.dictionaryapi.dev/**", route => { unexpectedSources.push(route.request().url()); return route.abort(); });
await context.route("https://upload.wikimedia.org/**", route => { unexpectedSources.push(route.request().url()); return route.abort(); });
const page = await context.newPage();
page.on("pageerror", error => pageErrors.push(error.message));
page.on("console", message => { if (message.type() === "error" && /hydration|hydrated|didn't match/i.test(message.text())) pageErrors.push(message.text()); });
const checks = [];
async function waitUntil(predicate, label) {
  for (let i = 0; i < 120; i++) { if (await predicate()) return; await page.waitForTimeout(100); }
  throw new Error(`Timed out: ${label}`);
}
async function search(word) {
  await page.getByLabel("Bạn muốn tra từ nào?").fill(word); await page.getByLabel("Bạn muốn tra từ nào?").press("Enter");
  await page.getByRole("heading", { name: word, exact: true }).first().waitFor();
}
async function ready() { await waitUntil(async () => (await page.getByRole("button", { name: "Nghe giọng Mỹ", exact: true }).count()) === 2 && await page.getByRole("button", { name: "Nghe giọng Mỹ", exact: true }).first().isEnabled(), "audio player readiness"); }
try {
  await page.goto(base); await page.getByRole("button", { name: "Mở từ điển", exact: true }).click();
  await search("match");
  await waitUntil(() => prepared.length === 2, "automatic prepare before any play click");
  assert.ok(await page.getByRole("button", { name: /Đang chuẩn bị/ }).count() > 0);
  assert.equal(await page.locator("#dictionary-panel audio").evaluateAll(nodes => nodes.every(audio => audio.paused)), true);
  checks.push("lookup starts automatic preparation; meaning is visible and play remains disabled while loading");
  await ready();
  assert.equal(prepared.length, 2); assert.equal(files.length, 2); assert.equal(maxInFlight, 2);
  assert.equal(await page.locator("#dictionary-panel audio").count(), 3);
  assert.equal(await page.locator("#dictionary-panel audio").evaluateAll(nodes => nodes.every(audio => audio.src.startsWith("blob:") && audio.readyState >= 3 && audio.paused)), true);
  checks.push("duplicate recordings share two prepare/file requests; each player is ready without autoplay");
  await page.screenshot({ path: path.join(reports, "dictionary-audio-ready-desktop.png") });
  const before = { prepared: prepared.length, files: files.length };
  await page.getByRole("button", { name: "Nghe giọng Mỹ", exact: true }).first().evaluate(button => {
    button.addEventListener("click", () => {
      const start = performance.now();
      button.parentElement.querySelector("audio").addEventListener("playing", () => { window.__dictionaryClickToPlayingMs = performance.now() - start; }, { once: true });
    }, { once: true });
  });
  await context.setOffline(true);
  await page.getByRole("button", { name: "Nghe giọng Mỹ", exact: true }).first().click();
  await waitUntil(() => page.locator("#dictionary-panel audio").evaluateAll(nodes => nodes.some(audio => audio.currentTime > 0)), "offline playback from Blob");
  assert.equal(prepared.length, before.prepared); assert.equal(files.length, before.files);
  const clickToPlayingMs = await page.evaluate(() => window.__dictionaryClickToPlayingMs);
  assert.equal(typeof clickToPlayingMs, "number");
  checks.push("ready audio plays offline without preparing or fetching a file on click");
  await context.setOffline(false);
  await page.getByRole("button", { name: "Đóng từ điển" }).click();
  await waitUntil(() => page.evaluate(() => window.__dictionaryAudioBlobs.live.size === 0), "Blob cleanup on close");
  assert.equal(await page.locator("#dictionary-panel audio").count(), 0);
  checks.push("closing stops/unmounts audio and releases all Blob URLs");
  await page.getByRole("button", { name: "Mở từ điển", exact: true }).click(); await ready();
  failUS = true;
  const start = prepared.length;
  await search("partial");
  await page.getByText("Giọng Mỹ tạm thời chưa sẵn sàng.", { exact: true }).first().waitFor();
  await waitUntil(async () => await page.getByRole("button", { name: "Nghe giọng Anh", exact: true }).isEnabled(), "unaffected UK voice");
  assert.equal(prepared.length - start, 2);
  failUS = false;
  await page.getByRole("button", { name: "Thử lại âm thanh", exact: true }).first().click(); await ready();
  assert.equal(prepared.length - start, 3);
  checks.push("one unavailable voice does not block another; retry only prepares the failed recording");
  await search("older"); await waitUntil(() => prepared.some(item => item.word === "older"), "old request start");
  await search("newer"); await ready(); await page.waitForTimeout(1700);
  assert.equal(await page.getByRole("heading", { name: "older", exact: true }).count(), 0);
  checks.push("changing words aborts old preparations and cannot attach old audio to new results");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(reports, "dictionary-audio-ready-mobile.png") });
  assert.equal(await page.locator("#dictionary-panel").evaluate(node => node.matches(":modal")), true);
  checks.push("audio controls fit a mobile modal sheet");
  mode = "unauthorized";
  await search("expired");
  await page.getByRole("link", { name: "Đăng nhập để tra từ" }).waitFor();
  await waitUntil(() => page.evaluate(() => window.__dictionaryAudioBlobs.live.size === 0), "session cleanup");
  checks.push("expired audio session clears dictionary results and Blob URLs");
  assert.deepEqual(unexpectedSources, []); assert.deepEqual(pageErrors, []);
  await fs.writeFile(path.join(reports, "Dictionary_audio_ui_checks_2026-10-27.json"), JSON.stringify({ testedAtUtc: new Date().toISOString(), baseUrl: base, browser: "Chrome headless", mediaType, mediaSizeBytes: media.length, clickToPlayingMs,
    note: `Browser auth/lookup/prepare/file endpoints mocked; audio bytes ${liveOgg ? "downloaded from the original Wikimedia OGG" : "valid PCM fixture"}; backend/storage verified separately. One click timing sample; excludes hardware output latency. Mobile viewport simulation.`, checks, pageErrors, unexpectedSources }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }));
} catch (error) {
  console.log(JSON.stringify({ prepared, files, inFlight, pageErrors, panel: await page.locator("#dictionary-panel").innerText().catch(() => "not mounted") }));
  throw error;
} finally { await context.setOffline(false).catch(() => {}); await browser.close(); }
