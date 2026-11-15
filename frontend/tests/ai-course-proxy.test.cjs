const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function proxy({ signedIn = true, send = () => Response.json({ ok: true }) } = {}) {
  const calls = [];
  const module = { exports: {} };
  const filename = path.join(__dirname, "../src/app/api/ai-courses/[[...path]]/route.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL, Headers, Response, Request, AbortSignal, Uint8Array, ArrayBuffer,
    fetch: async (url, init) => { calls.push({ url: String(url), ...init }); return send(url, init); },
    require(name) {
      if (name === "next/headers") return { cookies: async () => ({ get: () => signedIn ? { value: "test-session" } : undefined }) };
      if (name === "@/lib/server-auth") return { SESSION_COOKIE: "session", backendUrl: path => new URL(path, "http://backend"), isSameOrigin: request => !request.headers.has("origin") || request.headers.get("origin") === new URL(request.url).origin };
      throw Error(name);
    },
  }, { filename });
  return { ...module.exports, calls };
}
const job = "ad806692-50c4-45d3-8fc2-a88338f88d4e";
const lesson = "7c773728-229c-4faf-9ddf-d16312f25c1c";
const context = path => ({ params: Promise.resolve({ path }) });

test("requires a session, checks mutation origin and rejects unlisted routes", async () => {
  const anonymous = proxy({ signedIn: false });
  assert.equal((await anonymous.GET(new Request("http://site/api/ai-courses"), context())).status, 401);
  const authenticated = proxy();
  assert.equal((await authenticated.POST(new Request("http://site/api/ai-courses", { method: "POST", headers: { origin: "https://other" } }), context())).status, 403);
  assert.equal((await authenticated.GET(new Request("http://site/api/ai-courses/secret"), context(["secret"]))).status, 404);
  assert.equal(authenticated.calls.length, 0);
});

test("preserves multipart bytes, boundary and idempotency key", async () => {
  const route = proxy();
  const form = new FormData(); form.set("config", '{"goal":"Practice listening"}'); form.set("file", new Blob(["document"]), "test.docx");
  const request = new Request("http://site/api/ai-courses", { method: "POST", body: form, headers: { "Idempotency-Key": job } });
  const original = await request.clone().arrayBuffer();
  const response = await route.POST(request, context());
  assert.equal(response.status, 200);
  assert.equal(route.calls[0].url, "http://backend/api/v1/ai-course-generations");
  assert.equal(route.calls[0].headers.get("Idempotency-Key"), job);
  assert.equal(route.calls[0].headers.get("Content-Type"), request.headers.get("Content-Type"));
  assert.deepEqual(new Uint8Array(route.calls[0].body), new Uint8Array(original));
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("enforces streamed size limits without relying on content-length", async () => {
  const route = proxy();
  const response = await route.POST(new Request(`http://site/api/ai-courses/${job}/activate`, { method: "POST", body: new Uint8Array(65537), headers: { "Content-Type": "application/json" } }), context([job, "activate"]));
  assert.equal(response.status, 413); assert.equal(route.calls.length, 0);
});

test("forwards private audio byte ranges and does not turn an owned-job 404 into a server error", async () => {
  const route = proxy({ send: () => new Response(new Uint8Array(44), { status: 206, headers: { "Content-Type": "audio/wav", "Content-Range": "bytes 0-43/288044", "Accept-Ranges": "bytes" } }) });
  const response = await route.GET(new Request(`http://site/api/ai-courses/${job}/audio/${lesson}`, { headers: { Range: "bytes=0-43" } }), context([job, "audio", lesson]));
  assert.equal(route.calls[0].headers.get("Range"), "bytes=0-43");
  assert.equal(response.status, 206); assert.equal(response.headers.get("Content-Range"), "bytes 0-43/288044");
  assert.equal((await response.arrayBuffer()).byteLength, 44);
  const missing = proxy({ send: () => new Response(null, { status: 404 }) });
  assert.equal((await missing.GET(new Request(`http://site/api/ai-courses/${job}`), context([job]))).status, 404);
});
