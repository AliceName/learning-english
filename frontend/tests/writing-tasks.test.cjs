const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), ts=require('typescript');
function load(file,deps={},globals={}) {
  const module={exports:{}};
  const filename=path.join(__dirname,'../src',file);
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,URL,URLSearchParams,Request,Response,AbortSignal,
    require(name){if(Object.hasOwn(deps,name))return deps[name];if(name.startsWith('./'))return load('lib/'+name.slice(2)+'.ts');throw Error(name);},...globals},{filename});return module.exports;
}
const writing=load('lib/writing.ts'), drafts=load('lib/writing-draft.ts'), returns=load('lib/writing-return.ts');
const task={id:'11111111-1111-4111-8111-111111111111',version:'a'.repeat(64),title:'Đề kiểm thử',prompt:'x'.repeat(510)+" ’ 😀 <script>alert(1)</script>",
 level:'Beginner',genre:'An email',topic:'Synthetic',minWords:25,maxWords:25,wordMode:'minimum',requirements:['Choose TWO of FOUR ideas, not all four.'],sourceSha256:'b'.repeat(64),sourcePromptSha256:'c'.repeat(64),reviewStatus:'automated-reviewed-not-expert'};
const storage=()=>{const m=new Map();return {m,getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('catalogue validates full Unicode prompt, unique IDs, ranges and explicit review state',()=>{
 const c={items:[task],sourceCount:50,version:'d'.repeat(64)};
 assert.equal(writing.isWritingTaskCatalogue(c),true);assert.equal(writing.isWritingTaskCatalogue({...c,items:[task,task]}),false);
 for(const change of [{maxWords:1},{requirements:[]},{reviewStatus:'certified'},{level:'A2'},{sourceSha256:'bad'}]) assert.equal(writing.isWritingTask({...task,...change}),false);
 assert.match(writing.taskWordGuidance(task),/ít nhất 25/);assert.match(writing.taskWordGuidance({...task,wordMode:'metadata',minWords:50,maxWords:200}),/Độ dài gợi ý/);
});
test('new task drafts, self-checks and login adoption are isolated by task and owner',()=>{
 const s=storage(), second={...task,id:'22222222-2222-4222-8222-222222222222'};
 const input=t=>({task:t,topic:t.title,text:'An English draft.',corrections:false,baseSubmissionId:null,checkedRequirements:[0]});
 assert.equal(drafts.saveWritingDraft(s,null,input(task),1),true);assert.equal(drafts.saveWritingDraft(s,null,input(second),2),true);
 assert.equal(drafts.adoptAnonymousWritingDraft(s,7,null,3,task.id),true);
 assert.equal(drafts.loadWritingDraft(s,7,null,task.id).task.prompt,task.prompt);
 assert.equal(drafts.loadWritingDraft(s,7,null,task.id).checkedRequirements[0],0);
 assert.equal(drafts.loadWritingDraft(s,8,null,task.id),null);assert.equal(drafts.loadWritingDraft(s,null,null,task.id),null);
 assert.equal(drafts.loadWritingDraft(s,null,null,second.id).task.id,second.id);
 assert.equal(drafts.saveWritingDraft(s,7,{...input(task),checkedRequirements:[1]}),false);
});
test('version-one custom drafts remain readable and corrupt optional task metadata is refused',()=>{
 const s=storage(); s.setItem('linguaai:writing-draft:v1:user:7:new',JSON.stringify({version:1,owner:7,topic:'Legacy',text:'Old draft.',corrections:false,baseSubmissionId:null,updatedAt:1}));
 assert.equal(drafts.loadWritingDraft(s,7,null).topic,'Legacy');
 assert.equal(drafts.saveWritingDraft(s,7,{topic:'x',text:'Draft',corrections:false,baseSubmissionId:null,task:{...task,version:'bad'}}),false);
});
test('task and custom auth return paths retain strict redirect restrictions',()=>{
 assert.equal(returns.safeWritingReturnTo('/writing?taskId='+task.id),'/writing?taskId='+task.id);
 assert.equal(returns.writingReturnTaskId('/writing?taskId='+task.id),task.id);
 assert.equal(returns.safeWritingReturnTo('/writing?custom=1'),'/writing?custom=1');
 assert.equal(returns.safeWritingReturnTo('/writing?taskId='+task.id+'&next=https://evil.test'),'/account');
});
test('new submissions BFF forwards references, rejects supplied snapshots before upstream',async()=>{
 const calls=[];
 const route=load('app/api/writing/submissions/route.ts',{'next/headers':{cookies:async()=>({get:()=>({value:'private-token'})})},
 '@/lib/server-auth':{SESSION_COOKIE:'session',backendUrl:p=>new URL(p,'http://localhost:5000'),isSameOrigin:()=>true},'@/lib/writing-capabilities':load('lib/writing-capabilities.ts'),'@/lib/writing':writing},
 {fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({saved:true},{status:201});}});
 const body={taskId:task.id,taskVersion:task.version,originalText:'An English sentence.',corrections:false};
 assert.equal((await route.POST(new Request('http://localhost/api/writing/submissions',{method:'POST',body:JSON.stringify(body)}))).status,201);
 assert.equal(calls[0].taskId,task.id);assert.equal(Object.hasOwn(calls[0],'task'),false);
 assert.equal((await route.POST(new Request('http://localhost/api/writing/submissions',{method:'POST',body:JSON.stringify({...body,task})}))).status,400);assert.equal(calls.length,1);
 const post=(patch)=>route.POST(new Request('http://localhost/api/writing/submissions',{method:'POST',body:JSON.stringify({...body,...patch})}));
 const requestId='26a9eedc-3be4-4c01-8b2b-286965e4b62e';
 assert.equal((await post({requestId})).status,201);
 assert.equal(Object.hasOwn(calls[1],"targetCefr"),false);assert.equal(calls[1].requestId,requestId);
 assert.equal((await post({targetCefr:'C1',requestId})).status,400);
 assert.equal((await post({requestId:'bad'})).status,400);
});
test('new metadata cannot attach a future parent or mismatched root to a result',()=>{
 const r={submissionId:10,topic:task.title,originalText:'Text',cefrLevel:'B1',correctedText:null,errors:[],warnings:[],createdAt:new Date().toISOString(),task,practiceRootId:1,parentSubmissionId:9};
 assert.equal(writing.isWritingResult(r),true);assert.equal(writing.isWritingResult({...r,parentSubmissionId:11}),false);assert.equal(writing.isWritingResult({...r,practiceRootId:10}),false);
 const version={...r,versionNumber:4,parentVersionNumber:1,targetCefr:'B2',targetRecorded:true};
 assert.equal(writing.isWritingResult(version),true);
 assert.equal(writing.isWritingResult({...version,parentVersionNumber:4}),false);
 assert.equal(writing.isWritingResult({...version,targetRecorded:false}),false);
 assert.equal(writing.isWritingResult({...version,cefrLevel:''}),true);
});

test('source drafts ignore old target overrides and keep retry key, text and review across reload', () => {
 const s=storage();
 const unchanged={topic:'Same topic',text:'First source draft.',corrections:true,baseSubmissionId:3,targetCefr:null,
   continued:true,requestId:'26a9eedc-3be4-4c01-8b2b-286965e4b62e',review:[{id:'0:1',status:'accepted'}]};
 assert.equal(drafts.saveWritingDraft(s,7,unchanged),true);
 assert.equal(drafts.saveWritingDraft(s,7,{...unchanged,baseSubmissionId:9,text:'Other source draft.',targetCefr:'C1',requestId:undefined,review:[]}),true);
 const reopened=drafts.loadWritingDraft(s,7,3);
 assert.equal(reopened.targetCefr,undefined);assert.equal(reopened.requestId,unchanged.requestId);
 assert.equal(reopened.text,unchanged.text);assert.equal(reopened.continued,true);assert.equal(reopened.review[0].id,'0:1');
 assert.equal(drafts.loadWritingDraft(s,7,9).targetCefr,undefined);
 assert.equal(drafts.loadWritingDraft(s,8,3),null);
});

test('login preserves the previous task version even when essay text is identical',()=>{
 const s=storage(), oldTask={...task,version:'f'.repeat(64)};
 const input=t=>({task:t,topic:t.title,text:'Same essay.',corrections:false,baseSubmissionId:null,checkedRequirements:[]});
 drafts.saveWritingDraft(s,7,input(oldTask),1); drafts.saveWritingDraft(s,null,input(task),2);
 assert.equal(drafts.adoptAnonymousWritingDraft(s,7,null,3,task.id),true);
 assert.equal(drafts.loadWritingDraft(s,7,null,task.id).task.version,task.version);
 assert.equal(drafts.loadPreviousWritingDraft(s,7,null,task.id)?.task.version,oldTask.version);
 assert.equal(drafts.restorePreviousWritingDraft(s,7,null,task.id)?.task.version,oldTask.version);
});

test('login retains previous self-checks without exposing the draft to another account',()=>{
 const s=storage(), input=checkedRequirements=>({task,topic:task.title,text:'Same essay.',corrections:false,baseSubmissionId:null,checkedRequirements});
 drafts.saveWritingDraft(s,7,input([0]),1);drafts.saveWritingDraft(s,null,input([]),2);
 assert.equal(drafts.adoptAnonymousWritingDraft(s,7,null,3,task.id),true);
 assert.equal(drafts.loadPreviousWritingDraft(s,7,null,task.id)?.checkedRequirements[0],0);
 assert.equal(drafts.loadPreviousWritingDraft(s,8,null,task.id),null);
});

test('catalogue proxy handles offline, HTTP failure and malformed data using mocked upstream only',async()=>{
 for(const fetch of [async()=>{throw new TypeError('offline');},async()=>Response.json({secret:'internal error'},{status:500}),async()=>Response.json({items:[task]})]){
  const route=load('app/api/writing/tasks/route.ts',{'@/lib/server-auth':{backendUrl:p=>new URL(p,'http://mock.invalid'),isSameOrigin:()=>true},'@/lib/writing':writing},{fetch});
  const response=await route.GET(new Request('http://localhost/api/writing/tasks'));
  assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
  const text=await response.text();assert.match(text,/Bản nháp vẫn được giữ/);assert.equal(text.includes('internal error'),false);
 }
});

test('catalogue proxy rejects a foreign origin without making a request',async()=>{
 let calls=0;
 const route=load('app/api/writing/tasks/route.ts',{'@/lib/server-auth':{backendUrl:p=>p,isSameOrigin:()=>false},'@/lib/writing':writing},
  {fetch:async()=>{calls++;throw Error('must not run');}});
 assert.equal((await route.GET(new Request('http://localhost/api/writing/tasks'))).status,403);assert.equal(calls,0);
});
