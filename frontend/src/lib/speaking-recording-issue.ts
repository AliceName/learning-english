import type { SpeakingRecordingIssue } from "./speaking";

const advice = {
  too_quiet: "Âm thanh quá nhỏ hoặc gần như im lặng. Kiểm tra microphone và mức thu, rồi ghi âm lại.",
  phoneme_mismatch: "Chuỗi âm nhận được khác nhiều so với âm của câu mẫu; chưa đủ căn cứ kết luận bạn đọc sai câu. Nghe lại bản thu, giảm tiếng ồn và thử đọc một cụm ngắn trước.",
  no_speech_tokens: "Bộ chấm chưa nhận được chuỗi âm đủ rõ. Kiểm tra microphone và đọc lại gần thiết bị hơn.",
  alignment_failed: "Chưa căn được các âm vào câu mẫu. Thử câu ngắn hơn và tránh để thiếu đầu hoặc cuối bản thu.",
  clipping: "Âm thanh có đoạn quá lớn làm méo tiếng. Đặt microphone xa hơn hoặc giảm mức thu rồi ghi âm lại.",
} as const;

export function readRecordingIssue(value: unknown): SpeakingRecordingIssue | null {
  if (!value || typeof value !== "object" || !("code" in value) || typeof value.code !== "string" ||
    !Object.hasOwn(advice, value.code)) return null;
  return { code: value.code as SpeakingRecordingIssue["code"] };
}

export function recordingIssueAdvice(value: unknown) {
  const issue = readRecordingIssue(value);
  return issue ? advice[issue.code] : null;
}
