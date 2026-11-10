import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { isRefreshToken, readIssuedSession, REFRESH_COOKIE, sendRefreshToken, setBrowserSession } from "@/lib/server-session";

function accessWindow(token: string | undefined) {
  if (!token || token.length > 4096) return { expiry: 0, deadline: 0 };
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return { expiry: Number(payload.exp) || 0, deadline: Number(payload.session_exp) || 0 };
  } catch {
    return { expiry: 0, deadline: 0 };
  }
}

export async function proxy(request: NextRequest) {
  if (request.method === "OPTIONS" || !isSameOrigin(request)) return NextResponse.next();
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!isRefreshToken(refreshToken)) return NextResponse.next();

  // These claims only schedule renewal. ASP.NET still authenticates every protected request.
  const { expiry, deadline } = accessWindow(request.cookies.get(SESSION_COOKIE)?.value);
  const now = Date.now() / 1000;
  if (expiry > now && (expiry - now > 45 || deadline > 0 && expiry >= deadline)) return NextResponse.next();

  try {
    const upstream = await sendRefreshToken("refresh", refreshToken, request.signal);
    if (upstream.status === 401) return NextResponse.next();
    if (!upstream.ok) throw new Error("Session refresh failed");

    const session = await readIssuedSession(upstream);
    if (!session.refreshToken) throw new Error("Missing replacement refresh token");
    request.cookies.set(SESSION_COOKIE, session.accessToken);
    request.cookies.set(REFRESH_COOKIE, session.refreshToken);

    const response = NextResponse.next({ request: { headers: request.headers } });
    response.headers.set("Cache-Control", "private, no-store");
    setBrowserSession(response, session);
    return response;
  } catch {
    if (expiry > Date.now() / 1000) return NextResponse.next();
    const headers = { "Cache-Control": "private, no-store", "Retry-After": "3" };
    const title = "Chưa thể gia hạn phiên. Vui lòng thử lại.";
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ title }, { status: 503, headers });
    return new NextResponse(title, { status: 503, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  }
}

export const config = {
  matcher: [
    "/", "/account/:path*", "/admin/:path*", "/courses/:path*", "/speaking/:path*", "/flashcards/:path*",
    "/api/auth/me", "/api/account/:path*", "/api/admin/:path*", "/api/learning/:path*", "/api/speaking/:path*",
    "/api/flashcards/:path*", "/api/media/:path*", "/api/vocabulary/:path*",
  ],
};
