import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { backendRequestSignal, isBackendTimeout } from "@/lib/backend-request";

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join("/");
  const match = /^courses\/([1-9]\d*)\/lessons\/([1-9]\d*)\/listening(?:\/(start|position|submissions|transcript|results(?:\/[1-9]\d*)?))?$/.exec(path);
  const operation = match?.[3] ?? "";
  const method = request.method;
  const valid = match && Number(match[1]) <= 2147483647 && Number(match[2]) <= 2147483647 &&
    (method === "GET" && (operation === "" || operation === "transcript" || operation.startsWith("results")) ||
      method === "POST" && (operation === "start" || operation === "submissions") || method === "PUT" && operation === "position");
  const headers = { "Cache-Control": "private, no-store" };
  if (!valid) return Response.json({ title: "Không tìm thấy API." }, { status: 404, headers });
  if (method !== "GET" && !isSameOrigin(request)) return Response.json({ title: "Nguồn yêu cầu không hợp lệ." }, { status: 403, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập." }, { status: 401, headers });
  const limit = 128 * 1024;
  if (Number(request.headers.get("content-length")) > limit) return Response.json({ title: "Yêu cầu quá lớn." }, { status: 413, headers });
  try {
    let body: string | undefined;
    if (method !== "GET" && request.body) {
      const reader = request.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) { await reader.cancel(); return Response.json({ title: "Yêu cầu quá lớn." }, { status: 413, headers }); }
        chunks.push(chunk.value);
      }
      body = Buffer.concat(chunks).toString("utf8");
      if (!body) body = undefined;
    }
    const target = backendUrl(`/api/v1/${path}`);
    if (method === "GET") target.search = new URL(request.url).search;
    const response = await fetch(target, { method, body, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      cache: "no-store", signal: backendRequestSignal(request.signal) });
    return new Response(response.body, { status: response.status, headers: { ...headers, "Content-Type": response.headers.get("content-type") ?? "application/json" } });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    return Response.json({ title: isBackendTimeout(error) ? "Máy chủ phản hồi quá lâu. Vui lòng thử lại." : "Không kết nối được máy chủ. Vui lòng thử lại." },
      { status: isBackendTimeout(error) ? 504 : 503, headers });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
