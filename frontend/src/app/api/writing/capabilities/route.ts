import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { isWritingCapabilities } from "@/lib/writing-capabilities";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) return Response.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập để kiểm tra Writing." }, { status: 401, headers });
  try {
    const upstream = await fetch(backendUrl("/api/v1/writing/capabilities"), {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(6_000)]),
    });
    if (!upstream.ok) return new Response(upstream.body, { status: upstream.status,
      headers: { ...headers, "Content-Type": "application/json" } });
    const value: unknown = await upstream.json();
    if (!isWritingCapabilities(value)) throw new Error("Invalid capabilities");
    return Response.json(value, { headers });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    return Response.json({ status: "unavailable", busy: false, correctionsEnabled: false, feedbackEnabled: false,
      feedbackStatus: "unavailable", cefrLimit: null, gecInputLimit: null, gecSentenceLimit: null }, { headers });
  }
}
