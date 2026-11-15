import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";

const guid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

async function boundedBody(request: Request, limit: number) {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const bytes = new Uint8Array(limit);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return bytes.slice(0, length).buffer;
      if (length + value.length > limit) { void reader.cancel().catch(() => {}); return null; }
      bytes.set(value, length); length += value.length;
    }
  } finally { reader.releaseLock(); }
}

async function proxy(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const path = ((await context.params).path ?? []).join("/");
  const method = request.method;
  const valid = !path && ["GET", "POST"].includes(method)
    || path === "options" && method === "GET"
    || new RegExp(`^${guid}$`, "i").test(path) && method === "GET"
    || new RegExp(`^${guid}/outline$`, "i").test(path) && method === "PUT"
    || new RegExp(`^${guid}/(generate|retry|activate)$`, "i").test(path) && method === "POST"
    || new RegExp(`^${guid}/(source|audio/${guid})$`, "i").test(path) && method === "GET";
  if (!valid) return Response.json({ title: "Không tìm thấy API." }, { status: 404 });
  if (method !== "GET" && !isSameOrigin(request)) return Response.json({ title: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập lại." }, { status: 401 });
  const create = !path && method === "POST";
  const limit = create ? 10 * 1024 * 1024 + 65536 : 65536;
  if (Number(request.headers.get("content-length")) > limit) return Response.json({ title: "Tài liệu tối đa 10 MB." }, { status: 413 });
  try {
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    let body: ArrayBuffer | undefined;
    if (method !== "GET") {
      const type = request.headers.get("content-type") ?? "";
      if (create && !/^multipart\/form-data\s*;/i.test(type)) return Response.json({ title: "Chọn tài liệu PDF hoặc DOCX." }, { status: 415 });
      const bytes = await boundedBody(request, limit);
      if (!bytes) return Response.json({ title: "Yêu cầu quá lớn." }, { status: 413 });
      body = bytes;
      if (type) headers.set("Content-Type", type);
      const key = request.headers.get("idempotency-key");
      if (key) headers.set("Idempotency-Key", key);
    }
    const range = request.headers.get("range");
    if (range) headers.set("Range", range);
    const target = backendUrl(`/api/v1/ai-course-generations${path ? "/" + path : ""}`);
    const response = await fetch(target, { method, body, headers, cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]) });
    const output = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "retry-after"])
      if (response.headers.has(key)) output.set(key, response.headers.get(key)!);
    if (response.status === 404 && (!path || path === "options")) {
      await response.body?.cancel();
      return Response.json({ title: "Backend đang chạy chưa có API tạo khóa học AI. Hãy khởi động lại backend phiên bản mới.", code: "backend_endpoint_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return new Response(response.body, { status: response.status, headers: output });
  } catch {
    return Response.json({ title: "Chưa kết nối được máy chủ. Hãy thử lại; lượt tạo đã nhận vẫn được lưu." }, { status: request.signal.aborted ? 499 : 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
