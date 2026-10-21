import { NextResponse } from "next/server";
import { isSameOrigin, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server-auth";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ title: "Yêu cầu không hợp lệ." }, { status: 403 });
  const response = NextResponse.json({ message: "Đã đăng xuất." }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return response;
}
