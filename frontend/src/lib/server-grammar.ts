import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { backendUrl, SESSION_COOKIE } from "./server-auth";
import { backendRequestSignal } from "./backend-request";
import { grammarPath, type GrammarLesson } from "./grammar";

type GrammarRead = { status: "ok"; data: GrammarLesson } | { status: "anonymous" | "not_found" | "unavailable" | "unsupported" };
export async function getGrammarLesson(courseId: number, lessonId: number): Promise<GrammarRead> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { status: "anonymous" };
  await connection();
  try {
    const response = await fetch(backendUrl(`/api/v1/${grammarPath(courseId, lessonId)}`), {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: backendRequestSignal(),
    });
    if (response.status === 401 || response.status === 403) return { status: "anonymous" };
    if (response.status === 404) return { status: "not_found" };
    if (response.status === 409) return { status: "unsupported" };
    if (!response.ok) return { status: "unavailable" };
    return { status: "ok", data: await response.json() as GrammarLesson };
  } catch { return { status: "unavailable" }; }
}
