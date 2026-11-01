import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),ts=require("typescript");
const file=new URL("../src/app/api/admin/[...path]/route.ts",import.meta.url);
const compiled=ts.transpileModule(await fs.readFile(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let token="test-cookie",calls=[],response=()=>Response.json({isPublished:false});
const imports={
  "next/headers":{cookies:async()=>({get:()=>token?{value:token}:undefined})},
  "@/lib/server-auth":{SESSION_COOKIE:"linguaai_session",backendUrl:path=>new URL(path,"http://backend.test"),isSameOrigin:request=>!request.headers.get("origin")||request.headers.get("origin")===new URL(request.url).origin},
  "@/lib/backend-request":{backendRequestSignal:value=>value,isBackendTimeout:error=>error?.name==="TimeoutError"}
};
const exports={};
vm.runInNewContext(compiled,{exports,require:name=>{assert.ok(imports[name],name);return imports[name];},Request,Response,Headers,FormData,Blob,File,URL,Buffer,AbortSignal,
  fetch:async(url,init)=>{calls.push({url,init});return response();}});
const context=path=>({params:Promise.resolve({path:path.split("/")})});
async function call(path,method="POST",headers={}) {
  return exports[method](new Request(`http://frontend.test/api/admin/${path}`,{method,headers}),context(path));
}
token="";assert.equal((await call("courses/1/hide")).status,401);assert.equal(calls.length,0);
token="test-cookie";assert.equal((await call("courses/1/hide","POST",{origin:"https://other.test"})).status,403);assert.equal(calls.length,0);
assert.equal((await call("courses/1/hide","GET")).status,404);assert.equal((await call("courses/1/hide","PUT")).status,404);
assert.equal((await call("courses/0/hide")).status,404);assert.equal(calls.length,0);
let result=await call("courses/1/hide");assert.equal(result.status,200);assert.equal((await result.json()).isPublished,false);
assert.equal(String(calls.at(-1).url),"http://backend.test/api/v1/admin/courses/1/hide");assert.equal(calls.at(-1).init.method,"POST");
assert.equal(calls.at(-1).init.headers.Authorization,"Bearer test-cookie");assert.equal(result.headers.get("authorization"),null);assert.equal(result.headers.get("cache-control"),"no-store");
response=()=>Response.json({isPublished:true});result=await call("courses/1/publish");assert.equal((await result.json()).isPublished,true);
response=()=>Response.json({title:"Content incomplete"},{status:400});assert.equal((await call("courses/1/publish")).status,400);
response=()=>Response.json({title:"Role revoked"},{status:403});assert.equal((await call("courses/1/hide")).status,403);
response=()=>new Response(null,{status:404});result=await call("courses/1/hide");assert.equal(result.status,503);assert.equal((await result.json()).code,"backend_endpoint_unavailable");assert.equal(result.headers.get("cache-control"),"no-store");
response=()=>Response.json({title:"Course not found"},{status:404});result=await call("courses/1/hide");assert.equal(result.status,404);assert.equal((await result.json()).title,"Course not found");
response=()=>Response.json({title:"Media unavailable"},{status:503,headers:{"Retry-After":"10"}});result=await call("courses/1/publish");assert.equal(result.status,503);assert.equal(result.headers.get("retry-after"),"10");
response=()=>{throw new DOMException("Timeout","TimeoutError");};assert.equal((await call("courses/1/publish")).status,504);
console.log("Course-management proxy checks passed: session, origin, paths/methods, hide/show, bearer isolation, validation/role/retry/timeout responses.");
