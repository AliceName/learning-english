// Isolated preview of the real learner component. Uses fixture data; never accesses accounts or a database.
// Run: node tests/reading-preview.mjs. Stop with Ctrl+C when browser checks finish.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { webpack } = require("next/dist/compiled/webpack/webpack");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "englishlearning-reading-ui-"));
const js = value => JSON.stringify(value.replaceAll("\\", "/"));
await fs.writeFile(path.join(temporary, "typescript.cjs"), `module.exports = source => require(${js(path.join(root, "node_modules/typescript"))}).transpileModule(source, {compilerOptions:{target:7,module:99,jsx:4,esModuleInterop:true}}).outputText;`);
await fs.writeFile(path.join(temporary, "css.cjs"), `module.exports = function(source) {
  const prefix = 's_' + require('node:crypto').createHash('sha256').update(this.resourcePath).digest('hex').slice(0,8) + '_';
  const classes = {}; const css = source.replace(/\\.([A-Za-z_][\\w-]*)/g, (_, name) => {classes[name]=prefix+name;return '.'+prefix+name;});
  return 'const style=document.createElement("style");style.textContent=' + JSON.stringify(css) + ';document.head.appendChild(style);module.exports=' + JSON.stringify(classes) + ';';
};`);
await fs.writeFile(path.join(temporary, "link.tsx"), `import React from 'react'; export default function Link({href,children,prefetch,replace,scroll,...props}) {return <a href={href} {...props}>{children}</a>;}`);
await fs.writeFile(path.join(temporary, "image.tsx"), `import React from 'react'; export default function Image({fill,unoptimized,sizes,...props}) {return <img {...props} style={fill?{position:'absolute',width:'100%',height:'100%',inset:0}:undefined}/>;}`);
await fs.writeFile(path.join(temporary, "navigation.ts"), `export function usePathname(){return '/courses/1/lessons/7/reading';} export function useRouter(){return {push(href){location.assign(href)},refresh(){location.reload()},replace(href){location.replace(href)}};}`);
await fs.writeFile(path.join(temporary, "entry.tsx"), `import React from 'react'; import {createRoot} from 'react-dom/client';
  import MemberShell from ${js(path.join(root, "src/components/navigation/member-shell.tsx"))};
  import ReadingPractice from ${js(path.join(root, "src/components/course-text/reading-practice.tsx"))};
  import {SESSION_CHANGED} from ${js(path.join(root, "src/lib/session-events.ts"))};
  createRoot(document.getElementById('app')).render(<><MemberShell user={{userId:42,email:'reading-test@example.com',fullName:'Học viên kiểm thử',role:'user',targetLevel:'B1',currentStreak:2}}><ReadingPractice userId={window.__READING_USER__} lesson={window.__READING_FIXTURE__}/></MemberShell><button style={{position:"fixed",right:12,bottom:12,zIndex:100}} onClick={()=>window.dispatchEvent(new Event(SESSION_CHANGED))}>Đổi phiên kiểm thử</button></>);`);
const compiler = webpack({ mode: "development", devtool: false, context: root, entry: path.join(temporary, "entry.tsx"),
  output: { path: temporary, filename: "app.js" },
  resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(root, "node_modules"), "node_modules"], alias: {
    "@": path.join(root, "src"), "next/link$": path.join(temporary, "link.tsx"), "next/image$": path.join(temporary, "image.tsx"), "next/navigation$": path.join(temporary, "navigation.ts"),
  } },
  module: { rules: [{ test: /\.tsx?$/, use: path.join(temporary, "typescript.cjs") }, { test: /\.css$/, use: path.join(temporary, "css.cjs") }] },
});
try { await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : resolve())); }
finally { await new Promise(resolve => compiler.close(resolve)); }
const bundle = await fs.readFile(path.join(temporary, "app.js"));
const imageName = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
const question = (questionId, type, prompt, options = [], extra = {}) => ({questionId, type, prompt, options, matchingLeft: [], matchingRight: [], focus: "scanning", points: 1, ...extra});
const lesson = {
  courseId: 1, courseTitle: "Tiếng Anh trong cuộc sống", lessonId: 7, title: "A Greener Way to Travel", difficultyLevel: "B1", estimatedMinutes: 15, contentVersion: "a".repeat(64),
  category: "Environment & Lifestyle", passageTitle: "Small journeys, big changes", instructions: "Read the passage and look at the chart. Answer the questions using information from the text.",
  imageUrl: `/api/media/${imageName}`, imageAlt: "Chart showing public transport use rising from 25% in 2020 to 60% in 2025", imageCaption: "Figure 1. Public transport use in Riverton, 2020–2025.",
  passage: "Every morning, the streets of Riverton used to fill with cars. For many residents, driving was the only convenient way to reach the city centre. Today, things are beginning to change.\n\n## A different kind of commute\nIn 2020, only **25 percent** of residents used public transport. The city then introduced electric buses, safer cycle lanes, and cheaper monthly passes. By 2025, the number had risen to **60 percent**.\n\nThe new electric buses run every ten minutes. They are quieter than traditional buses and produce no exhaust fumes. For Emma, a local teacher, the change has made her daily commute much easier.\n\n> “I used to spend an hour in traffic. Now I read a book on the bus and arrive at work feeling relaxed.”\n\n## More than a change of transport\nCycling has become more popular, too. New cycle lanes connect schools, parks, and neighbourhoods. Residents say these small changes have made Riverton a cleaner, friendlier place to live.\n\nThe city hopes that even more people will choose sustainable ways to travel in the future. A greener city starts with the journeys we make every day.",
  vocabulary: [{ word: "commute", meaning: "việc đi lại hằng ngày giữa nhà và nơi làm việc", example: "My daily commute takes thirty minutes." }, { word: "sustainable", meaning: "bền vững; ít gây hại cho môi trường", example: "Cycling is a sustainable way to travel." }],
  translation: null, latestResult: null,
  questions: [question(0, "multiple_choice", "What is the main idea of the passage?", ["Riverton is changing the way people travel.", "Driving is becoming more popular.", "The city is building more car parks."], { focus: "skimming" }),
    question(1, "fill_blank", "By 2025, [blank] percent of residents used public transport."),
    question(2, "short_answer", "How often do the electric buses run?"),
    question(3, "true_false_not_given", "Emma enjoys reading during her commute.", ["True", "False", "Not Given"]),
    question(4, "matching", "Match each word with its meaning.", [], {focus:"vocabulary", matchingLeft:["commute", "sustainable"], matchingRight:[{id:"sustainable",text:"ít gây hại cho môi trường"},{id:"commute",text:"đi lại hằng ngày"}]})],
};
const chart = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500" viewBox="0 0 900 500"><rect width="900" height="500" fill="#f0f5e9"/><text x="48" y="62" font-family="Arial" font-size="26" font-weight="700" fill="#355535">A greener way to travel</text><text x="48" y="94" font-family="Arial" font-size="15" fill="#7e9071">Riverton residents using public transport</text><g stroke="#dce5d2"><path d="M160 150H820M160 210H820M160 270H820M160 330H820M160 390H820"/></g><g fill="#90a080" font-family="Arial" font-size="14"><text x="108" y="155">80%</text><text x="108" y="215">60%</text><text x="108" y="275">40%</text><text x="108" y="335">20%</text><text x="118" y="395">0%</text></g><rect x="245" y="315" width="145" height="75" rx="8" fill="#b6c8a4"/><rect x="550" y="210" width="145" height="180" rx="8" fill="#6d9457"/><g font-family="Arial" text-anchor="middle"><text x="317" y="298" fill="#758b61" font-size="26" font-weight="700">25%</text><text x="622" y="193" fill="#4f753c" font-size="26" font-weight="700">60%</text><text x="317" y="425" fill="#748568" font-size="17">2020</text><text x="622" y="425" fill="#748568" font-size="17">2025</text></g><text x="48" y="470" font-family="Arial" font-size="12" fill="#9ba98f">Illustrative chart · Browser test fixture</text></svg>`;
const failed = new Set();
const json = (res, status, value) => { res.writeHead(status, {"Content-Type":"application/json", "Cache-Control":"no-store"}); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/app.js") { res.writeHead(200, {"Content-Type":"application/javascript"}); return res.end(bundle); }
  const staticFile = path.resolve(root, "public", "." + decodeURIComponent(url.pathname));
  if (staticFile.startsWith(path.join(root, "public") + path.sep) && /\.(png|jpe?g|webp|svg)$/i.test(staticFile)) {
    try {
      const bytes = await fs.readFile(staticFile), extension = path.extname(staticFile).slice(1).toLowerCase();
      res.writeHead(200, {"Content-Type": {png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",svg:"image/svg+xml"}[extension]});
      return res.end(bytes);
    } catch { /* The fixture chart and missing-image routes below are intentional. */ }
  }
  if (url.pathname === `/api/media/${imageName}`) { res.writeHead(200, {"Content-Type":"image/svg+xml", "Cache-Control":"no-store"}); return res.end(chart); }
  if (url.pathname.startsWith("/api/media/")) return json(res, 404, {title:"Ảnh thử nghiệm không tồn tại"});
  if (url.pathname.endsWith("/reading/submissions")) {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body), referer = req.headers.referer || "";
    if (referer.includes("fail-once") && !failed.has(referer)) { failed.add(referer); return json(res, 503, {title:"Kết nối thử nghiệm bị gián đoạn."}); }
    const find = id => input.answers.find(answer => answer.questionId === id);
    const correct = [find(0)?.optionIndex === 0, find(1)?.text?.trim() === "60", /ten|10/i.test(find(2)?.text || ""), find(3)?.optionIndex === 0,
      find(4)?.matches?.length === 2 && find(4).matches.every(match => match.rightId === (match.leftIndex === 0 ? "commute" : "sustainable"))];
    return json(res, 200, { result:{score:correct.filter(Boolean).length*20,correctAnswers:correct.filter(Boolean).length,totalQuestions:5},translation:"Thành phố Riverton đang thay đổi cách người dân đi lại. Xe buýt điện và làn đường xe đạp giúp việc đi lại thuận tiện hơn.",
      review:lesson.questions.map((question,index)=>({...question,correct:!!correct[index],submittedAnswer:find(index)?.text || (find(index)?.optionIndex !== undefined ? question.options[find(index).optionIndex] : find(index)?.matches?.length ? "Các cặp đã chọn" : null),correctAnswer:[question.options[0],"60","Every ten minutes","True","commute → đi lại hằng ngày; sustainable → ít gây hại cho môi trường"][index],explanation:"Dẫn chứng được nêu trong bài đọc và biểu đồ."}))});
  }
  if (url.pathname.startsWith("/api/")) return json(res, 200, {});
  const fixture = {...lesson};
  if (url.searchParams.get("version") === "new") fixture.contentVersion = "b".repeat(64);
  if (/^[a-z0-9-]{1,50}$/.test(url.searchParams.get("case") || "")) fixture.contentVersion = `preview-${url.searchParams.get("case")}`;
  if (url.searchParams.get("image") === "none") { delete fixture.imageUrl; delete fixture.imageCaption; }
  if (url.searchParams.get("image") === "broken") fixture.imageUrl = "/api/media/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png";
  res.writeHead(200, {"Content-Type":"text/html; charset=utf-8", "Cache-Control":"no-store"});
  res.end(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reading UI verification | LEWA</title><style>body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}button,input,select{font:inherit}a{text-decoration:none}</style></head><body><div id="app"></div><script>window.__READING_USER__=${url.searchParams.get("user") === "other" ? 43 : 42};window.__READING_FIXTURE__=${JSON.stringify(fixture)}</script><script src="/app.js"></script></body></html>`);
});
server.listen(Number(process.env.READING_PREVIEW_PORT || 4175), "127.0.0.1", () => console.log(`Reading fixture preview: http://127.0.0.1:${server.address().port}/courses/1/lessons/7/reading`));
process.on("SIGINT", async () => {
  server.close();
  const resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("englishlearning-reading-ui-")) await fs.rm(resolved, {recursive:true,force:true});
  process.exit(0);
});
