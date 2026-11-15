// Isolated preview of the real learner component. Uses fixture data; never accesses accounts or a database.
// Run: node tests/course-flashcards-preview.mjs. Stop with Ctrl+C when browser checks finish.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { webpack } = require("next/dist/compiled/webpack/webpack");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "englishlearning-course-flashcards-ui-"));
const js = value => JSON.stringify(value.replaceAll("\\", "/"));
await fs.writeFile(path.join(temporary, "typescript.cjs"), `module.exports = source => require(${js(path.join(root, "node_modules/typescript"))}).transpileModule(source, {compilerOptions:{target:7,module:99,jsx:4,esModuleInterop:true}}).outputText;`);
await fs.writeFile(path.join(temporary, "css.cjs"), `module.exports = function(source) {
  const prefix = 's_' + require('node:crypto').createHash('sha256').update(this.resourcePath).digest('hex').slice(0,8) + '_';
  const classes = {}; const css = source.replace(/\\.([A-Za-z_][\\w-]*)/g, (_, name) => {classes[name]=prefix+name;return '.'+prefix+name;});
  return 'const style=document.createElement("style");style.textContent=' + JSON.stringify(css) + ';document.head.appendChild(style);module.exports=' + JSON.stringify(classes) + ';';
};`);
await fs.writeFile(path.join(temporary, "link.tsx"), `import React from 'react'; export default function Link({href,children,prefetch,replace,scroll,...props}) {return <a href={href} {...props}>{children}</a>;}`);
await fs.writeFile(path.join(temporary, "image.tsx"), `import React from 'react'; export default function Image({fill,unoptimized,sizes,...props}) {return <img {...props} style={fill?{position:'absolute',width:'100%',height:'100%',inset:0}:undefined}/>;}`);
await fs.writeFile(path.join(temporary, "navigation.ts"), `export function usePathname(){return '/courses/1/flashcards';} export function useRouter(){return {push(href){location.assign(href)},refresh(){location.reload()},replace(href){location.replace(href)}};}`);
await fs.writeFile(path.join(temporary, "entry.tsx"), `import React from 'react'; import {createRoot} from 'react-dom/client';
  import MemberShell from ${js(path.join(root, "src/components/navigation/member-shell.tsx"))};
  import CourseFlashcards from ${js(path.join(root, "src/components/courses/course-flashcards.tsx"))};
  const admin = window.__ADMIN__; createRoot(document.getElementById('app')).render(<MemberShell user={{userId:admin?1:2,email:'fixture@example.test',fullName:admin?'Admin kiểm thử':'Học viên kiểm thử',role:admin?'admin':'user',targetLevel:'B1',currentStreak:2}}><CourseFlashcards data={window.__FIXTURE__} account={admin?'1:fixture':'2:fixture'} isAdmin={admin}/></MemberShell>);`);
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
const words = [
  {frontText:"commute",backText:"việc đi lại hằng ngày",exampleSentence:"My daily commute takes thirty minutes."},
  {frontText:"sustainable",backText:"bền vững",exampleSentence:"Cycling is a sustainable way to travel."},
  {frontText:"resident",backText:"cư dân",exampleSentence:"Local residents use the new electric buses."},
];
const vocabulary = {courseId:1,courseTitle:"Tiếng Anh trong cuộc sống",readingDecks:[
  {lessonId:7,title:"A Greener Way to Travel",difficultyLevel:"B1",contentVersion:"a".repeat(64),cards:words},
  {lessonId:8,title:"A Day at the Local Market",difficultyLevel:"B1",contentVersion:"b".repeat(64),cards:[{frontText:"bargain",backText:"món hời",exampleSentence:"I found a bargain at the market."},{frontText:"fresh",backText:"tươi",exampleSentence:"The fruit is fresh."}]},
]};
const decks = [{deckId:1,title:"Everyday Conversations",description:"Những từ và cụm từ hữu ích cho giao tiếp hằng ngày.",courseId:1,courseTitle:vocabulary.courseTitle,owner:1}];
const cards = new Map([[1, words.slice(0,2).map((card,index)=>({...card,cardId:index+1,deckId:1,intervalDays:0,repetition:0,nextReviewAt:null,updatedAt:"2026-11-14T00:00:00Z",isDue:true}))]]);
let nextDeck = 2, nextCard = 10;
const summary = (deck,owner) => ({...deck,cardCount:cards.get(deck.deckId).length,dueCount:deck.owner===owner?cards.get(deck.deckId).filter(card=>card.isDue).length:0,canEdit:deck.owner===owner,isAdminDeck:deck.owner===1});
const createDeck = (fields,owner,source=[]) => {
  const deck={deckId:nextDeck++,title:fields.title,description:fields.description||null,courseId:1,courseTitle:vocabulary.courseTitle,owner};
  decks.push(deck); cards.set(deck.deckId, source.map(card=>({...card,cardId:nextCard++,deckId:deck.deckId,intervalDays:0,repetition:0,nextReviewAt:null,updatedAt:"2026-11-14T00:00:00Z",isDue:true}))); return deck;
};
const json=(res,status,value)=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(status===204?undefined:JSON.stringify(value));};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,"http://127.0.0.1"),owner=(req.headers.referer||"").includes("admin=1")?1:2;
    if(url.pathname==="/app.js"){res.writeHead(200,{"Content-Type":"application/javascript"});return res.end(bundle);}
    const staticFile=path.resolve(root,"public","."+decodeURIComponent(url.pathname));
    if(staticFile.startsWith(path.join(root,"public")+path.sep)&&/\.(png|jpe?g|webp|svg)$/i.test(staticFile)){
      try{const bytes=await fs.readFile(staticFile),ext=path.extname(staticFile).slice(1).toLowerCase();res.writeHead(200,{"Content-Type":{png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",svg:"image/svg+xml"}[ext]});return res.end(bytes);}catch{}
    }
    if(url.pathname.startsWith("/api/")){
      let raw="";for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
      if(url.pathname==="/api/vocabulary")return json(res,200,{entries:[]});
      if(url.pathname==="/api/flashcards/decks"&&req.method==="GET")return json(res,200,decks.filter(deck=>deck.owner===1||deck.owner===owner).map(deck=>summary(deck,owner)));
      if(url.pathname==="/api/flashcards/decks"&&req.method==="POST")return json(res,201,summary(createDeck(body,owner),owner));
      const copiedReading=/^\/api\/learning\/courses\/1\/vocabulary\/(\d+)\/copy$/.exec(url.pathname);
      if(copiedReading){const source=vocabulary.readingDecks.find(deck=>deck.lessonId===Number(copiedReading[1]));return json(res,201,summary(createDeck({title:"Từ vựng · "+source.title},owner,source.cards),owner));}
      const deckRoute=/^\/api\/flashcards\/decks\/(\d+)(?:\/(copy|cards))?$/.exec(url.pathname);
      if(deckRoute){const deck=decks.find(deck=>deck.deckId===Number(deckRoute[1]));if(!deck)return json(res,404,{});
        if(deckRoute[2]==="copy")return json(res,201,summary(createDeck({title:deck.title+" (bản sao riêng)"},owner,cards.get(deck.deckId)),owner));
        if(deckRoute[2]==="cards"){const card={...body,cardId:nextCard++,deckId:deck.deckId,intervalDays:0,repetition:0,nextReviewAt:null,updatedAt:"2026-11-14T00:00:00Z",isDue:true};cards.get(deck.deckId).push(card);return json(res,201,card);}
        if(req.method==="PUT"){deck.title=body.title;deck.description=body.description;return json(res,200,summary(deck,owner));}
        return json(res,200,{deck:summary(deck,owner),cards:cards.get(deck.deckId)});
      }
      const review=/^\/api\/flashcards\/cards\/(\d+)\/review$/.exec(url.pathname);
      if(review){const card=[...cards.values()].flat().find(card=>card.cardId===Number(review[1]));card.repetition++;card.intervalDays=1;card.nextReviewAt="2026-11-15T00:00:00Z";card.isDue=false;return json(res,200,card);}
      return json(res,404,{title:"Fixture route not found"});
    }
    const admin=url.searchParams.get("admin")==="1",initial={vocabulary,decks:decks.filter(deck=>deck.owner===1||deck.owner===(admin?1:2)).map(deck=>summary(deck,admin?1:2))};
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
    res.end(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Course flashcards verification | LEWA</title><style>body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}button,input,select{font:inherit}a{text-decoration:none}</style></head><body><div id="app"></div><script>window.__FIXTURE__=${JSON.stringify(initial)};window.__ADMIN__=${admin}</script><script src="/app.js"></script></body></html>`);
  }catch(error){json(res,500,{title:String(error)});}
});
server.listen(4176,"127.0.0.1",()=>console.log("Course flashcards fixture: http://127.0.0.1:4176/courses/1/flashcards (add ?admin=1 for admin)"));
process.on("SIGINT",async()=>{server.close();const resolved=path.resolve(temporary);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith("englishlearning-course-flashcards-ui-"))await fs.rm(resolved,{recursive:true,force:true});process.exit(0);});
