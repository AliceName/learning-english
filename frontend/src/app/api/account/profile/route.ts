import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { backendRequestSignal, isBackendTimeout } from "@/lib/backend-request";

const headers = { "Cache-Control": "no-store" };
export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ title: "Vui lòng đăng nhập lại." }, { status: 401, headers });
  let body: { fullName: string; targetLevel: string | null; avatarUrl: string | null };
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ title: "Thiếu thông tin hồ sơ." }, { status: 400, headers });
  try {
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 16384) { await reader.cancel(); return NextResponse.json({ title: "Thông tin gửi lên quá lớn." }, { status: 413, headers }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data.fullName !== "string" || !(data.targetLevel === null || typeof data.targetLevel === "string") || !(data.avatarUrl === null || typeof data.avatarUrl === "string")) throw new Error("Invalid profile");
    body = { fullName: data.fullName, targetLevel: data.targetLevel, avatarUrl: data.avatarUrl };
  } catch { return NextResponse.json({ title: "Thông tin hồ sơ không hợp lệ." }, { status: 400, headers }); }
  finally { reader.releaseLock(); }
  try {
    const response = await fetch(backendUrl("/api/v1/auth/me"), {
      method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store", signal: backendRequestSignal(request.signal),
    });
    return new NextResponse(response.body, { status: response.status, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499, headers });
    return NextResponse.json({ title: isBackendTimeout(error) ? "Lưu hồ sơ hết thời gian chờ. Hãy tải lại để kiểm tra trước khi thử lại." : "Chưa kết nối được máy chủ. Vui lòng thử lại." }, { status: isBackendTimeout(error) ? 504 : 503, headers });
  }
}
