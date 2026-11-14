import { backendUrl, isSameOrigin } from "@/lib/server-auth";
import { isWritingTaskCatalogue } from "@/lib/writing";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) return Response.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
  try {
    const response = await fetch(backendUrl("/api/v1/writing/tasks"), { cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]) });
    if (!response.ok) throw new Error("Catalogue unavailable");
    const value: unknown = await response.json();
    if (!isWritingTaskCatalogue(value)) throw new Error("Invalid catalogue");
    return Response.json(value, { headers });
  } catch { return Response.json({ title: "Chưa tải được thư viện đề. Bản nháp vẫn được giữ." }, { status: 503, headers }); }
}
