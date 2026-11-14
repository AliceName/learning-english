import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { isWritingPreflight } from "@/lib/writing-capabilities";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) return Response.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập để kiểm tra giới hạn bài viết." }, { status: 401, headers });
  if (Number(request.headers.get("content-length")) > 65536)
    return Response.json({ title: "Bài viết quá dài." }, { status: 413, headers });
  let body;
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Object.keys(body).some(key => !["originalText", "corrections"].includes(key))
      || typeof body.originalText !== "string" || !body.originalText.trim() || body.originalText.length > 12000
      || typeof body.corrections !== "boolean") throw new Error("Invalid preflight request");
  } catch { return Response.json({ title: "Vui lòng kiểm tra nội dung bài viết." }, { status: 400, headers }); }
  try {
    const upstream = await fetch(backendUrl("/api/v1/writing/preflight"), {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ originalText: body.originalText, corrections: body.corrections }), cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    });
    if (!upstream.ok) return new Response(upstream.body, { status: upstream.status,
      headers: { ...headers, "Content-Type": "application/json" } });
    const value: unknown = await upstream.json();
    if (!isWritingPreflight(value, body.originalText, body.corrections)) throw new Error("Invalid preflight response");
    return Response.json(value, { headers });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    return Response.json({ title: "Chưa kiểm tra được giới hạn bài viết.", detail: "Bản nháp vẫn được giữ. Hãy thử lại sau." }, { status: 503, headers });
  }
}
