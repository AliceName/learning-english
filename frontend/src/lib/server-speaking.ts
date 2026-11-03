import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { backendUrl, SESSION_COOKIE } from "./server-auth";
import { backendRequestSignal } from "./backend-request";
import type { SpeakingAttempt, SpeakingLesson } from "./speaking";

type Result<T> = { status: "ok"; data: T } | { status: "anonymous" | "not_found" | "unavailable" };
async function read<T>(path: string): Promise<Result<T>> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { status: "anonymous" };
  await connection();
  try {
    const response = await fetch(backendUrl(path), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: backendRequestSignal() });
    if (response.status === 401 || response.status === 403) return { status: "anonymous" };
    if (response.status === 404) return { status: "not_found" };
    if (!response.ok) return { status: "unavailable" };
    return { status: "ok", data: await response.json() as T };
  } catch { return { status: "unavailable" }; }
}
export function getSpeakingLesson(id: number) { return read<SpeakingLesson>(`/api/v1/speaking/lessons/${id}`); }
export function getSpeakingHistory(id: number) { return read<SpeakingAttempt[]>(`/api/v1/speaking/lessons/${id}/attempts`); }
