// Isolated preview of the real learner component. Uses fixture data; never accesses accounts or a database.
// Run: node tests/ai-course-preview.mjs. Stop with Ctrl+C when browser checks finish.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { webpack } = require("next/dist/compiled/webpack/webpack");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "englishlearning-ai-course-ui-"));
const js = value => JSON.stringify(value.replaceAll("\\", "/"));
await fs.writeFile(path.join(temporary, "typescript.cjs"), `module.exports = source => require(${js(path.join(root, "node_modules/typescript"))}).transpileModule(source, {compilerOptions:{target:7,module:99,jsx:4,esModuleInterop:true}}).outputText;`);
await fs.writeFile(path.join(temporary, "css.cjs"), `module.exports = function(source) {
  const prefix = 's_' + require('node:crypto').createHash('sha256').update(this.resourcePath).digest('hex').slice(0,8) + '_';
  const classes = {}; const css = source.replace(/\\.([A-Za-z_][\\w-]*)/g, (_, name) => {classes[name]=prefix+name;return '.'+prefix+name;});
  return 'const style=document.createElement("style");style.textContent=' + JSON.stringify(css) + ';document.head.appendChild(style);module.exports=' + JSON.stringify(classes) + ';';
};`);
await fs.writeFile(path.join(temporary, "link.tsx"), `import React from 'react'; export default function Link({href,children,prefetch,replace,scroll,...props}) {return <a href={href} {...props}>{children}</a>;}`);
await fs.writeFile(path.join(temporary, "image.tsx"), `import React from 'react'; export default function Image({fill,unoptimized,sizes,...props}) {return <img {...props} style={fill?{position:'absolute',width:'100%',height:'100%',inset:0}:undefined}/>;}`);
await fs.writeFile(path.join(temporary, "navigation.ts"), `export function usePathname(){return '/courses/create-ai';} export function useRouter(){return {push(href){location.assign(href)},refresh(){location.reload()},replace(href){location.replace(href)}};}`);
await fs.writeFile(path.join(temporary, "entry.tsx"), `import React from 'react'; import {createRoot} from 'react-dom/client';
  import MemberShell from ${js(path.join(root, "src/components/navigation/member-shell.tsx"))};
  import CourseGenerator from ${js(path.join(root, "src/components/ai-courses/course-generator.tsx"))};
  createRoot(document.getElementById('app')).render(<MemberShell variant="catalog" user={{userId:42,email:'fixture@example.test',fullName:'Nguyễn Minh Anh',role:'user',targetLevel:'B2',currentStreak:2}}><CourseGenerator fullName="Nguyễn Minh Anh" targetLevel="B2"/></MemberShell>);`);
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
const makeLesson = (skillType,index) => ({id:`10000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`,skillType,title:`${skillType === "speaking" ? "Speak with confidence" : skillType === "listening" ? "Listen to everyday conversations" : "English for your next step"} · ${index+1}`,objective:"Vận dụng từ vựng và cấu trúc trong các tình huống thực tế.",audioUrl:null,audioSeconds:null,
  speaking:skillType==="speaking"?{goals:"Giới thiệu bản thân và trao đổi ý kiến.",sentences:[{text:"Could you tell me more about your work?",ipa:null,audioUrl:null}]}:null,
  listening:skillType==="listening"?{transcript:"Welcome to our conversation. Today we are planning a trip.",hideTranscriptFirstListen:true,questions:[{type:"multiple_choice",prompt:"What are they planning?",options:["A trip","A meeting"],correctOptionIndex:0,answer:null,explanation:"They are planning a trip."}]}:null,
  reading:skillType==="reading"?{passageTitle:"A small change",passage:"Small steps make a difference. Practise English every day.",instructions:"Read and answer.",translation:"Những bước nhỏ tạo nên sự khác biệt. Hãy luyện tiếng Anh mỗi ngày.",vocabulary:[{word:"practise",meaning:"luyện tập",example:"Practise every day."}],questions:[{type:"multiple_choice",prompt:"How often should you practise?",options:["Every day","Every year"],correctOptionIndex:0,answer:null,explanation:"Every day.",reference:"Practise English every day."}]}:null,
  writing:skillType==="writing"?{taskType:"email",topic:"Work",prompt:"Write a short email to a colleague.",instructions:"Use a polite greeting.",minWords:50,maxWords:100,sampleAnswer:"Dear Alex, Thank you for your help.",rubric:[{name:"Clarity",description:"Express your ideas clearly.",weight:100}]}:null,
  grammar:skillType==="grammar"?{topic:"Present simple",rules:"Use the present simple for routines.",commonMistakes:"Remember -s with he or she.",questions:[{type:"fill_blank",prompt:"She [blank] English.",options:[],correctOptionIndex:null,answer:"studies",explanation:"Third person singular."}]}:null});
const defaultConfig={goal:"Sử dụng tiếng Anh trong công việc",difficultyLevel:"B2",skills:["reading","writing"],lessonCount:1,questionsPerLesson:3,targetAudioSeconds:60,voice:"Kore"};
const makeJob=(id,title,status,config=defaultConfig)=>({id,status,fileName:"English-at-work.docx",config,createdAt:"2026-11-15T01:00:00Z",outlineRevision:1,courseId:status==="completed"?1038:null,courseUrl:status==="completed"?"/courses/1038":null,coverImageUrl:"/images/courses/ai-default.png",completedLessons:status==="completed"?2:0,totalLessons:config.skills.length*config.lessonCount,nextAttemptAt:null,error:null,outline:{title,description:"Lộ trình tiếng Anh theo mục tiêu và tài liệu của bạn.",summary:"Tập trung vào những tình huống quen thuộc, thực hành từng bước để sử dụng tiếng Anh tự tin hơn.",lessons:config.skills.flatMap((skill,skillIndex)=>Array.from({length:config.lessonCount},(_,index)=>makeLesson(skill,skillIndex*config.lessonCount+index)))}});
const jobs=[makeJob("9e806692-50c4-45d3-8fc2-a88338f88d4e","English for everyday work","completed"),makeJob("8e806692-50c4-45d3-8fc2-a88338f88d4e","Tự tin giao tiếp mỗi ngày","awaiting_outline")];
const json=(res,status,data)=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,"http://127.0.0.1");
    if(url.pathname==="/app.js"){res.writeHead(200,{"Content-Type":"application/javascript"});return res.end(bundle);}
    const staticFile=path.resolve(root,"public","."+decodeURIComponent(url.pathname));
    if(staticFile.startsWith(path.join(root,"public")+path.sep)&&/\.(png|jpe?g|webp|svg)$/i.test(staticFile)){
      try{const bytes=await fs.readFile(staticFile),ext=path.extname(staticFile).slice(1).toLowerCase();res.writeHead(200,{"Content-Type":{png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",svg:"image/svg+xml"}[ext]});return res.end(bytes);}catch{}
    }
    if(url.pathname.startsWith("/api/ai-courses")){
      if(url.pathname==="/api/ai-courses/options")return json(res,200,{configured:!(req.headers.referer||"").includes("setup=off")});
      if(req.method==="GET"&&url.pathname==="/api/ai-courses")return json(res,200,{items:jobs});
      const match=/^\/api\/ai-courses\/([a-f\d-]+)(?:\/(outline|generate|activate|retry))?$/.exec(url.pathname);
      if(req.method==="GET"&&match)return json(res,200,jobs.find(job=>job.id===match[1]));
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
      if(req.method==="POST"&&url.pathname==="/api/ai-courses"){
        const request=new Request("http://fixture/",{method:"POST",headers:req.headers,body:bytes,duplex:"half"});const form=await request.formData();const config=JSON.parse(form.get("config"));
        const job=makeJob("7e806692-50c4-45d3-8fc2-a88338f88d4e","Lộ trình tiếng Anh của Minh Anh","awaiting_outline",config);job.fileName=form.get("file").name;jobs.unshift(job);return json(res,202,job);
      }
      if(match){const job=jobs.find(job=>job.id===match[1]),body=bytes.length?JSON.parse(bytes.toString()):{};
        if(match[2]==="outline"){job.outline.title=body.title;job.outline.description=body.description;for(const lesson of body.lessons){const saved=job.outline.lessons.find(item=>item.id===lesson.id);saved.title=lesson.title;saved.objective=lesson.objective;}job.outlineRevision++;}
        if(match[2]==="generate"){job.status="awaiting_review";job.completedLessons=job.totalLessons;}
        if(match[2]==="activate"){job.status="completed";job.courseId=4242;job.courseUrl="/courses/4242";}
        if(match[2]==="retry")job.status="awaiting_outline";
        return json(res,200,job);
      }
      return json(res,404,{title:"Fixture route not found"});
    }
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
    res.end('<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI course studio verification | LEWA</title><style>body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}button,input,select{font:inherit}a{text-decoration:none}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
  }catch(error){json(res,500,{title:String(error)});}
});
server.listen(4177,"127.0.0.1",()=>console.log("AI course studio fixture: http://127.0.0.1:4177/courses/create-ai"));
process.on("SIGINT",async()=>{server.close();const resolved=path.resolve(temporary);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith("englishlearning-ai-course-ui-"))await fs.rm(resolved,{recursive:true,force:true});process.exit(0);});
