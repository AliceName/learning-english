import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const service = path.join(repo, "backend", "speaking-ai");
const storage = path.join(repo, "backend", "EnglishLearning.Api", "App_Data", "speaking-service");
const lockPath = path.join(storage, "startup.lock");
const logPath = path.join(storage, "service.log");
const healthUrl = "http://127.0.0.1:8001/health";
const timeoutMs = 180_000;

async function ready() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const body = await response.json();
    return body.status === "ready" && typeof body.modelVersion === "string";
  } catch { return false; }
}
async function portInUse() {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port: 8001 });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once("connect", () => finish(true)); socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}
async function waitReady(child) {
  const started = Date.now(); let lastNotice = 0;
  while (Date.now() - started < timeoutMs) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`Speaking exited before becoming ready. See ${logPath}`);
    if (await ready()) { console.log("[Speaking] Ready at http://127.0.0.1:8001. Starting frontend."); return; }
    if (Date.now() - lastNotice >= 15_000) { console.log("[Speaking] Loading the model, please wait..."); lastNotice = Date.now(); }
    await delay(1000);
  }
  throw new Error(`Speaking did not become ready within 180 seconds. See ${logPath}. Check the existing process before retrying.`);
}

async function main() {
  if (process.env.SPEAKING_AUTO_START === "0") { console.log("[Speaking] Automatic startup disabled (SPEAKING_AUTO_START=0)."); return; }
  if (await ready()) { console.log("[Speaking] Service already ready; reusing it."); return; }
  const training = path.resolve(process.env.SPEAKING_TRAINING_ROOT ?? path.join(repo, "..", "EnglishPronunciationTraining", "EnglishPronunciationTraining"));
  const python = process.platform === "win32" ? path.join(training, ".venv", "Scripts", "python.exe") : path.join(training, ".venv", "bin", "python");
  if (!fs.existsSync(python)) {
    console.warn(`[Speaking] Starting frontend without the local scorer. Python not found: ${python}. Set SPEAKING_TRAINING_ROOT to the prepared training project to enable automatic startup.`);
    return;
  }
  fs.mkdirSync(storage, { recursive: true });
  let lock;
  try { lock = fs.openSync(lockPath, "wx"); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let running = false;
    try { const { pid } = JSON.parse(fs.readFileSync(lockPath, "utf8")); if (Number.isInteger(pid) && pid > 0) { process.kill(pid, 0); running = true; } }
    catch { /* A previous launcher may have stopped before releasing its lock. */ }
    if (running) { console.log("[Speaking] Another launcher is starting the service."); await waitReady(); return; }
    fs.unlinkSync(lockPath);
    lock = fs.openSync(lockPath, "wx");
  }
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    if (await ready()) return;
    if (await portInUse()) {
      console.log("[Speaking] Port 8001 is in use. Waiting for the existing service; no duplicate will be launched.");
      await waitReady(); return;
    }
    const log = fs.openSync(logPath, "a");
    let child;
    try {
      fs.writeSync(log, `\n--- Speaking startup ${new Date().toISOString()} ---\n`);
      child = spawn(python, ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8001", "--workers", "1"], {
        cwd: service, env: { ...process.env, SPEAKING_TRAINING_ROOT: training, PYTHONUNBUFFERED: "1" },
        detached: true, windowsHide: true, stdio: ["ignore", log, log],
      });
      await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      child.unref();
    } finally { fs.closeSync(log); }
    console.log(`[Speaking] Started in background (PID ${child.pid}). Log: ${logPath}`);
    await waitReady(child);
  } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

try { await main(); }
catch (error) { console.error(`[Speaking] ${error.message}`); process.exitCode = 1; }
