import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";

/** Deletes one of the learner's practice rounds (all versions). The API checks ownership. */
export async function DELETE(request: Request, context: { params: Promise<{ rootId: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) return Response.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập." }, { status: 401, headers });
  const { rootId } = await context.params;
  if (!/^[1-9]\d{0,9}$/u.test(rootId) || Number(rootId) > 2147483647)
    return Response.json({ title: "Lượt luyện không hợp lệ." }, { status: 400, headers });
  try {
    const response = await fetch(backendUrl(`/api/v1/writing/practices/${rootId}`), {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]) });
    return new Response(response.body, { status: response.status, headers: { ...headers, "Content-Type": "application/json" } });
  } catch { return Response.json({ title: "Chưa xóa được lượt luyện. Hãy thử lại." }, { status: 503, headers }); }
}
