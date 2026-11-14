import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { backendUrl, SESSION_COOKIE } from "./server-auth";
import { backendRequestSignal } from "./backend-request";
import { courseQueryString, type CourseQuery, type CourseList, type CourseDetail, type CourseItem } from "./course-catalog";

type FeaturedCourse = Pick<CourseItem, "courseId" | "title" | "description" | "lessonCount" | "estimatedMinutes" | "timedLessonCount" | "levels">;

type CatalogResult<T> = { status: "ok"; data: T } | { status: "anonymous" | "unavailable" | "not_found" };
async function read<T>(path: string): Promise<CatalogResult<T>> {
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
export function getCourses(query: CourseQuery) { return read<CourseList>(`/api/v1/courses?${courseQueryString(query)}`); }
export function getCourse(courseId: number) { return read<CourseDetail>(`/api/v1/courses/${courseId}`); }

export async function getFeaturedCourses(): Promise<FeaturedCourse[] | null> {
  try {
    const response = await fetch(backendUrl("/api/v1/courses/featured"), { cache: "no-store", signal: backendRequestSignal() });
    return response.ok ? await response.json() as FeaturedCourse[] : null;
  } catch {
    return null;
  }
}
