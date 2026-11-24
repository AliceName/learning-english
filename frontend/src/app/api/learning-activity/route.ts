import { cookies } from "next/headers";
import { isSameOrigin, backendUrl, SESSION_COOKIE } from "@/lib/server-auth";
import { backendRequestSignal } from "@/lib/backend-request";
import { activityLabels } from "@/lib/learning-activity";

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json" };

async function proxy(request: Request, kind?: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập." }, { status: 401, headers });
  const target = backendUrl(`/api/v1/learning-activity${kind ? "/" + kind : ""}`);
  if (!kind) {
    const year = new URL(request.url).searchParams.get("year");
    if (year !== null) target.searchParams.set("year", year);
  }
  try {
    const response = await fetch(target, {
      method: request.method, headers: { Authorization: `Bearer ${token}` },
      signal: backendRequestSignal(request.signal), cache: "no-store",
    });
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json({ title: "Chưa kết nối được dịch vụ hoạt động học." }, { status: 503, headers });
  }
}

export function GET(request: Request) {
  return proxy(request);
}

export function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ title: "Nguồn yêu cầu không hợp lệ." }, { status: 403, headers });
  const kind = new URL(request.url).searchParams.get("kind");
  if (!kind || !Object.hasOwn(activityLabels, kind) || kind === "translation")
    return Response.json({ title: "Loại hoạt động học chưa hợp lệ." }, { status: 400, headers });
  return proxy(request, kind);
}
