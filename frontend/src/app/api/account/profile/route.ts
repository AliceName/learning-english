import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { backendUrl, isSameOrigin, SESSION_COOKIE } from "@/lib/server-auth";
import { backendRequestSignal, isBackendTimeout } from "@/lib/backend-request";
import { readJsonBody, InvalidBody } from "@/lib/read-json-body";

const headers = { "Cache-Control": "no-store" };
export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ title: "Yêu cầu không hợp lệ." }, { status: 403, headers });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ title: "Vui lòng đăng nhập lại." }, { status: 401, headers });
  let body: Record<string, unknown>;
  try {
    const data = await readJsonBody(request, 16384);
    if (!data || typeof data.fullName !== "string" || !(data.targetLevel === null || typeof data.targetLevel === "string") || !(data.avatarUrl === null || typeof data.avatarUrl === "string")) throw new Error("Invalid profile");
    body = { fullName: data.fullName, targetLevel: data.targetLevel, avatarUrl: data.avatarUrl };
    const nullableText = (value: unknown) => value === null || typeof value === "string";
    if (data.personalDetails != null) {
      const details = data.personalDetails as Record<string, unknown>;
      if (typeof details !== "object" || Array.isArray(details) || !nullableText(details.phoneNumber) || !nullableText(details.dateOfBirth) || !nullableText(details.address)) throw new Error("Invalid details");
      body.personalDetails = { phoneNumber: details.phoneNumber, dateOfBirth: details.dateOfBirth, address: details.address };
    }
    if (data.learningPreferences != null) {
      const preferences = data.learningPreferences as Record<string, unknown>;
      if (typeof preferences !== "object" || Array.isArray(preferences) || !nullableText(preferences.learningPurpose) || !nullableText(preferences.preferredSkill) ||
        !(preferences.dailyGoalMinutes === null || Number.isInteger(preferences.dailyGoalMinutes))) throw new Error("Invalid preferences");
      body.learningPreferences = { learningPurpose: preferences.learningPurpose, preferredSkill: preferences.preferredSkill, dailyGoalMinutes: preferences.dailyGoalMinutes };
    }
  } catch (error) { return NextResponse.json({ title: "Thông tin hồ sơ không hợp lệ." }, { status: error instanceof InvalidBody ? error.status : 400, headers }); }
  try {
    const response = await fetch(backendUrl("/api/v1/auth/me"), {
      method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store", signal: backendRequestSignal(request.signal),
    });
    return new NextResponse(response.body, { status: response.status, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499, headers });
    return NextResponse.json({ title: isBackendTimeout(error) ? "Lưu hồ sơ hết thời gian chờ. Hãy tải lại để kiểm tra trước khi thử lại." : "Chưa kết nối được máy chủ. Vui lòng thử lại." }, { status: isBackendTimeout(error) ? 504 : 503, headers });
  }
}
