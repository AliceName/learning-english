import "server-only";
import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";

export async function definitionAudioProxy(request: Request, prepare: boolean) {
  const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (prepare && !isSameOrigin(request)) return Response.json({ title: "Nguồn yêu cầu không hợp lệ." }, { status: 403, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập để nghe nghĩa." }, { status: 401, headers });
  try {
    const target = backendUrl(`/api/v1/vocabulary/definition-audio${prepare ? "/prepare" : ""}`);
    let body: string | undefined;
    if (prepare) {
      if (Number(request.headers.get("content-length")) > 4096) return new Response(null, { status: 413, headers });
      const reader = request.body?.getReader();
      if (!reader) return new Response(null, { status: 400, headers });
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 4096) { await reader.cancel(); return new Response(null, { status: 413, headers }); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      let selection;
      try { selection = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return new Response(null, { status: 400, headers }); }
      if (!selection || typeof selection.word !== "string" || !selection.word.trim() || selection.word.length > 300 ||
        selection.direction !== "en-vi" || typeof selection.definitionId !== "string" || !/^[a-f0-9]{64}$/.test(selection.definitionId))
        return Response.json({ title: "Lựa chọn nghĩa chưa hợp lệ." }, { status: 400, headers });
      body = JSON.stringify({ word: selection.word, direction: selection.direction, definitionId: selection.definitionId });
    } else {
      const key = new URL(request.url).searchParams.get("key") ?? "";
      if (!/^[a-f0-9]{64}$/.test(key)) return new Response(null, { status: 400, headers });
      target.searchParams.set("key", key);
    }
    const range = request.headers.get("range");
    const response = await fetch(target, {
      method: prepare ? "POST" : "GET", body, cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(prepare ? { "Content-Type": "application/json" } : {}), ...(!prepare && range ? { Range: range } : {}) },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(prepare ? 100_000 : 30_000)]),
    });
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "retry-after"]) {
      const value = response.headers.get(name); if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return Response.json({ title: timedOut ? "Chuẩn bị giọng đọc quá thời gian chờ." : "Chưa kết nối được máy chủ giọng đọc." }, { status: timedOut ? 504 : 503, headers });
  }
}
