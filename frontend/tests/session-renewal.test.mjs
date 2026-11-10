import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { NextRequest, NextResponse } from "next/server.js";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const refresh = "a".repeat(32) + "." + "b".repeat(64);
const replacement = "c".repeat(32) + "." + "d".repeat(64);
const now = () => Math.floor(Date.now() / 1000);
const token = expiry => `header.${Buffer.from(JSON.stringify({ exp: expiry, session_exp: now() + 3600 })).toString("base64url")}.signature`;

function load(file, imports, fetch) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected module: ${name}`);
    return imports[name];
  }, fetch, Request, Response, Headers, URL, Buffer, AbortSignal, Date,
  process: { env: { NODE_ENV: "production" } } }, { filename: file });
  return exports;
}

function setup(reply) {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url: String(url), init }); return reply(url, init); };
  const auth = load("src/lib/server-auth.ts", {
    "server-only": {}, "next/headers": {}, "next/server": {},
    "./backend-request": {},
  }, fetch);
  const session = load("src/lib/server-session.ts", { "server-only": {}, "./server-auth": auth }, fetch);
  const proxy = load("src/proxy.ts", {
    "next/server": { NextResponse }, "@/lib/server-auth": auth, "@/lib/server-session": session,
  }, fetch).proxy;
  const request = (access = token(now() - 60), path = "/courses/23", init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", `linguaai_session=${access}; linguaai_refresh=${refresh}`);
    return new NextRequest(`http://frontend.test${path}`, { ...init, headers });
  };
  return { calls, proxy, request };
}

const issued = () => ({ accessToken: token(now() + 1800), refreshToken: replacement,
  expiresIn: 1800, expiresAt: new Date(Date.now() + 1800000).toISOString(), user: { userId: 42 } });

test("a valid access window does not contact the refresh endpoint", async () => {
  const state = setup(() => { throw new Error("Unexpected refresh"); });
  const response = await state.proxy(state.request(token(now() + 300)));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(state.calls.length, 0);
});

test("renewal forwards the new credentials to the current request and HttpOnly browser cookies", async () => {
  const session = issued();
  const state = setup(() => Response.json(session));
  const response = await state.proxy(state.request());
  assert.equal(state.calls.length, 1);
  assert.ok(state.calls[0].url.endsWith("/api/v1/auth/refresh"));
  assert.deepEqual(JSON.parse(state.calls[0].init.body), { refreshToken: refresh });
  assert.equal(response.cookies.get("linguaai_session").value, session.accessToken);
  assert.equal(response.cookies.get("linguaai_refresh").value, replacement);
  assert.equal(response.cookies.get("linguaai_refresh").httpOnly, true);
  assert.equal(response.cookies.get("linguaai_refresh").secure, true);
  assert.equal(response.cookies.get("linguaai_refresh").sameSite, "lax");
  assert.ok(response.headers.get("x-middleware-request-cookie").includes(session.accessToken));
  assert.ok(response.headers.get("x-middleware-request-cookie").includes(replacement));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("a temporary refresh outage preserves an access token that is still valid", async () => {
  const state = setup(() => { throw new TypeError("offline fixture"); });
  const response = await state.proxy(state.request(token(now() + 20)));
  assert.equal(state.calls.length, 1);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.cookies.getAll().length, 0);
});

test("an expired access token and offline refresh produce a retryable API response", async () => {
  const state = setup(() => { throw new TypeError("offline fixture"); });
  const response = await state.proxy(state.request(undefined, "/api/learning/courses/1/lessons/2/listening"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "3");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match((await response.json()).title, /gia hạn phiên/);
  assert.equal(response.cookies.getAll().length, 0);
});

test("foreign-origin requests and OPTIONS do not trigger session rotation", async () => {
  const state = setup(() => { throw new Error("Unexpected refresh"); });
  await state.proxy(state.request(undefined, "/api/account/profile", { method: "POST", headers: { Origin: "https://foreign.test" } }));
  await state.proxy(state.request(undefined, "/courses", { method: "OPTIONS" }));
  assert.equal(state.calls.length, 0);
});

test("a malformed renewal response cannot replace browser credentials", async () => {
  const state = setup(() => Response.json({ ...issued(), refreshToken: "invalid" }));
  const response = await state.proxy(state.request());
  assert.equal(response.status, 503);
  assert.equal(response.cookies.getAll().length, 0);
});

test("a revoked session response is left for normal authorization handling", async () => {
  const state = setup(() => new Response(null, { status: 401 }));
  const response = await state.proxy(state.request());
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.cookies.getAll().length, 0);
});
