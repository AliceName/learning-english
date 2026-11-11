const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function servicesFor(projectRoot) {
  const next = path.join(projectRoot, 'frontend/node_modules/next/dist/bin/next');
  for (const [file, hint] of [
    [next, 'Run npm ci in frontend first.'],
    [path.join(projectRoot, 'ai/writing/.venv/Scripts/python.exe'), 'Set up the Writing Python environment first.'],
    [path.join(projectRoot, 'ai/writing/artifacts/cefr-my-first-run/run.json'), 'Missing trained CEFR model.'],
    [path.join(projectRoot, 'ai/writing/artifacts/gec-expanded-v1/run.json'), 'Missing serving GEC model.'],
  ]) {
    if (!fs.existsSync(file)) throw new Error(hint);
  }
  const gpuLock = path.join(projectRoot, 'ai/writing/.cache/locks/writing-gpu.lock');
  // Check only at startup. The training launcher still owns stopping/restoring AI.
  if (fs.existsSync(gpuLock)) {
    try { fs.readFileSync(gpuLock); }
    catch { throw new Error('Writing GPU lock is busy. Wait for the current training/evaluation to finish.'); }
  }
  const sdk = spawnSync('dotnet', ['--version'], { cwd: projectRoot, windowsHide: true, encoding: 'utf8' });
  if (sdk.error || sdk.status !== 0) throw new Error('Install the .NET SDK required by global.json first.');
  const powershell = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'];
  return [
    { name: 'AI', port: 8000, url: 'http://127.0.0.1:8000/health', status: 'ready', cwd: projectRoot,
      command: 'powershell.exe', args: [...powershell, path.join(projectRoot, 'ai/writing/Start-Writing.ps1'),
        '-CefrRun', 'artifacts/cefr-my-first-run', '-GecRun', 'artifacts/gec-expanded-v1'] },
    { name: 'API', port: 5000, url: 'http://127.0.0.1:5000/api/v1/health', status: 'healthy', cwd: projectRoot,
      command: 'powershell.exe', args: [...powershell, path.join(projectRoot, 'backend/scripts/Start-Development.ps1')] },
    { name: 'WEB', port: 3000, url: 'http://127.0.0.1:3000/', cwd: path.join(projectRoot, 'frontend'),
      command: process.execPath, args: [next, 'dev', '--hostname', '127.0.0.1', '--port', '3000'] },
  ];
}

function listening(port, host) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(600, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function healthy(service) {
  try {
    const response = await fetch(service.url, { signal: AbortSignal.timeout(1500), redirect: 'manual' });
    if (response.status < 200 || response.status >= 400) {
      await response.body?.cancel();
      return false;
    }
    if (service.status) return (await response.json()).status === service.status;
    await response.body?.cancel();
    return true;
  } catch { return false; }
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // Only PIDs held by our live ChildProcess objects; never kill by port/name.
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
  } else {
    child.kill('SIGTERM');
  }
}

async function startStack(services, { log = console.log, timeoutMs = 120000, signals = false } = {}) {
  const owned = [];
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const { child } of [...owned].reverse()) stopChild(child);
  };
  const onSignal = () => { stop(); process.exit(0); };
  if (signals) {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, onSignal);
    process.once('exit', stop);
  }
  try {
    for (const service of services) {
      const occupied = await Promise.all(['127.0.0.1', '::1'].map(host => listening(service.port, host)));
      if (occupied.some(Boolean)) throw new Error(`Port ${service.port} is already in use. Close its old terminal first; existing services were not stopped.`);
    }
    if (stopping) throw new Error('Startup cancelled.');
    for (const service of services) {
      log(`[${service.name}] Starting...`);
      const child = spawn(service.command, service.args, { cwd: service.cwd, windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'] });
      const entry = { service, child, failure: null };
      owned.push(entry);
      child.once('error', error => { entry.failure = error; });
      child.once('exit', (code, signal) => {
        entry.failure = new Error(`${service.name} stopped (${signal || code}).`);
        if (!stopping) log(`[${service.name}] Stopped (${signal || code}). Other services remain running; Ctrl+C stops this launcher.`);
      });
      for (const stream of [child.stdout, child.stderr]) {
        readline.createInterface({ input: stream }).on('line', line => log(`[${service.name}] ${line}`));
      }
    }
    const deadline = Date.now() + timeoutMs;
    await Promise.all(owned.map(async entry => {
      while (Date.now() < deadline) {
        if (entry.failure) throw entry.failure;
        if (await healthy(entry.service)) {
          log(`[${entry.service.name}] Ready: ${entry.service.url}`);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      throw new Error(`${entry.service.name} did not become ready. Read its logs above.`);
    }));
    const failed = owned.find(entry => entry.failure);
    if (failed) throw failed.failure;
    return { stop, children: owned.map(entry => entry.child) };
  } catch (error) {
    stop();
    throw error;
  }
}

if (require.main === module) {
  Promise.resolve().then(() => servicesFor(root)).then(services => startStack(services, { signals: true }))
    .then(() => console.log('\nAll 3 services are ready. Open http://localhost:3000/writing\nKeep this terminal open. Press Ctrl+C to stop services started here.\nSQL Server must be available for login and saving submissions.'))
    .catch(error => { console.error(`\nStartup failed: ${error.message}`); process.exitCode = 1; });
}

module.exports = { servicesFor, startStack, healthy, listening };
