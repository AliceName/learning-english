import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { backendRequestSignal, isBackendTimeout } from "@/lib/backend-request";

async function proxy(request: Request, context: {params: Promise<{path:string[]}>}) {
  const path = (await context.params).path.join("/");
  const method = request.method;
  const valid = path === "courses" && ["GET","POST"].includes(method) || /^courses\/[1-9]\d*$/.test(path) && ["GET","PUT"].includes(method)
    || /^courses\/[1-9]\d*\/lessons$/.test(path) && method === "POST" || /^courses\/[1-9]\d*\/lessons\/[1-9]\d*$/.test(path) && method === "PUT"
    || /^courses\/[1-9]\d*\/publish$/.test(path) && method === "POST" || path === "uploads" && method === "POST"
    || path === "pronunciation/ipa" && method === "POST";
  if (!valid) return Response.json({title:"Không tìm thấy API."},{status:404});
  if (method !== "GET" && !isSameOrigin(request)) return Response.json({title:"Nguồn yêu cầu không hợp lệ."},{status:403});
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({title:"Vui lòng đăng nhập."},{status:401});
  const upload = path === "uploads";
  const limit = upload ? 27 * 1024 * 1024 : 256 * 1024;
  if (Number(request.headers.get("content-length")) > limit) return Response.json({title:"Yêu cầu quá lớn."},{status:413});
  try {
    let body: BodyInit | undefined;
    if (method !== "GET") {
      if (upload) body = await request.formData();
      else { body = await request.text(); if (Buffer.byteLength(body) > limit) return Response.json({title:"Yêu cầu quá lớn."},{status:413}); }
    }
    const target = backendUrl(`/api/v1/admin/${path}`);
    if (method === "GET") target.search = new URL(request.url).search;
    const response = await fetch(target, {method,body,headers:{Authorization:`Bearer ${token}`,...(!upload && body ? {"Content-Type":"application/json"} : {})},cache:"no-store",signal:backendRequestSignal(request.signal)});
    return new Response(response.body,{status:response.status,headers:{"Content-Type":response.headers.get("content-type") ?? "application/json","Cache-Control":"no-store"}});
  } catch(error) {
    if (request.signal.aborted) return new Response(null,{status:499});
    return Response.json({title:isBackendTimeout(error)?"Máy chủ phản hồi quá lâu. Vui lòng thử lại.":"Không kết nối được máy chủ. Vui lòng thử lại."},{status:isBackendTimeout(error)?504:503});
  }
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
