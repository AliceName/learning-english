import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let token = "test-cookie", calls = [], reply = () => Response.json({ ok: true });
const source = await fs.readFile(path.join(root, "src/app/api/learning/[...path]/route.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
const imports = {
  "next/headers": { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
  "@/lib/server-auth": { SESSION_COOKIE: "linguaai_session", backendUrl: value => new URL(value, "http://backend.test"),
    isSameOrigin: request => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin },
  "@/lib/backend-request": { backendRequestSignal: signal => signal, isBackendTimeout: error => error?.name === "TimeoutError" },
};
vm.runInNewContext(compiled, { exports, require: name => imports[name], Request, Response, Headers, URL, Buffer,
  fetch: async (url, init) => { calls.push({ url, init }); return reply(url, init); } });
const base = "courses/1/lessons/2/listening", checks = [];
const context = value => ({ params: Promise.resolve({ path: value.split("/") }) });
const request = (method, route = base, init = {}) => exports[method](new Request(`http://frontend.test/api/learning/${route}`, { method, ...init }), context(route));

token = "";
assert.equal((await request("GET")).status, 401); assert.equal(calls.length, 0);
token = "test-cookie";
for (const [method, route] of [["POST", base], ["GET", base + "/start"], ["PUT", base + "/submissions"], ["GET", "admin/courses"], ["GET", "courses/2147483648/lessons/2/listening"]])
  assert.equal((await request(method, route)).status, 404);
assert.equal(calls.length, 0); checks.push("session and route/method allowlist");
assert.equal((await request("POST", base + "/start", { headers: { Origin: "https://foreign.test" } })).status, 403);
assert.equal(calls.length, 0); checks.push("same-origin writes");
assert.equal((await request("POST", base + "/submissions", { headers: { "Content-Length": "200000" } })).status, 413);
assert.equal((await request("POST", base + "/submissions", { body: "á".repeat(70000) })).status, 413);
assert.equal(calls.length, 0); checks.push("declared and actual UTF-8 body limits");
const body = JSON.stringify({ contentVersion: "a".repeat(64), answers: [] });
let response = await request("POST", base + "/submissions", { body });
assert.equal(response.status, 200); assert.equal(calls.at(-1).init.body, body);
assert.equal(calls.at(-1).init.headers.Authorization, "Bearer test-cookie");
assert.equal(response.headers.get("authorization"), null); assert.equal(response.headers.get("cache-control"), "private, no-store");
checks.push("submission body and cookie-only server authorization");
await exports.GET(new Request(`http://frontend.test/api/learning/${base}/results?page=2&pageSize=5`), context(base + "/results"));
assert.equal(calls.at(-1).url.search, "?page=2&pageSize=5"); checks.push("history query forwarding");
reply = () => Response.json({ title: "Bài đã thay đổi" }, { status: 409 });
response = await request("POST", base + "/submissions", { body });
assert.equal(response.status, 409); assert.equal((await response.json()).title, "Bài đã thay đổi"); checks.push("backend status and error preservation");
reply = () => { throw new DOMException("deadline", "TimeoutError"); };
assert.equal((await request("GET")).status, 504); checks.push("timeout response");
reply = () => { throw new TypeError("offline"); };
assert.equal((await request("GET")).status, 503);
const aborted = new AbortController(); aborted.abort();
assert.equal((await request("GET", base, { signal: aborted.signal })).status, 499); checks.push("offline and cancellation responses");
console.log(JSON.stringify({ status: "passed", checks }, null, 2));
