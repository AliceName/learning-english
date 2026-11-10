import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server-auth";
import { isRefreshToken, REFRESH_COOKIE, sendRefreshToken } from "@/lib/server-session";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ title: "Yêu cầu không hợp lệ." }, { status: 403 });
  const headers = { "Cache-Control": "no-store" };
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (isRefreshToken(refreshToken)) {
    try {
      const upstream = await sendRefreshToken("logout", refreshToken, request.signal);
      if (!upstream.ok && upstream.status !== 404) throw new Error("Session revocation failed");
    } catch {
      return NextResponse.json({ title: "Chưa thể đăng xuất. Vui lòng thử lại." }, { status: 503, headers });
    }
  }
  const response = NextResponse.json({ message: "Đã đăng xuất." }, { headers });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return response;
}
