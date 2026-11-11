import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";

const maxBody = 8192;
const responseHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  const { operation } = await context.params;
  const path = operation === "next" ? "prompts/next" : operation === "grade" ? "grade" : null;
  if (!path) return error(404, "Không tìm thấy API.");
  if (!isSameOrigin(request)) return error(403, "Nguồn yêu cầu không hợp lệ.");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return error(401, "Vui lòng đăng nhập lại.");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return error(415, "Yêu cầu cần có định dạng JSON.");
  if (!request.body) return error(400, "Thiếu nội dung yêu cầu.");
  if (Number(request.headers.get("content-length")) > maxBody) return error(413, "Nội dung quá dài.");

  try {
    const reader = request.body.getReader();
    const body = new Uint8Array(maxBody);
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.length > maxBody) {
          await reader.cancel();
          return error(413, "Nội dung quá dài.");
        }
        body.set(value, size);
        size += value.length;
      }
    } finally { reader.releaseLock(); }

    const upstream = await fetch(backendUrl(`/api/v1/translation-practice/${path}`), {
      method: "POST",
      body: body.subarray(0, size),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(40_000)]),
    });
    const headers = new Headers(responseHeaders);
    headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) headers.set("Retry-After", retryAfter);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499, headers: responseHeaders });
    return error(503, "Chưa kết nối được với tính năng luyện dịch. Vui lòng thử lại.");
  }
}

function error(status: number, title: string) {
  return Response.json({ title }, { status, headers: responseHeaders });
}
