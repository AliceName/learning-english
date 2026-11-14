/** Only Writing can opt in to an authentication return path. Never pass an arbitrary URL to router.replace. */
export function safeWritingReturnTo(value: unknown): string {
  if (typeof value !== "string" || /[\\\s\u0000-\u001f\u007f]/u.test(value)) return "/account";
  if (value === "/writing") return value;
  if (value === "/writing?custom=1" || /^\/writing\?taskId=[a-f0-9-]{36}$/u.test(value)) return value;
  const match = /^\/writing\?submissionId=([1-9]\d{0,9})$/u.exec(value);
  return match && Number(match[1]) <= 2147483647 ? value : "/account";
}

export function writingReturnTaskId(value: unknown): string | null {
  const target = safeWritingReturnTo(value);
  return target.startsWith("/writing?taskId=") ? target.slice("/writing?taskId=".length) : null;
}

export function writingReturnSubmissionId(value: unknown): number | null {
  const target = safeWritingReturnTo(value);
  return target.startsWith("/writing?submissionId=") ? Number(target.slice("/writing?submissionId=".length)) : null;
}

export function writingAuthHref(action: "login" | "register", returnTo: unknown): string {
  const target = safeWritingReturnTo(returnTo);
  return target === "/account" ? `/${action}` : `/${action}?returnTo=${encodeURIComponent(target)}`;
}
