import { getCurrentUser } from "@/lib/server-auth";

export async function GET() {
  const session = await getCurrentUser();
  if (session.status === "authenticated") return Response.json(session.user, { headers: { "Cache-Control": "no-store" } });
  return Response.json({ title: session.status === "anonymous" ? "Vui lòng đăng nhập." : "Hệ thống đang bận. Vui lòng thử lại sau." }, {
    status: session.status === "anonymous" ? 401 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
