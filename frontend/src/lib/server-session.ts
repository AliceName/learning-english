import "server-only";
import type { NextResponse } from "next/server";
import { backendUrl, SESSION_COOKIE, sessionCookieOptions, type PublicUser } from "./server-auth";

export const REFRESH_COOKIE = "linguaai_refresh";

type IssuedSession = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  expiresAt: string;
  user: PublicUser;
};

export function isRefreshToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}\.[a-f0-9]{64}$/i.test(value);
}

export async function readIssuedSession(response: Response): Promise<IssuedSession> {
  const result = await response.json();
  if (typeof result?.accessToken !== "string" || !result.accessToken || !Number.isInteger(result.expiresIn) ||
      result.expiresIn < 1 || result.expiresIn > 3600 || !result.user ||
      (result.refreshToken != null && !isRefreshToken(result.refreshToken)))
    throw new Error("Invalid authentication response");
  return result;
}

export function setBrowserSession(response: NextResponse, session: IssuedSession) {
  if (session.refreshToken) {
    response.cookies.set(SESSION_COOKIE, session.accessToken, sessionCookieOptions);
    response.cookies.set(REFRESH_COOKIE, session.refreshToken, sessionCookieOptions);
  } else {
    // A backend without refresh support still issues the original fixed-duration session.
    response.cookies.set(SESSION_COOKIE, session.accessToken, { ...sessionCookieOptions, maxAge: session.expiresIn });
    response.cookies.set(REFRESH_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  }
}

export function sendRefreshToken(action: "refresh" | "logout", refreshToken: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(10_000);
  return fetch(backendUrl(`/api/v1/auth/${action}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}
