import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { isWritingResult, writingSubmissionId } from "@/lib/writing";

async function hasEmptyBody(request: Request, signal: AbortSignal): Promise<boolean> {
  if (!request.body) return true;
  const reader = request.body.getReader();
  let stopReading: () => void = () => {};
  const cancelled = new Promise<{ aborted: true }>(resolve => {
    stopReading = () => resolve({ aborted: true });
    signal.addEventListener("abort", stopReading, { once: true });
    if (signal.aborted) stopReading();
  });
  try {
    // Next can supply an empty stream for a POST without a payload. Never
    // accumulate a body: the first byte is enough to reject browser essay data.
    for (let chunks = 0; chunks < 8; chunks += 1) {
      const chunk = await Promise.race([reader.read(), cancelled]);
      if ("aborted" in chunk) throw new Error("Feedback request cancelled");
      if (chunk.done) return true;
      if (chunk.value.byteLength > 0) return false;
    }
    return false;
  } finally {
    signal.removeEventListener("abort", stopReading);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function POST(request: Request, context: { params: Promise<{ submissionId: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) return Response.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
  const { submissionId: value } = await context.params;
  const id = writingSubmissionId(value);
  if (id === null) return Response.json({ title: "Mã bài viết không hợp lệ." }, { status: 400, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập để nhận xét bài viết." }, { status: 401, headers });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
  try {
    // The backend reads the owned saved submission, never browser essay data.
    if (!await hasEmptyBody(request, signal)) return Response.json({ title: "Yêu cầu này chỉ dùng bài đã lưu." }, { status: 400, headers });
    const upstream = await fetch(backendUrl(`/api/v1/writing/submissions/${id}/feedback`), {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      signal,
    });
    if (!upstream.ok) {
      const notices: Record<number, string> = {
        401: "Vui lòng đăng nhập lại để nhận xét bài viết.", 403: "Bạn không thể nhận xét bài viết này.",
        404: "Không tìm thấy bài viết trong tài khoản của bạn.",
        422: "Nhận xét mở rộng hiện hỗ trợ bài đã lưu từ 80–150 từ.",
        429: "AI đang xử lý nhận xét khác. Hãy chờ một chút rồi thử lại.",
      };
      const status = Object.hasOwn(notices, upstream.status) ? upstream.status : 503;
      return Response.json({ title: "Chưa thể nhận xét bài.", detail: notices[status]
        ?? "Phần nhận xét chưa sẵn sàng. Bài và kết quả chấm vẫn được giữ." }, { status, headers });
    }
    const result: unknown = await upstream.json();
    if (!isWritingResult(result) || result.submissionId !== id || !result.feedback)
      return Response.json({ title: "Nhận xét trả về chưa hợp lệ. Bài đã lưu vẫn được giữ." }, { status: 503, headers });
    return Response.json(result, { headers });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    return Response.json({ title: "Chưa thể nhận xét bài.",
      detail: "Nhận xét chưa hoàn tất trong thời gian cho phép. Bài và kết quả chấm vẫn được giữ." }, { status: 503, headers });
  }
}
