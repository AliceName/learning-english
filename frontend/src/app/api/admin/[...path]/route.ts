import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { backendRequestSignal, isBackendTimeout } from "@/lib/backend-request";

const questionImportLimit = 2 * 1024 * 1024 + 64 * 1024;

async function readQuestionImportBody(request: Request): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const bytes = new Uint8Array(questionImportLimit);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return bytes.slice(0, offset).buffer;
      if (offset + value.length > bytes.length) {
        void reader.cancel().catch(() => {});
        return null;
      }
      bytes.set(value, offset);
      offset += value.length;
    }
  } finally {
    reader.releaseLock();
  }
}

async function proxy(request: Request, context: {params: Promise<{path:string[]}>}) {
  const path = (await context.params).path.join("/");
  const method = request.method;
  const questionImport = /^courses\/[1-9]\d*\/question-import\/preview$/.test(path) && method === "POST";
  const valid = path === "courses" && ["GET","POST"].includes(method) || /^courses\/[1-9]\d*$/.test(path) && ["GET","PUT"].includes(method)
    || /^courses\/[1-9]\d*\/lessons$/.test(path) && method === "POST" || /^courses\/[1-9]\d*\/lessons\/[1-9]\d*$/.test(path) && method === "PUT"
    || /^courses\/[1-9]\d*\/(publish|hide)$/.test(path) && method === "POST" || path === "uploads" && method === "POST"
    || path === "pronunciation/ipa" && method === "POST" || questionImport;
  if (!valid) return Response.json({title:"Không tìm thấy API."},{status:404});
  if (method !== "GET" && !isSameOrigin(request)) return Response.json({title:"Nguồn yêu cầu không hợp lệ."},{status:403});
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({title:"Vui lòng đăng nhập."},{status:401});
  const upload = path === "uploads";
  const limit = upload ? 27 * 1024 * 1024 : questionImport ? questionImportLimit : 256 * 1024;
  if (Number(request.headers.get("content-length")) > limit) return Response.json({title:"Yêu cầu quá lớn."},{status:413});
  try {
    let body: BodyInit | undefined;
    let contentType = "application/json";
    if (method !== "GET") {
      if (questionImport) {
        contentType = request.headers.get("content-type") ?? "";
        if (!/^multipart\/form-data\s*;/i.test(contentType))
          return Response.json({title:"Chọn tệp Word để nhập câu hỏi."},{status:415});
        const bytes = await readQuestionImportBody(request);
        if (!bytes) return Response.json({title:"Yêu cầu quá lớn."},{status:413});
        body = bytes;
      } else if (upload) {
        const form = await request.formData();
        let size = 0;
        for (const value of form.values()) size += typeof value === "string" ? Buffer.byteLength(value) : value.size;
        if (size > limit) return Response.json({title:"Yêu cầu quá lớn."},{status:413});
        body = form;
      }
      else { body = await request.text(); if (Buffer.byteLength(body) > limit) return Response.json({title:"Yêu cầu quá lớn."},{status:413}); }
    }
    const target = backendUrl(`/api/v1/admin/${path}`);
    if (method === "GET") target.search = new URL(request.url).search;
    const cloudOperation = upload || path.endsWith("/publish") || method === "PUT" || path.endsWith("/lessons");
    const response = await fetch(target, {method,body,headers:{Authorization:`Bearer ${token}`,...(!upload && body ? {"Content-Type":contentType} : {})},cache:"no-store",signal:cloudOperation ? AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]) : backendRequestSignal(request.signal)});
    const headers = new Headers({"Content-Type":response.headers.get("content-type") ?? "application/json","Cache-Control":"no-store"});
    const retry = response.headers.get("retry-after"); if (retry) headers.set("Retry-After", retry);
    if (response.status === 404 && (questionImport || /^courses\/[1-9]\d*\/(publish|hide)$/.test(path))) {
      const body = await response.text();
      if (!body.trim()) return Response.json({
        title:questionImport
          ? "Backend đang chạy phiên bản chưa có API nhập câu hỏi. Hãy cập nhật và khởi động lại API rồi thử lại."
          : "Backend đang chạy phiên bản chưa có API ẩn/hiện khóa học. Vui lòng build và khởi động lại API rồi thử lại.",
        code:"backend_endpoint_unavailable"
      }, {status:503,headers:{"Cache-Control":"no-store"}});
      return new Response(body,{status:response.status,headers});
    }
    return new Response(response.body,{status:response.status,headers});
  } catch(error) {
    if (request.signal.aborted) return new Response(null,{status:499});
    return Response.json({title:isBackendTimeout(error)?"Máy chủ phản hồi quá lâu. Vui lòng thử lại.":"Không kết nối được máy chủ. Vui lòng thử lại."},{status:isBackendTimeout(error)?504:503});
  }
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
