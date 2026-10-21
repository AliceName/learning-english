import { NextResponse } from "next/server";
import { backendUrl, isSameOrigin, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server-auth";
import { backendRequestSignal, isBackendTimeout } from "@/lib/backend-request";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ title: "Yêu cầu không hợp lệ." }, { status: 403 });
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
    if (!body || typeof body.email !== "string" || typeof body.password !== "string") throw new Error("Invalid body");
  } catch {
    return NextResponse.json({ title: "Vui lòng nhập email và mật khẩu." }, { status: 400 });
  }

  try {
    const upstream = await fetch(backendUrl("/api/v1/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: body.email, password: body.password }),
      cache: "no-store",
      signal: backendRequestSignal(request.signal),
    });
    if (!upstream.ok) {
      const response = new NextResponse(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
      const retryAfter = upstream.headers.get("Retry-After");
      if (retryAfter) response.headers.set("Retry-After", retryAfter);
      return response;
    }

    const result = await upstream.json();
    if (typeof result.accessToken !== "string" || !Number.isInteger(result.expiresIn) || result.expiresIn < 1 || result.expiresIn > 3600 || !result.user)
      throw new Error("Invalid authentication response");

    const response = NextResponse.json({ user: result.user, expiresAt: result.expiresAt }, {
      headers: { "Cache-Control": "no-store" },
    });
    response.cookies.set(SESSION_COOKIE, result.accessToken, { ...sessionCookieOptions, maxAge: result.expiresIn });
    return response;
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    if (isBackendTimeout(error)) {
      return NextResponse.json({ title: "Yêu cầu đăng nhập đã hết thời gian chờ.", detail: "Máy chủ phản hồi quá lâu. Vui lòng thử lại." }, {
        status: 504, headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ title: "Chưa thể đăng nhập.", detail: "Hệ thống đang bận. Vui lòng thử lại sau." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
