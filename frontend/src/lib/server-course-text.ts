import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { backendUrl, SESSION_COOKIE } from "./server-auth";
import { backendRequestSignal } from "./backend-request";
import type { ReadingLesson, WritingLesson } from "./course-text";

export async function getCourseTextLesson(course: number, lesson: number, skill: "reading" | "writing"): Promise<
  { status: "ok"; data: ReadingLesson | WritingLesson } | { status: "anonymous" | "not_found" | "unsupported" | "unavailable" }
> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { status: "anonymous" };
  await connection();
  try {
    const response = await fetch(backendUrl(`/api/v1/courses/${course}/lessons/${lesson}/${skill}`), {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: backendRequestSignal(),
    });
    if (response.status === 401 || response.status === 403) return { status: "anonymous" };
    if (response.status === 404) return { status: "not_found" };
    if (response.status === 409) return { status: "unsupported" };
    if (!response.ok) return { status: "unavailable" };
    return { status: "ok", data: await response.json() };
  } catch { return { status: "unavailable" }; }
}
