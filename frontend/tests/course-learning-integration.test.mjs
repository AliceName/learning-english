import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

// Render the real course pages; only session/backend data and Next adapters are fixtures.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const styles = new Proxy({}, { get: (_, key) => String(key) });
const Link = ({ children, href, ...props }) => React.createElement("a", { ...props, href }, children);
const Image = ({ src, alt }) => React.createElement("img", { src, alt });
const empty = () => null;
const user = { userId: 42, email: "course-test@example.com", fullName: "Học viên kiểm thử", role: "user", targetLevel: "B1" };

function load(file, imports = {}) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, URLSearchParams, require(name) {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "next/link") return { default: Link };
    if (name === "next/image") return { default: Image };
    if (name === "next/navigation") return {
      redirect: href => { throw new Error(`Unexpected redirect: ${href}`); },
      notFound: () => { throw new Error("Unexpected not-found page"); },
    };
    if (name.endsWith(".module.css")) return { default: styles };
    if (name === "@/components/site-icon") return { default: empty };
    if (name === "@/components/navigation/member-shell") return { default: ({ children }) => children };
    if (name === "@/components/courses/course-cover") return { default: empty };
    if (name === "@/components/courses/course-card") return { default: empty };
    if (name === "@/components/courses/course-filters") return { default: empty };
    if (name === "@/components/courses/catalog-state") return { default: empty };
    if (name === "@/lib/server-auth") return { getCurrentUser: async () => ({ status: "authenticated", user }) };
    assert.ok(imports[name], `Unexpected module: ${name}`);
    return imports[name];
  } }, { filename: file });
  return exports;
}

const catalog = load("src/lib/course-catalog.ts");
const listening = load("src/lib/listening.ts");
const speakingLevels = load("src/components/speaking/speaking-levels.tsx", { "@/lib/course-catalog": catalog });
const course = {
  courseId: 23, title: "Khóa học nhiều kỹ năng", description: null, sourceType: "system", coverImageUrl: null,
  levels: ["B1"], skills: ["speaking", "listening"], lessonCount: 2, estimatedMinutes: 10, timedLessonCount: 2,
  enrollment: null,
};

async function renderPage(file, props, data) {
  const page = load(file, {
    "@/lib/course-catalog": catalog, "@/lib/listening": listening,
    "@/components/speaking/speaking-levels": speakingLevels,
    "@/lib/server-courses": { getCourse: async () => ({ status: "ok", data }), getCourses: async () => ({ status: "ok", data }) },
  });
  const suspense = page.default(props);
  const content = suspense.props.children;
  return renderToStaticMarkup(await content.type(content.props));
}

test("a mixed course keeps distinct Speaking and Listening actions and listening progress", async () => {
  const html = await renderPage("src/app/courses/[courseId]/page.tsx", { params: Promise.resolve({ courseId: "23" }) }, {
    course,
    lessons: [
      { lessonId: 29, title: "Bài nghe", skillType: "listening", estimatedMinutes: 5, difficultyLevel: "B1", listeningStatus: { attemptCount: 2, latestScore: 85 } },
      { lessonId: 30, title: "Bài nói", skillType: "speaking", estimatedMinutes: 5, difficultyLevel: "B1" },
    ],
    listeningProgress: { completedLessons: 1, totalLessons: 2, percent: 50 },
  });
  assert.match(html, /href="\/courses\/23\/lessons\/29\/listening"/);
  assert.match(html, /href="\/courses\/23\/speaking\/30"/);
  assert.match(html, /Tiến độ luyện nghe/);
  assert.match(html, /Gần nhất 85\/100 điểm/);
  assert.match(html, />Làm lại</);
  assert.match(html, />Luyện nói →</);
  assert.doesNotMatch(html, /href="\/courses\/23\/speaking\/29"/);
  assert.doesNotMatch(html, /href="\/courses\/23\/lessons\/30\/listening"/);
});

test("a Speaking-only course keeps its practice action without inventing listening progress", async () => {
  const html = await renderPage("src/app/courses/[courseId]/page.tsx", { params: Promise.resolve({ courseId: "23" }) }, {
    course: { ...course, skills: ["speaking"], lessonCount: 1 },
    lessons: [{ lessonId: 30, title: "Bài nói", skillType: "speaking", estimatedMinutes: null, difficultyLevel: "A1" }],
  });
  assert.match(html, /href="\/courses\/23\/speaking\/30"/);
  assert.match(html, /Chưa có thời lượng/);
  assert.doesNotMatch(html, /Tiến độ luyện nghe|Làm bài nghe/);
});

test("the new catalog hero retains all six Speaking CEFR level links", async () => {
  const html = await renderPage("src/app/courses/page.tsx", { searchParams: Promise.resolve({ skill: "speaking", level: "B1" }) }, {
    items: [], totalCount: 0, page: 1, pageSize: 12, totalPages: 0,
    summary: { totalCourses: 0, inProgress: 0, completed: 0 },
  });
  assert.match(html, /id="catalog-title"/);
  assert.match(html, /course-discovery-cat\.png/);
  assert.match(html, /Cấp độ bài luyện nói/);
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1].replaceAll("&amp;", "&"), "http://course.test"));
  for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
    assert.ok(links.some(link => link.pathname === "/courses" && link.searchParams.get("level") === level &&
      link.searchParams.get("skill") === "speaking" && link.searchParams.get("view") === "catalog"), `Missing ${level} catalog link`);
  }
});

test("the Speaking shortcut opens free practice while explicit catalog links keep course browsing", async () => {
  const data = { items: [], totalCount: 0, page: 1, pageSize: 12, totalPages: 0,
    summary: { totalCourses: 0, inProgress: 0, completed: 0 } };
  await assert.rejects(renderPage("src/app/courses/page.tsx", {
    searchParams: Promise.resolve({ skill: "speaking" }),
  }, data), /Unexpected redirect: \/speaking/);
  const html = await renderPage("src/app/courses/page.tsx", {
    searchParams: Promise.resolve({ skill: "speaking", view: "catalog" }),
  }, data);
  assert.match(html, /Cấp độ bài luyện nói/);
});
