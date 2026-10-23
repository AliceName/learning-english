export const levels = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const skills = { speaking: "Luyện nói", writing: "Luyện viết", listening: "Nghe hiểu", reading: "Đọc hiểu", grammar:"Ngữ pháp" } as const;
export type CourseQuery = { search: string; level: string; skill: string; source: string; status: string; sort: string; page: number };
export const defaultCourseQuery: CourseQuery = { search: "", level: "", skill: "", source: "", status: "all", sort: "updated", page: 1 };
export type CourseItem = {
  courseId: number; title: string; description: string | null; sourceType: string; coverImageUrl: string | null;
  updatedAt: string; lessonCount: number; estimatedMinutes: number; timedLessonCount: number;
  levels: string[]; skills: string[]; enrollmentCount: number;
  enrollment: { status: string; progressPercent: number } | null;
};
export type CourseList = { items: CourseItem[]; totalCount: number; page: number; pageSize: number; totalPages: number; summary: { totalCourses: number; inProgress: number; completed: number } };
export type CourseDetail = { course: CourseItem; lessons: { lessonId: number; title: string; skillType: string; difficultyLevel: string | null; estimatedMinutes: number | null; orderIndex: number }[] };

export function parseCourseQuery(params: Record<string, string | string[] | undefined>): CourseQuery {
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const allowed = (key: string, values: readonly string[], fallback = "") => values.includes(value(key)) ? value(key) : fallback;
  const page = Number(value("page"));
  return {
    search: value("search").trim().slice(0, 200), level: allowed("level", levels), skill: allowed("skill", Object.keys(skills)),
    source: allowed("source", ["system", "user_upload"]), status: allowed("status", ["all", "in_progress", "completed", "not_started"], "all"),
    sort: allowed("sort", ["updated", "newest", "popular", "title"], "updated"), page: Number.isInteger(page) && page >= 1 && page <= 10000 ? page : 1,
  };
}

export function courseQueryString(query: CourseQuery) {
  const params = new URLSearchParams();
  for (const key of Object.keys(query) as (keyof CourseQuery)[]) {
    if (query[key] !== defaultCourseQuery[key]) params.set(key, String(query[key]));
  }
  return params.toString();
}

export function catalogHref(query: CourseQuery, changes: Partial<CourseQuery> = {}) {
  const params = courseQueryString({ ...query, page: 1, ...changes });
  return params ? `/courses?${params}` : "/courses";
}

export function skillLabel(skill: string) { return skills[skill as keyof typeof skills] ?? skill; }
export function durationLabel(course: Pick<CourseItem, "estimatedMinutes" | "timedLessonCount" | "lessonCount">) {
  if (!course.timedLessonCount) return "Chưa có thời lượng";
  const hours = Math.floor(course.estimatedMinutes / 60);
  const minutes = course.estimatedMinutes % 60;
  const duration = [hours ? `${hours} giờ` : "", minutes || !hours ? `${minutes} phút` : ""].filter(Boolean).join(" ");
  return course.timedLessonCount < course.lessonCount ? `Tối thiểu ${duration}` : duration;
}
