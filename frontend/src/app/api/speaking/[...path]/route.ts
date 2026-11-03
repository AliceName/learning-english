import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";

const MAX_BODY = 2 * 1024 * 1024 + 65536;
async function readLimited(request: Request): Promise<ArrayBuffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new RangeError("missing body");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY) { await reader.cancel(); throw new RangeError("too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data.buffer;
}
async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join("/");
  const recording = /^recordings\/[a-f0-9]{32}\.wav$/.test(path);
  const allowed = request.method === "POST" && (path === "attempts" || path === "free/score") || request.method === "GET" &&
    (/^lessons\/[1-9]\d*(\/attempts)?$/.test(path) || /^attempts\/[1-9]\d*$/.test(path) || recording);
  if (!allowed) return Response.json({ title: "Không tìm thấy API." }, { status: 404 });
  if (request.method === "POST" && !isSameOrigin(request)) return Response.json({ title: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập lại." }, { status: 401 });
  try {
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    let body: ArrayBuffer | undefined;
    if (request.method === "POST") {
      const type = request.headers.get("content-type") ?? "";
      if (!type.toLowerCase().startsWith("multipart/form-data;")) return Response.json({ title: "Cần gửi bản ghi dạng tệp." }, { status: 400 });
      if (Number(request.headers.get("content-length")) > MAX_BODY) throw new RangeError("too large");
      body = await readLimited(request); headers.set("Content-Type", type);
    }
    if (recording && request.headers.has("range")) headers.set("Range", request.headers.get("range")!);
    const upstream = await fetch(backendUrl(`/api/v1/speaking/${path}`), { method: request.method, body, headers,
      cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(65_000)]) });
    const output = new Headers({ "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    if (recording) for (const name of ["content-range", "accept-ranges", "content-length"]) if (upstream.headers.has(name)) output.set(name, upstream.headers.get(name)!);
    return new Response(upstream.body, { status: upstream.status, headers: output });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (error instanceof RangeError) return Response.json({ title: "Bản ghi tối đa 2 MB." }, { status: 413 });
    return Response.json({ title: "Chưa kết nối được bộ chấm. Vui lòng thử lại." }, { status: 503 });
  }
}
export const GET = proxy;
export const POST = proxy;
