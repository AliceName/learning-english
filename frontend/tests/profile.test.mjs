import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { NextResponse } from "next/server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function load(file, imports = {}, extras = {}) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected module: ${name}`); return imports[name]; },
    Request, Response, Headers, URL, TextDecoder, Uint8Array, AbortSignal, Date, Intl, ...extras }, { filename: file });
  return exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const avatars = load("src/lib/profile-avatar.ts");
const profile = load("src/lib/profile.ts", { "./profile-avatar": avatars });
const user = { userId: 42, fullName: "Fixture User", email: "fixture@example.invalid", targetLevel: "B1", avatarUrl: null,
  role: "user", createdAt: "2026-01-01T00:00:00Z" };
const draft = () => plain(profile.profileDraft(user));
const reader = load("src/lib/read-json-body.ts");

test("existing accounts have optional details and can clear details explicitly", () => {
  const value = draft();
  assert.deepEqual(plain(profile.validateProfile(value)), {});
  const payload = plain(profile.profilePayload(value));
  assert.deepEqual(payload.personalDetails, { phoneNumber: null, dateOfBirth: null, address: null });
  assert.equal(payload.learningPreferences.dailyGoalMinutes, null);
  assert.equal(payload.fullName, user.fullName);
});
test("phone formats, leap dates, Unicode names and custom daily minutes validate", () => {
  const value = { ...draft(), fullName: "  Nguyễn Văn Đạt  ", phoneNumber: "+84 (912) 345-678", dateOfBirth: "2000-02-29", address: "Đà Nẵng",
    learningPurpose: "work", preferredSkill: "speaking", dailyGoalMinutes: "25", avatarUrl: "/avatars/mascot-fox-teal.svg" };
  assert.deepEqual(plain(profile.validateProfile(value, "2026-11-10")), {});
  assert.equal(profile.profilePayload(value).learningPreferences.dailyGoalMinutes, 25);
  assert.equal(profile.profilePayload(value).fullName, "Nguyễn Văn Đạt");
  for (const date of ["1899-12-31", "2026-11-11", "2023-02-29", "2024-02-30", "invalid"])
    assert.ok(profile.validateProfile({ ...value, dateOfBirth: date }, "2026-11-10")["PersonalDetails.DateOfBirth"]);
  for (const phone of ["123", "09123456abc", "1234567890123456", "++12345678"])
    assert.ok(profile.validateProfile({ ...value, phoneNumber: phone })["PersonalDetails.PhoneNumber"]);
  for (const minutes of ["4", "181", "15.5", "abc"])
    assert.ok(profile.validateProfile({ ...value, dailyGoalMinutes: minutes })["LearningPreferences.DailyGoalMinutes"]);
});
test("birthdate uses the project timezone at the day boundary", () => {
  assert.equal(profile.localToday(new Date("2026-11-09T17:05:00Z")), "2026-11-10");
});
test("all mascot/color pairs are local allowed assets; external and traversal paths fail", () => {
  for (const character of avatars.avatarCharacters) for (const color of avatars.avatarColors) {
    const url = avatars.mascotAvatar(character.value, color.value);
    assert.equal(avatars.isProfileAvatar(url), true);
    const asset = fs.readFileSync(path.join(root, "public", url), "utf8");
    assert.match(asset, /<svg/); assert.doesNotMatch(asset, /<script|(?:href|src)=["'](?:https?:|data:)/i);
  }
  assert.equal(avatars.isProfileAvatar("/avatars/profile-blue.svg"), true);
  for (const url of ["/avatars/mascot-dog-blue.svg", "/avatars/mascot-cat-blue.svg?x=1", "https://example.invalid/a.svg", "/avatars/../profile-blue.svg"])
    assert.equal(avatars.isProfileAvatar(url), false);
});

function setup(reply = () => Response.json(user), token = "fixture-access") {
  const calls = [];
  const auth = { SESSION_COOKIE: "linguaai_session", sessionCookieOptions: { httpOnly: true, sameSite: "lax", path: "/" },
    backendUrl: path => new URL(path, "http://backend.test"), isSameOrigin: req => !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin };
  const cookies = async () => ({ get: name => name === auth.SESSION_COOKIE ? token ? { value: token } : undefined : { value: "a".repeat(32) + "." + "b".repeat(64) } });
  const backend = { backendRequestSignal: () => undefined, isBackendTimeout: error => error?.name === "TimeoutError" };
  const fetch = async (url, init) => { calls.push({ url: String(url), init }); return reply(url, init); };
  const route = load("src/app/api/account/profile/route.ts", {
    "next/headers": { cookies }, "next/server": { NextResponse }, "@/lib/server-auth": auth,
    "@/lib/backend-request": backend, "@/lib/read-json-body": reader,
  }, { fetch });
  const session = load("src/lib/server-session.ts", { "server-only": {}, "./server-auth": auth }, { fetch });
  const security = load("src/lib/account-security.ts", { "server-only": {}, "next/headers": { cookies }, "next/server": { NextResponse },
    "./server-auth": auth, "./backend-request": backend, "./read-json-body": reader, "./server-session": session }, { fetch });
  const request = (body, origin = "http://frontend.test", method = "PUT") => new Request("http://frontend.test/api/account/profile", {
    method, headers: { "Content-Type": "application/json", Origin: origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { calls, route, security, request };
}
test("profile proxy preserves optional groups but strips privileged properties", async () => {
  const state = setup();
  const payload = plain(profile.profilePayload({ ...draft(), phoneNumber: "0912345678", preferredSkill: "speaking", dailyGoalMinutes: "15" }));
  const response = await state.route.PUT(state.request({ ...payload, role: "admin", userId: 99, authVersion: 99 }));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(state.calls[0].init.body), payload);
  assert.equal(state.calls[0].init.headers.Authorization, "Bearer fixture-access");
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("profile proxy rejects cross-origin, anonymous, malformed, and oversized requests before upstream", async () => {
  const state = setup(); const body = profile.profilePayload(draft());
  assert.equal((await state.route.PUT(state.request(body, "http://foreign.test"))).status, 403);
  assert.equal((await setup(undefined, "").route.PUT(state.request(body))).status, 401);
  assert.equal((await state.route.PUT(state.request({ ...body, personalDetails: [] }))).status, 400);
  assert.equal((await state.route.PUT(state.request({ ...body, fullName: "x".repeat(17000) }))).status, 413);
  assert.equal(state.calls.length, 0);
});
test("password proxy clears both HttpOnly credentials after confirmed update", async () => {
  const state = setup(() => new Response(null, { status: 204 }));
  const password = { currentPassword: "old-fixture-only", newPassword: "new-fixture-only", confirmPassword: "new-fixture-only" };
  const response = await state.security.updateAccountSecurity(state.request({ ...password, userId: 99 }, undefined, "POST"), "change-password");
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(state.calls[0].init.body), password);
  assert.equal(response.cookies.get("linguaai_session").maxAge, 0);
  assert.equal(response.cookies.get("linguaai_refresh").maxAge, 0);
  assert.equal(response.cookies.get("linguaai_session").httpOnly, true);
});
test("revoke-others proxy replaces browser cookies without exposing credentials to client JSON", async () => {
  const refresh = "c".repeat(32) + "." + "d".repeat(64);
  const state = setup(() => Response.json({ accessToken: "replacement", refreshToken: refresh, expiresIn: 1800,
    expiresAt: "2026-11-10T12:00:00Z", user }));
  const response = await state.security.updateAccountSecurity(state.request(undefined, undefined, "POST"), "sessions/revoke-others");
  assert.equal(response.cookies.get("linguaai_session").value, "replacement");
  assert.equal(response.cookies.get("linguaai_refresh").value, refresh);
  assert.equal(response.cookies.get("linguaai_refresh").httpOnly, true);
  assert.doesNotMatch(JSON.stringify(await response.json()), /replacement|refreshToken|accessToken/);
});
test("security proxy preserves cookies on rejection and checks Origin and body size", async () => {
  const state = setup(() => Response.json({ title: "Wrong password" }, { status: 400 }));
  const body = { currentPassword: "bad-password", newPassword: "fixture-only-new", confirmPassword: "fixture-only-new" };
  const response = await state.security.updateAccountSecurity(state.request(body, undefined, "POST"), "change-password");
  assert.equal(response.status, 400); assert.equal(response.cookies.getAll().length, 0);
  assert.equal((await state.security.updateAccountSecurity(state.request(body, "http://foreign.test", "POST"), "change-password")).status, 403);
  assert.equal((await state.security.updateAccountSecurity(state.request({ ...body, currentPassword: "a".repeat(5000) }, undefined, "POST"), "change-password")).status, 413);
  assert.equal(state.calls.length, 1);
});
