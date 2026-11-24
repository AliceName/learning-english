import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { backendRequestSignal } from "@/lib/backend-request";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { InvalidBody, readJsonBody } from "@/lib/read-json-body";

type Context = { params: Promise<{ target?: string[] }> };
const headers = { "Cache-Control": "private, no-store" };
const types = new Set(["course", "lesson", "writing", "flashcard", "vocabulary"]);

async function proxy(request: Request, context: Context) {
  const target = (await context.params).target ?? [];
  let path = "/api/v1/bookmarks";
  if (request.method === "GET") {
    if (target.length) return new NextResponse(null, { status: 404, headers });
  } else {
    const [type, id] = target;
    if (target.length !== 2 || !types.has(type) || !/^[1-9]\d*$/.test(id) || Number(id) > 2147483647)
      return new NextResponse(null, { status: 404, headers });
    if (!isSameOrigin(request))
      return NextResponse.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
    path += "/" + type + "/" + Number(id);
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ title: "Vui lòng đăng nhập lại." }, { status: 401, headers });
  let body: string | undefined;
  const contentLength = Number(request.headers.get("content-length"));
  const hasBody = request.headers.has("content-type") || contentLength > 0 || request.headers.has("transfer-encoding");
  if (request.method === "PATCH" || (request.method === "PUT" && hasBody)) {
    try {
      const { note } = await readJsonBody(request, 4096);
      if (note !== null && (typeof note !== "string" || note.length > 500)) throw new InvalidBody(400);
      body = JSON.stringify({ note });
    } catch (error) {
      return NextResponse.json({ title: "Ghi chú phải có tối đa 500 ký tự." }, { status: error instanceof InvalidBody ? error.status : 400, headers });
    }
  }
  try {
    const response = await fetch(backendUrl(path), {
      method: request.method, headers: { Authorization: "Bearer " + token, ...(body && { "Content-Type": "application/json" }) },
      body, cache: "no-store", signal: backendRequestSignal(request.signal),
    });
    const resultHeaders = new Headers(headers);
    const contentType = response.headers.get("Content-Type");
    if (contentType) resultHeaders.set("Content-Type", contentType);
    return new NextResponse(response.body, { status: response.status, headers: resultHeaders });
  } catch {
    return NextResponse.json({ title: "Chưa kết nối được máy chủ. Vui lòng thử lại." }, { status: 503, headers });
  }
}

export const GET = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
