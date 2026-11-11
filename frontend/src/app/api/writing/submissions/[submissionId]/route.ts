import { getSavedWriting } from "@/lib/writing-server";

export async function GET(request: Request, context: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await context.params;
  const saved = await getSavedWriting(submissionId, request.signal);
  const headers = { "Cache-Control": "no-store" };
  return "result" in saved
    ? Response.json(saved.result, { headers })
    : Response.json({ title: "Chưa thể mở bài viết.", detail: saved.notice }, { status: saved.status, headers });
}
