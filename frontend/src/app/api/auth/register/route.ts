import { backendRequestSignal, isBackendTimeout } from "@/lib/backend-request";
import { backendUrl } from "@/lib/server-auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ title: "Dữ liệu đăng ký không hợp lệ." }, { status: 400 });
  }
  try {
    const response = await fetch(backendUrl("/api/v1/auth/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: backendRequestSignal(request.signal),
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (isBackendTimeout(error)) {
      return Response.json({ title: "Yêu cầu đăng ký đã hết thời gian chờ.", detail: "Máy chủ phản hồi quá lâu. Vui lòng thử lại." }, { status: 504 });
    }
    return Response.json({ title: "Chưa thể tạo tài khoản.", detail: "Hệ thống đang bận. Vui lòng thử lại sau." }, { status: 503 });
  }
}

