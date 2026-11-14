import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { backendRequestSignal } from "@/lib/backend-request";

type Context = { params: Promise<{ path: string[] }> };
const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json" };
async function proxy(request: Request, context: Context) {
  const route = (await context.params).path.join("/");
  const allowed = request.method === "GET" ? /^(decks(?:\/[1-9][0-9]*)?|writing\/[1-9][0-9]*)$/ : request.method === "POST" ? /^(decks|decks\/[1-9][0-9]*\/(cards|copy|writing\/[1-9][0-9]*)|cards\/[1-9][0-9]*\/review)$/ : /^(decks|cards)\/[1-9][0-9]*$/;
  if (!allowed.test(route)) return new NextResponse(null, { status: 404 });
  if (request.method !== "GET" && !isSameOrigin(request)) return NextResponse.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ title: "Vui lòng đăng nhập lại." }, { status: 401, headers });
  try {
    let body: string | undefined;
    if (request.method === "POST" || request.method === "PUT") {
      const reader = request.body?.getReader(); if (!reader) return new NextResponse(null, { status: 400 });
      try {
        let size = 0; const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 16384) { await reader.cancel(); return NextResponse.json({ title: "Nội dung quá dài." }, { status: 413, headers }); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        body = JSON.stringify(JSON.parse(new TextDecoder().decode(bytes)));
      } catch { return NextResponse.json({ title: "Nội dung không hợp lệ." }, { status: 400, headers }); }
      finally { reader.releaseLock(); }
    }
    const response = await fetch(backendUrl(`/api/v1/flashcards/${route}`), { method: request.method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body, cache: "no-store", signal: backendRequestSignal(request.signal) });
    return new NextResponse(response.status === 204 ? null : response.body, { status: response.status, headers });
  } catch { return NextResponse.json({ title: "Chưa kết nối được máy chủ. Hãy tải lại để kiểm tra trước khi thử lại." }, { status: 503, headers }); }
}
export const GET = proxy; export const POST = proxy; export const PUT = proxy; export const DELETE = proxy;
