import "server-only";
import { cookies } from "next/headers";
import { backendRequestSignal } from "./backend-request";
import { backendUrl, SESSION_COOKIE } from "./server-auth";
import { isWritingResult, isWritingTaskCatalogue, writingSubmissionId, type WritingResult } from "./writing";

export async function getWritingTask(id: string) {
  try {
    const response = await fetch(backendUrl("/api/v1/writing/tasks"), { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    const value: unknown = await response.json();
    return response.ok && isWritingTaskCatalogue(value) ? value.items.find(t => t.id === id) ?? null : null;
  } catch { return null; }
}

type SavedWriting = { result: WritingResult; status: 200 } | { notice: string; status: number };

export async function getSavedWriting(value: unknown, requestSignal?: AbortSignal): Promise<SavedWriting> {
  const id = writingSubmissionId(value);
  if (id === null) return { status: 400, notice: "Mã bài viết không hợp lệ." };
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { status: 401, notice: "Vui lòng đăng nhập để xem bài đã lưu." };
  try {
    const response = await fetch(backendUrl(`/api/v1/writing/submissions/${id}`), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store", signal: backendRequestSignal(requestSignal),
    });
    if (response.status === 404) return { status: 404, notice: "Không tìm thấy bài viết trong tài khoản của bạn." };
    if (response.status === 401 || response.status === 403)
      return { status: response.status, notice: "Vui lòng đăng nhập lại để xem bài đã lưu." };
    if (!response.ok) return { status: 503, notice: "Chưa thể tải bài đã lưu. Hãy thử lại sau." };
    const result: unknown = await response.json();
    if (!isWritingResult(result) || result.submissionId !== id)
      return { status: 503, notice: "Kết quả bài đã lưu chưa hợp lệ. Hãy thử lại sau." };
    return { status: 200, result };
  } catch {
    if (requestSignal?.aborted) return { status: 499, notice: "Đã dừng tải bài viết." };
    return { status: 503, notice: "Chưa thể tải bài đã lưu. Hãy thử lại sau." };
  }
}
