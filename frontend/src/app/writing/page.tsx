import { Suspense } from "react";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/server-auth";
import MemberShell from "@/components/navigation/member-shell";
import PublicNavbar from "@/components/navigation/public-navbar";
import WritingForm from "./writing-form";
import { getSavedWriting, getWritingTask } from "@/lib/writing-server";
import { writingSubmissionId, type WritingResult } from "@/lib/writing";

export const metadata: Metadata = { title: "Luyện viết | LinguaAI", description: "Viết tiếng Anh và nhận ước lượng CEFR từ bài viết của bạn." };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

async function Workspace({ searchParams }: { searchParams: SearchParams }) {
  const session = await getCurrentUser();
  const query = await searchParams;
  let initialResult: WritingResult | null = null;
  let initialNotice = "";
  const taskId = typeof query.taskId === "string" && /^[a-f0-9-]{36}$/u.test(query.taskId) ? query.taskId : null;
  const initialTask = query.submissionId === undefined && taskId ? await getWritingTask(taskId) : null;
  if (query.taskId !== undefined && !initialTask && query.submissionId === undefined)
    initialNotice = "Chưa tải được đề đã chọn. Nháp trong phiên vẫn được giữ; hãy thử chọn lại đề.";
  if (query.submissionId !== undefined) {
    const saved = await getSavedWriting(query.submissionId);
    if ("result" in saved) initialResult = saved.result;
    else initialNotice = saved.notice;
  }
  const form = <WritingForm key={`${session.status === "authenticated" ? session.user.userId : session.status}:${initialResult?.submissionId ?? query.submissionId ?? taskId ?? query.custom ?? "library"}`}
    authenticated={session.status === "authenticated"} unavailable={session.status === "unavailable"}
    userId={session.status === "authenticated" ? session.user.userId : null}
    targetLevel={session.status === "authenticated" ? session.user.targetLevel : null}
    draftBaseId={writingSubmissionId(query.submissionId)} initialResult={initialResult} initialNotice={initialNotice}
    initialTask={initialTask} draftTaskId={taskId} custom={query.custom === "1"} />;
  return session.status === "authenticated" ? <MemberShell user={session.user}>{form}</MemberShell>
    : <><PublicNavbar />{form}</>;
}

export default function WritingPage({ searchParams }: { searchParams: SearchParams }) {
  return <Suspense fallback={<p role="status">Đang tải không gian luyện viết…</p>}><Workspace searchParams={searchParams} /></Suspense>;
}
