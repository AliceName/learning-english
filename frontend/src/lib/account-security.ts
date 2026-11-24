import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { backendUrl, isSameOrigin, SESSION_COOKIE, sessionCookieOptions } from "./server-auth";
import { backendRequestSignal, isBackendTimeout } from "./backend-request";
import { readJsonBody, InvalidBody } from "./read-json-body";
import { isRefreshToken, readIssuedSession, REFRESH_COOKIE, setBrowserSession } from "./server-session";

export async function updateAccountSecurity(request: Request, action: "change-password" | "sessions/revoke-others") {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) return NextResponse.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ title: "Vui lòng đăng nhập lại." }, { status: 401, headers });
  let body: Record<string, unknown>;
  if (action === "change-password") {
    try {
      const data = await readJsonBody(request, 4096);
      if (![data.currentPassword, data.newPassword, data.confirmPassword].every(value => typeof value === "string")) throw new InvalidBody(400);
      body = { currentPassword: data.currentPassword, newPassword: data.newPassword, confirmPassword: data.confirmPassword };
    } catch (error) { return NextResponse.json({ title: "Thông tin mật khẩu không hợp lệ." }, { status: error instanceof InvalidBody ? error.status : 400, headers }); }
  } else {
    const refresh = store.get(REFRESH_COOKIE)?.value;
    body = { refreshToken: isRefreshToken(refresh) ? refresh : null };
  }
  try {
    const upstream = await fetch(backendUrl(`/api/v1/auth/${action}`), {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store", signal: backendRequestSignal(request.signal),
    });
    if (!upstream.ok) return new NextResponse(upstream.body, { status: upstream.status, headers: { ...headers, "Content-Type": "application/json" } });
    const response = NextResponse.json({ message: action === "change-password" ? "Đã đổi mật khẩu. Vui lòng đăng nhập lại." : "Đã đăng xuất các phiên khác." }, { headers });
    if (action === "change-password") {
      response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
      response.cookies.set(REFRESH_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
    } else {
      const issued = await readIssuedSession(upstream);
      if (!issued.refreshToken) throw new Error("Missing replacement session");
      setBrowserSession(response, issued);
    }
    return response;
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499, headers });
    return NextResponse.json({ title: "Chưa xác nhận được thay đổi bảo mật. Hãy tải lại trang để kiểm tra trước khi thử lại." }, { status: isBackendTimeout(error) ? 504 : 503, headers });
  }
}
