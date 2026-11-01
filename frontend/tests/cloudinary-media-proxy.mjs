import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Execute the actual route exports; only cookies/backend HTTP are replaced.
// No live account, backend listener or real uploaded media is needed.
const require = createRequire(import.meta.url), ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let token = "test-only-cookie", calls = [], reply = () => new Response("{}");
async function route(file) {
  const source = await fs.readFile(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const imports = {
    "next/headers": { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
    "@/lib/server-auth": { SESSION_COOKIE: "linguaai_session", backendUrl: value => new URL(value, "http://backend.test"),
      isSameOrigin: request => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin },
    "@/lib/backend-request": { backendRequestSignal: value => value, isBackendTimeout: error => error?.name === "TimeoutError" },
  };
  vm.runInNewContext(compiled, { exports, require: name => { assert.ok(imports[name], name); return imports[name]; },
    Request, Response, Headers, FormData, Blob, File, URL, Buffer, AbortSignal,
    fetch: async (url, init) => { calls.push({ url, init }); return reply(url, init); } }, { filename: file });
  return exports;
}
const media = await route("src/app/api/media/[fileName]/route.ts");
const admin = await route("src/app/api/admin/[...path]/route.ts");
const name = "a".repeat(32) + ".wav", mediaContext = { params: Promise.resolve({ fileName: name }) };
const adminContext = value => ({ params: Promise.resolve({ path: value.split("/") }) });
const checks = [];
const record = text => checks.push(text);
token = "";
let result = await media.GET(new Request("http://frontend.test/api/media/" + name), mediaContext);
assert.equal(result.status, 401); assert.equal(result.headers.get("cache-control"), "private, no-store"); assert.equal(calls.length, 0);
record("missing session cannot contact backend media");
token = "test-only-cookie";
result = await media.GET(new Request("http://frontend.test/api/media/invalid"), { params: Promise.resolve({ fileName: "invalid" }) });
assert.equal(result.status, 404); assert.equal(calls.length, 0);
record("invalid filenames cannot select a remote URL");
reply = () => new Response(new Uint8Array([4, 5, 6, 7]), { status: 206, headers: {
  "Content-Type": "audio/wav", "Content-Length": "4", "Content-Range": "bytes 4-7/64", "Accept-Ranges": "bytes" } });
result = await media.GET(new Request("http://frontend.test/api/media/" + name, { headers: { Range: "bytes=4-7" } }), mediaContext);
assert.equal(result.status, 206); assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [4, 5, 6, 7]);
assert.equal(result.headers.get("content-range"), "bytes 4-7/64"); assert.equal(result.headers.get("content-length"), "4");
assert.equal(result.headers.get("accept-ranges"), "bytes"); assert.equal(result.headers.get("x-content-type-options"), "nosniff");
assert.equal(calls.at(-1).init.headers.Range, "bytes=4-7"); assert.equal(calls.at(-1).init.headers.Authorization, "Bearer test-only-cookie");
assert.equal(result.headers.get("authorization"), null);
record("media proxy retains exact Range bytes/status/headers and keeps bearer server-side");
reply = () => new Response(null, { status: 416, headers: { "Content-Length": "0", "Content-Range": "bytes */64" } });
result = await media.GET(new Request("http://frontend.test/api/media/" + name), mediaContext);
assert.equal(result.status, 416); assert.equal(result.headers.get("content-range"), "bytes */64");
record("unsatisfiable Range stays 416 rather than becoming a successful body");
reply = () => new Response("{}", { status: 503, headers: { "Retry-After": "10" } });
result = await media.GET(new Request("http://frontend.test/api/media/" + name), mediaContext);
assert.equal(result.status, 503); assert.equal(result.headers.get("retry-after"), "10");
record("cloud retry hint survives the media proxy");
const before = calls.length;
result = await admin.POST(new Request("http://frontend.test/api/admin/uploads", { method: "POST", headers: { Origin: "https://foreign.test" } }), adminContext("uploads"));
assert.equal(result.status, 403); assert.equal(calls.length, before);
result = await admin.POST(new Request("http://frontend.test/api/admin/uploads", { method: "POST", headers: { "Content-Length": String(28 * 1024 * 1024) } }), adminContext("uploads"));
assert.equal(result.status, 413); assert.equal(calls.length, before);
record("cross-origin and oversize uploads are rejected before forwarding");
const form = new FormData(); form.set("kind", "audio"); form.set("file", new Blob([new Uint8Array(64)], { type: "audio/wav" }), "lesson.wav");
reply = () => Response.json({ url: "/api/media/" + name });
result = await admin.POST(new Request("http://frontend.test/api/admin/uploads", { method: "POST", body: form }), adminContext("uploads"));
assert.equal(result.status, 200); assert.equal((await result.json()).url, "/api/media/" + name);
assert.equal(calls.at(-1).init.body.get("file").size, 64); assert.equal(calls.at(-1).init.body.get("kind"), "audio");
assert.equal(calls.at(-1).init.headers["Content-Type"], undefined); assert.equal(result.headers.get("cache-control"), "no-store");
record("multipart upload forwards bytes/kind without a stale boundary and returns the stable application URL");
reply = () => Response.json({ title: "Cloud storage busy" }, { status: 503, headers: { "Retry-After": "10" } });
result = await admin.POST(new Request("http://frontend.test/api/admin/courses/1/publish", { method: "POST" }), adminContext("courses/1/publish"));
assert.equal(result.status, 503); assert.equal(result.headers.get("retry-after"), "10");
record("publish cloud failure remains private/retryable through the authoring proxy");
const report = { testedAtUtc: new Date().toISOString(), checks, note: "Actual TypeScript route exports; mocked cookies/backend HTTP; no live user credentials or Cloudinary uploads." };
await fs.writeFile(path.join(root, "../reports/Cloudinary_course_proxy_checks_2026-10-28.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: checks.length, checks }));
