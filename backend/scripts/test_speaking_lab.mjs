// Browser regression with synthetic WAV and human-score fixtures. No AI claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reports = path.join(root, 'reports');
const temporary = await fs.mkdtemp(path.join(reports, 'speaking-lab-test-'));
const workspace = path.join(temporary, 'collection');
const python = process.env.SPEAKING_PYTHON || 'D:/EnglishPronunciationTraining/EnglishPronunciationTraining/.venv/Scripts/python.exe';
const script = path.join(root, 'backend/scripts/speaking_benchmark.py');
const playwright = process.env.PLAYWRIGHT_MODULE_PATH || 'C:/Users/ADMIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
let server, browser;
try {
  execFileSync(python, [script, 'prepare', '--workspace', workspace, '--speakers', '5'], { cwd: root, windowsHide: true });
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  server = spawn(python, ['-u', script, 'serve', '--workspace', workspace, '--port', String(port)], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', value => { log += value; }); server.stderr.on('data', value => { log += value; });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (true) {
    try { if ((await fetch(origin + '/api/cases')).ok) break; } catch {}
    if (server.exitCode !== null || Date.now() > deadline) throw new Error(log || 'Lab startup failed');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const { chromium } = await import(pathToFileURL(playwright).href);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByText('0/75 bản thu đã lưu').waitFor();
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  for (let index = 0; index < 8000; index++) wav.writeInt16LE(Math.round(6000 * Math.sin(index * .1)), 44 + index * 2);
  await page.locator('#upload').setInputFiles({ name: 'fixture.wav', mimeType: 'audio/wav', buffer: wav });
  await page.getByRole('button', { name: 'Lưu bản thu', exact: true }).click();
  await page.getByText('Đã lưu bản thu. Bạn có thể chọn câu tiếp theo.').waitFor();
  assert.equal((await fs.readFile(path.join(workspace, 'audio/vi001_p01.wav'))).compare(wav), 0);
  await page.locator('#mode').selectOption('review');
  await page.locator('#words select').first().waitFor();
  assert.equal(await page.locator('#instruction').textContent(), '');
  await page.locator('#read-match').selectOption('yes'); await page.locator('#quality').selectOption('yes');
  for (const select of await page.locator('#words select').all()) await select.selectOption('2');
  await page.locator('#save-review').click();
  await page.getByText('Hãy nghe bản ghi trước khi lưu đánh giá.').waitFor();
  await page.locator('#audio').evaluate(audio => audio.play());
  await page.locator('#save-review').click();
  await page.getByText('Đã lưu đánh giá. Không có điểm AI hiển thị trong phiếu này.').waitFor();
  await page.locator('#reviewer').selectOption('2');
  await page.waitForFunction(() => document.querySelector('#words select')?.value === '');
  assert.equal(await page.locator('#read-match').inputValue(), '');
  const secret = await fetch(origin + '/baseline.results.jsonl'); assert.equal(secret.status, 404);
  const forbidden = await fetch(origin + '/api/review', { method: 'POST', headers: { Origin: 'https://different-origin.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(forbidden.status, 403);
  const duplicate = await fetch(origin + '/api/audio?id=vi001_p01', { method: 'POST', headers: { Origin: origin }, body: wav });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(errors, []);
  console.log('PASS: real collector, exact WAV storage, blind reviewer separation, listen-before-label, origin guard, immutable recording.');
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill(); await new Promise(resolve => server.once('exit', resolve));
  }
  const resolved = await fs.realpath(temporary);
  if (!resolved.startsWith(reports + path.sep)) throw new Error('Unsafe cleanup path');
  await fs.rm(resolved, { recursive: true, force: true });
}
