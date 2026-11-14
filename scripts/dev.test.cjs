const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { servicesFor, startStack, listening } = require('./dev.cjs');

let directory, parentFile, childFile;
before(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "learning-dev 'test-"));
  parentFile = path.join(directory, 'parent fixture.cjs');
  childFile = path.join(directory, 'child fixture.cjs');
  fs.writeFileSync(parentFile, `
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,[process.argv[2],process.argv[3]],{stdio:'inherit',windowsHide:true});
    child.on('error',()=>process.exit(8));
    child.on('exit',code=>process.exit(code??1));
  `);
  fs.writeFileSync(childFile, `
    const http=require('node:http');
    const config=JSON.parse(process.argv[2]);
    if(config.fail)process.exit(7);
    const ready=Date.now()+(config.delay||0);
    http.createServer((req,res)=>{
      if(req.url.endsWith('/stop')){res.end('bye');setTimeout(()=>process.exit(0),30);return;}
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({status:Date.now()>=ready?'ready':'loading'}));
    }).listen(config.port,'127.0.0.1');
  `);
});
after(() => {
  // Only known fixture files; no recursive deletion of computed directories.
  fs.unlinkSync(parentFile); fs.unlinkSync(childFile); fs.rmdirSync(directory);
});

async function freePorts() {
  const servers = await Promise.all([0, 1, 2].map(() => new Promise(resolve => {
    const server = net.createServer().listen(0, '127.0.0.1', () => resolve(server));
  })));
  const ports = servers.map(server => server.address().port);
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  return ports;
}

function fixtures(ports, configurations = []) {
  return ports.map((port, i) => ({ name: ['AI', 'API', 'WEB'][i], port,
    url: `http://127.0.0.1:${port}/health`, status: 'ready', cwd: directory,
    command: process.execPath, args: [parentFile, childFile, JSON.stringify({ port, ...configurations[i] })] }));
}

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  assert.fail('Condition was not reached');
}

async function closed(ports) {
  await until(async () => (await Promise.all(ports.map(port => listening(port, '127.0.0.1')))).every(value => !value));
}

test('missing setup fails before launching processes', () => {
  assert.throws(() => servicesFor(directory), /npm ci/);
});

test('starts all services through paths with spaces/apostrophes and stops descendants', async () => {
  const ports = await freePorts();
  const logs = [];
  const stack = await startStack(fixtures(ports), { log: line => logs.push(line), timeoutMs: 10000 });
  try {
    assert.equal(stack.children.length, 3);
    assert.equal(logs.filter(line => line.includes('Ready:')).length, 3);
    assert.ok((await Promise.all(ports.map(port => listening(port, '127.0.0.1')))).every(Boolean));
  } finally { stack.stop(); stack.stop(); }
  await closed(ports);
});

test('an occupied port is left running and no owned process starts', async () => {
  const ports = await freePorts();
  const sentinel = net.createServer().listen(ports[1], '127.0.0.1');
  await new Promise(resolve => sentinel.once('listening', resolve));
  const logs = [];
  try {
    await assert.rejects(startStack(fixtures(ports), { log: line => logs.push(line) }), /already in use/);
    assert.equal(logs.length, 0);
    assert.ok(await listening(ports[1], '127.0.0.1'));
  } finally { await new Promise(resolve => sentinel.close(resolve)); }
});

test('startup failure cleans up the other owned process trees', async () => {
  const ports = await freePorts();
  await assert.rejects(startStack(fixtures(ports, [{}, { fail: true }]), { log: () => {}, timeoutMs: 10000 }), /stopped/);
  await closed(ports);
});

test('readiness timeout cleans up every child', async () => {
  const ports = await freePorts();
  await assert.rejects(startStack(fixtures(ports, [{ delay: 20000 }]), { log: () => {}, timeoutMs: 1500 }), /did not become ready/);
  await closed(ports);
});

test('stopping AI after readiness keeps API and web alive for training', async () => {
  const ports = await freePorts();
  const services = fixtures(ports);
  const stack = await startStack(services, { log: () => {}, timeoutMs: 10000 });
  try {
    await fetch(services[0].url + '/stop');
    await until(() => stack.children[0].exitCode !== null);
    assert.ok(await listening(ports[1], '127.0.0.1'));
    assert.ok(await listening(ports[2], '127.0.0.1'));
  } finally { stack.stop(); }
  await closed(ports);
});
