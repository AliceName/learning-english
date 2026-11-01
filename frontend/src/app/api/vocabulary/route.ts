import { cookies } from "next/headers";
import { backendUrl, SESSION_COOKIE } from "@/lib/server-auth";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Đăng nhập để sử dụng từ điển." }, { status: 401, headers });
  const word = new URL(request.url).searchParams.get("word") ?? "";
  if (!word.trim() || word.length > 300) return Response.json({ title: "Vui lòng nhập một từ hợp lệ." }, { status: 400, headers });
  const target = backendUrl("/api/v1/vocabulary");
  target.searchParams.set("word", word);
  try {
    const response = await fetch(target, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    });
    return new Response(response.body, {
      status: response.status,
      headers: { ...headers, "Content-Type": response.headers.get("content-type") ?? "application/problem+json",
        ...(response.headers.has("retry-after") ? { "Retry-After": response.headers.get("retry-after")! } : {}) },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return Response.json({ title: timedOut ? "Tra từ quá thời gian chờ. Vui lòng thử lại." : "Chưa kết nối được máy chủ. Vui lòng thử lại." },
      { status: timedOut ? 504 : 503, headers });
  }
}
