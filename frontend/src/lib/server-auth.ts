import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { backendRequestSignal } from "./backend-request";

export const SESSION_COOKIE = "linguaai_session";
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export type PublicUser = {
  userId: number;
  email: string;
  fullName: string;
  role: "admin" | "user";
  targetLevel: string | null;
  createdAt: string;
  currentStreak?: number;
  avatarUrl?: string | null;
};

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function backendUrl(path: string) {
  return new URL(path, process.env.API_BASE_URL ?? "http://localhost:5000");
}

type Session =
  | { status: "authenticated"; user: PublicUser }
  | { status: "anonymous" }
  | { status: "unavailable" };

export async function getCurrentUser(): Promise<Session> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { status: "anonymous" };
  await connection();
  try {
    const response = await fetch(backendUrl("/api/v1/auth/me"), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: backendRequestSignal(),
    });
    if (response.status === 401 || response.status === 403) return { status: "anonymous" };
    if (!response.ok) return { status: "unavailable" };
    return { status: "authenticated", user: await response.json() as PublicUser };
  } catch {
    return { status: "unavailable" };
  }
}
