import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { isWritingPractices } from "@/lib/writing-capabilities";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) return Response.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const limit = params.get("limit") ?? "10", before = params.get("beforeId");
  if ([...params.keys()].some(k => !["limit", "beforeId"].includes(k)) || !/^(?:[1-9]|1\d|20)$/u.test(limit)
    || (before !== null && (!/^[1-9]\d{0,9}$/u.test(before) || Number(before) > 2147483647)))
    return Response.json({ title: "Tham số lịch sử không hợp lệ." }, { status: 400, headers });
  const query = new URLSearchParams({ limit }); if (before) query.set("beforeId", before);
  try {
    const response = await fetch(backendUrl(`/api/v1/writing/practices?${query}`), {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]) });
    if (!response.ok) return new Response(response.body, { status: response.status, headers: { ...headers, "Content-Type": "application/json" } });
    const value: unknown = await response.json(); if (!isWritingPractices(value)) throw new Error();
    return Response.json(value, { headers });
  } catch { return Response.json({ title: "Chưa tải được lượt luyện." }, { status: 503, headers }); }
}
