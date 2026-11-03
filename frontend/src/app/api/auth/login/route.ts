import { NextResponse, type NextRequest } from "next/server";
import { backendUrl, isSameOrigin } from "@/lib/server-auth";
import { isRefreshToken, readIssuedSession, REFRESH_COOKIE, setBrowserSession } from "@/lib/server-session";
import { backendRequestSignal, isBackendTimeout } from "@/lib/backend-request";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ title: "Yêu cầu không hợp lệ." }, { status: 403 });
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
    if (!body || typeof body.email !== "string" || typeof body.password !== "string") throw new Error("Invalid body");
  } catch {
    return NextResponse.json({ title: "Vui lòng nhập email và mật khẩu." }, { status: 400 });
  }

  try {
    const previousRefreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
    const upstream = await fetch(backendUrl("/api/v1/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: body.email, password: body.password, useRefreshSession: true,
        previousRefreshToken: isRefreshToken(previousRefreshToken) ? previousRefreshToken : undefined }),
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

    const result = await readIssuedSession(upstream);

    const response = NextResponse.json({ user: result.user, expiresAt: result.expiresAt }, {
      headers: { "Cache-Control": "no-store" },
    });
    setBrowserSession(response, result);
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
