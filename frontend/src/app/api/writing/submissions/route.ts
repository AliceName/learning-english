import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { isWritingHistory } from "@/lib/writing-capabilities";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) return Response.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập để xem lịch sử bài viết." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const limit = params.get("limit") ?? "10";
  const beforeId = params.get("beforeId");
  const root = params.get("practiceRootId");
  if ([...params.keys()].some(key => !["limit", "beforeId", "practiceRootId"].includes(key))
    || !/^(?:[1-9]|1\d|20)$/u.test(limit)
    || (beforeId !== null && (!/^[1-9]\d{0,9}$/u.test(beforeId) || Number(beforeId) > 2147483647))
    || (root !== null && (!/^[1-9]\d{0,9}$/u.test(root) || Number(root) > 2147483647)))
    return Response.json({ title: "Tham số lịch sử bài viết không hợp lệ." }, { status: 400, headers });
  const query = new URLSearchParams({ limit });
  if (beforeId) query.set("beforeId", beforeId);
  if (root) query.set("practiceRootId", root);
  try {
    const upstream = await fetch(backendUrl(`/api/v1/writing/submissions?${query}`), {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]),
    });
    if (!upstream.ok) return new Response(upstream.body, { status: upstream.status,
      headers: { ...headers, "Content-Type": "application/json" } });
    const value: unknown = await upstream.json();
    if (!isWritingHistory(value)) throw new Error("Invalid history response");
    return Response.json(value, { headers });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    return Response.json({ title: "Chưa thể tải lịch sử bài viết." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) return Response.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập để nộp bài." }, { status: 401, headers });
  if (Number(request.headers.get("content-length")) > 65536)
    return Response.json({ title: "Bài viết quá dài." }, { status: 413, headers });
  let body;
  try {
    body = await request.json();
    if (!body || typeof body.originalText !== "string" || !body.originalText.trim()
      || body.originalText.length > 12000 || typeof body.corrections !== "boolean"
      || (body.topic != null && (typeof body.topic !== "string" || body.topic.length > 500))
      || (body.taskId != null && (typeof body.taskId !== "string" || !/^[a-f0-9-]{36}$/u.test(body.taskId)))
      || (body.taskVersion != null && (typeof body.taskVersion !== "string" || !/^[a-f0-9]{64}$/u.test(body.taskVersion)))
      || (body.parentSubmissionId != null && (!Number.isInteger(body.parentSubmissionId) || body.parentSubmissionId < 1 || body.parentSubmissionId > 2147483647))
      || Object.keys(body).some(k => !["topic", "originalText", "corrections", "taskId", "taskVersion", "parentSubmissionId"].includes(k))) throw new Error("Invalid writing request");
  } catch {
    return Response.json({ title: "Vui lòng kiểm tra đề bài và nội dung bài viết." }, { status: 400, headers });
  }
  try {
    const upstream = await fetch(backendUrl("/api/v1/writing/submissions"), {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ topic: body.topic, originalText: body.originalText, corrections: body.corrections,
        taskId: body.taskId, taskVersion: body.taskVersion, parentSubmissionId: body.parentSubmissionId }),
      cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(100_000)]),
    });
    return new Response(upstream.body, { status: upstream.status, headers: { ...headers, "Content-Type": "application/json" } });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    return Response.json({ title: "Chưa thể nộp bài.", detail: "Máy chủ phản hồi chậm hoặc chưa sẵn sàng. Hãy giữ bài viết và thử lại sau." }, { status: 503, headers });
  }
}
