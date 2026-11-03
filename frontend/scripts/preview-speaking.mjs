// Isolated UI fixture. Uses the real components, mocked fetch/microphone and a
// public dataset WAV. No login, SQL writes, microphone capture or external calls.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const wordColors = process.argv.includes("--word-colors");
const phrasePreview = process.argv.includes("--phrases");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".next", "speaking-preview");
fs.mkdirSync(output, { recursive: true });
const report = JSON.parse(fs.readFileSync(path.join(root, "../backend/reports/speaking-score-calibration/live-after.json"), "utf8"));
const cases = [report.realDatasetSample, ...report.samples.slice(0, 2)];
const audio = fs.readFileSync(report.realDatasetSample.audioSource);
const lesson = { lessonId: 1, courseId: 1, title: "Luyện nói theo câu", courseTitle: "Speaking · bản kiểm thử",
  goals: "Nghe mẫu, đọc câu và luyện lại theo phản hồi.", maxRecordingSeconds: 12, maxAudioBytes: 2097152,
  sentences: cases.map(item => ({ text: item.text, ipa: null, audioUrl: null })) };
if (phrasePreview) {
  // Literal API-shaped fixture; the product gets these splits from the server.
  lesson.sentences = [{ text: 'There is probably titanium in your eyeglass frames .', ipa: null, audioUrl: null },
    { text: 'We call it bear in the forest', ipa: null, audioUrl: null }];
  lesson.segmentationVersion = 'phrase-v1';
  lesson.segments = [[{ index: 0, text: 'There is probably titanium', startWordIndex: 0, wordCount: 4 },
    { index: 1, text: 'in your eyeglass frames .', startWordIndex: 4, wordCount: 4 }],
    [{ index: 0, text: 'We call it bear', startWordIndex: 0, wordCount: 4 },
      { index: 1, text: 'in the forest', startWordIndex: 4, wordCount: 3 }]];
}
const assessment = structuredClone(cases[0].result);
assessment.words[0].phones[0].score = assessment.words[0].phones[0].rawScore = .85;
for (const word of assessment.words) if (word.phones.length) word.score = word.phones.reduce((n, phone) => n + phone.score, 0) / word.phones.length;
assessment.overallScore = assessment.words.flatMap(word => word.phones).reduce((n, phone) => n + phone.score, 0) / assessment.words.flatMap(word => word.phones).length * 50;
assessment.feedback = "Phản hồi giả lập: ưu tiên nghe mẫu và luyện lại từ We; phần chưa hỗ trợ chưa được đánh giá.";
const base = { attemptId: 1, lessonId: 1, sentenceIndex: 0, referenceText: cases[0].text, createdAt: "2026-10-27T10:00:00Z", audioUrl: "/fixture.wav", assessment };

const loader = path.join(output, "typescript-loader.cjs");
fs.writeFileSync(loader, `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
const cssLoader = path.join(output, "css-loader.cjs");
fs.writeFileSync(cssLoader, `module.exports=function(source){const names=Object.fromEntries([...source.matchAll(/\\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)].map(match=>[match[1],match[1]]));return 'const style=document.createElement("style");style.textContent='+JSON.stringify(source)+';document.head.appendChild(style);export default '+JSON.stringify(names)+';';};`);
fs.writeFileSync(path.join(output, "link.tsx"), 'export default function Link(props) { return <a {...props} />; }');
fs.writeFileSync(path.join(output, "entry.tsx"), `
import { createRoot } from "react-dom/client";
import { useState } from "react";
import SpeakingPractice from "@/components/speaking/speaking-practice";
import PronunciationFeedback from "@/components/speaking/pronunciation-feedback";
const lesson=${JSON.stringify(lesson)};
const base=${JSON.stringify(base)};
const cases=${JSON.stringify(cases.map(item => item.result))};
const phrasePreview=${JSON.stringify(phrasePreview)};
function fixtureAssessment(text){
  const words=(text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)||[]).map((text,index)=>({index,text,status:'scored',score:index===0?.9:index===1?1.3:1.8,
    phones:[{sourcePhone:'P',symbol:'p',score:index===0?.9:index===1?1.3:1.8,startSeconds:index*.2,endSeconds:index*.2+.1}],reason:null}));
  return {...base.assessment,modelVersion:'fixture-model',status:'scored',coverage:1,referenceTokenCount:words.length,words,warnings:[],
    overallScore:words.reduce((total,word)=>total+word.score,0)/words.length*50,feedback:'Kết quả giả lập để kiểm tra thao tác luyện cụm.'};
}
let history=[base], posts=0, gets=0;
if(phrasePreview) history=[{...base,referenceText:lesson.sentences[0].text,assessment:fixtureAssessment(lesson.sentences[0].text),scope:null}];
window.fetch=async (url,options={})=>{
  if(options.method==='POST'){
    if(++posts===1)return Response.json({title:'Lỗi bộ chấm giả lập. Bản ghi vẫn còn để thử lại.'},{status:503});
    const index=Number(options.body.get('sentenceIndex'));
    const segmentField=options.body.get('segmentIndex');
    const segment=segmentField===null?null:lesson.segments?.[index]?.[Number(segmentField)];
    if(segmentField!==null&&!segment)return Response.json({title:'Cụm không hợp lệ'},{status:400});
    const text=segment?segment.text:lesson.sentences[index].text;
    const scope=segment?{kind:'segment',segmentIndex:segment.index,startWordIndex:segment.startWordIndex,wordCount:segment.wordCount,sentenceText:lesson.sentences[index].text,segmentationVersion:lesson.segmentationVersion}:null;
    const item={...base,attemptId:posts,sentenceIndex:index,referenceText:text,scope,createdAt:new Date().toISOString(),assessment:phrasePreview?fixtureAssessment(text):structuredClone(index===0?base.assessment:cases[index])};
    history=[item,...history];return Response.json(item,{status:201});
  }
  if(++gets===1)return Response.json({title:'Lỗi lịch sử giả lập'},{status:503});
  return Response.json(history);
};
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
  if(!phrasePreview)throw new DOMException('Fixture microphone denied','NotAllowedError');
  // Real WebAudio/worklet/encoding, with a synthetic tone instead of a real mic.
  const context=new AudioContext(), destination=context.createMediaStreamDestination();
  const oscillator=context.createOscillator(), gain=context.createGain();
  oscillator.connect(gain);gain.connect(destination);gain.gain.value=.2;
  gain.gain.setValueAtTime(0,context.currentTime+.65);oscillator.start();await context.resume();
  const track=destination.stream.getAudioTracks()[0], stop=track.stop.bind(track);
  track.stop=()=>{stop();oscillator.stop();void context.close();};
  return destination.stream;
}}});
document.body.style.margin='0';
function ColorPreview(){
  const [mode,setMode]=useState('normal');
  const text='There is probably titanium in your eyeglass frames .';
  const scores=[1.9,1.3,.8,1.9,1,1.8,1.2,null];
  const words=text.split(' ').slice(0,8).map((text,index)=>({index,text,status:index===7?'unsupported':'scored',score:scores[index],
    phones:index===7?[]:[0,1].map(i=>({sourcePhone:i?'AH':'P',symbol:i?'ə':'p',score:scores[index],startSeconds:index*.2,endSeconds:index*.2+.1})),
    reason:index===3?'Chỉ chấm được một phần âm của từ.':index===7?'Âm tham chiếu chưa hỗ trợ.':null}));
  const item={...base,referenceText:text,assessment:{...base.assessment,words,coverage:mode==='limited_coverage'?.7:.875,referenceTokenCount:16,
    interpretation:{...base.assessment.interpretation,practiceThreshold:1.1,reviewThreshold:1.5,feedbackMode:mode}}};
  return <main style={{maxWidth:1000,margin:'32px auto',padding:'0 18px',fontFamily:'Arial,sans-serif'}}><h1>Màu từng từ · kiểm thử giao diện</h1><p>Kết quả bên dưới là giả lập để kiểm tra màu, không phải điểm phát âm thật.</p><nav aria-label="Chọn trạng thái bản ghi" style={{display:'flex',gap:10,flexWrap:'wrap'}}>{[['normal','Bản ghi ổn định'],['limited_coverage','Chấm một phần câu'],['record_again','Cần ghi âm lại']].map(([value,label])=><button key={value} aria-pressed={mode===value} onClick={()=>setMode(value)} style={{padding:'10px 14px',border:'1px solid #ccc',borderRadius:8,background:mode===value?'#e6e1ff':'white'}}>{label}</button>)}</nav><PronunciationFeedback attempt={item} disabled={true} canRetry={true} rate={.75} onBeforePlay={()=>{}} onListenRecording={()=>{}} onRetry={()=>{}}/></main>;
}
createRoot(document.getElementById('root')).render(<>{${JSON.stringify(wordColors)}?<ColorPreview/>:<SpeakingPractice lesson={lesson} initialHistory={history} historyUnavailable={false}/>}<div style={{position:'fixed',bottom:8,right:8,padding:'7px 12px',background:'#25243c',color:'white',fontSize:11,borderRadius:8,zIndex:100}}>BẢN KIỂM THỬ · ${phrasePreview ? "âm thanh tổng hợp · " : ""}kết quả giả lập · không lưu tài khoản</div></>);
`);
const webpack = require("next/dist/compiled/webpack/webpack").webpack;
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: "development", devtool: false, context: root, target: "web",
    entry: path.join(output, "entry.tsx"), output: { path: output, filename: "bundle.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], alias: { "@": path.join(root, "src"), "next/link$": path.join(output, "link.tsx") } },
    module: { rules: [{ test: /\.tsx?$/, use: loader }, { test: /\.css$/, use: cssLoader }] } });
  compiler.run((error, stats) => compiler.close(() => {
    if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true })));
    else resolve();
  }));
});
const bundle = fs.readFileSync(path.join(output, "bundle.js"));
http.createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle); }
  else if (request.url === "/audio/pcm-recorder.js") { response.setHeader("Content-Type", "text/javascript"); response.end(fs.readFileSync(path.join(root, "public/audio/pcm-recorder.js"))); }
  else if (request.url === "/fixture.wav") { response.setHeader("Content-Type", "audio/wav"); response.end(audio); }
  else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end('<!doctype html><html lang="vi"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Speaking · kiểm thử giao diện</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
}).listen(3307, "127.0.0.1", () => console.log("Isolated Speaking fixture: http://127.0.0.1:3307 (mock data; no SQL writes)"));
