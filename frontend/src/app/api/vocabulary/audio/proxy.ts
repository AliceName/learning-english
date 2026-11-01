import "server-only";
import { cookies } from "next/headers";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";

export async function audioProxy(request: Request, prepare: boolean) {
  const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (prepare && !isSameOrigin(request)) return Response.json({ title: "Nguồn yêu cầu không hợp lệ." }, { status: 403, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ title: "Vui lòng đăng nhập để nghe phát âm." }, { status: 401, headers });
  try {
    let selection: { word?: unknown; entry?: unknown; phonetic?: unknown };
    if (prepare) {
      if (Number(request.headers.get("content-length")) > 4096) return new Response(null, { status: 413, headers });
      const text = await request.text();
      if (Buffer.byteLength(text) > 4096) return new Response(null, { status: 413, headers });
      try { selection = JSON.parse(text); } catch { return Response.json({ title: "Lựa chọn phát âm chưa hợp lệ." }, { status: 400, headers }); }
    } else {
      const query = new URL(request.url).searchParams;
      const entry = query.get("entry") ?? "0", phonetic = query.get("phonetic") ?? "0";
      if (!/^\d{1,3}$/.test(entry) || !/^\d{1,3}$/.test(phonetic)) return new Response(null, { status: 400, headers });
      selection = { word: query.get("word"), entry: Number(entry), phonetic: Number(phonetic) };
    }
    if (!selection || typeof selection.word !== "string" || !selection.word.trim() || selection.word.length > 300 ||
      !Number.isInteger(selection.entry) || !Number.isInteger(selection.phonetic) || Number(selection.entry) < 0 || Number(selection.entry) > 200 || Number(selection.phonetic) < 0 || Number(selection.phonetic) > 200)
      return Response.json({ title: "Lựa chọn phát âm chưa hợp lệ." }, { status: 400, headers });
    const target = backendUrl(`/api/v1/vocabulary/audio${prepare ? "/prepare" : ""}`);
    if (!prepare) target.search = new URLSearchParams({ word: selection.word, entry: String(selection.entry), phonetic: String(selection.phonetic) }).toString();
    const range = request.headers.get("range");
    const response = await fetch(target, {
      method: prepare ? "POST" : "GET", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(prepare ? { "Content-Type": "application/json" } : {}), ...(!prepare && range ? { Range: range } : {}) },
      body: prepare ? JSON.stringify({ word: selection.word, entry: selection.entry, phonetic: selection.phonetic }) : undefined,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(prepare ? 120_000 : 30_000)]),
    });
    for (const name of ["content-type", "content-length", "accept-ranges", "content-range", "retry-after", "etag", "last-modified"]) {
      const value = response.headers.get(name); if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return Response.json({ title: timeout ? "Chuẩn bị âm thanh quá thời gian chờ. Vui lòng thử lại." : "Chưa kết nối được máy chủ âm thanh. Vui lòng thử lại." }, { status: timeout ? 504 : 503, headers });
  }
}
