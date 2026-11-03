import type { SpeakingAssessment, SpeakingWord } from "./speaking";

export type WordFeedbackTone = "good" | "listen" | "practice" | "unassessed";
export type WordFeedback = { tone: WordFeedbackTone; label: string; description: string; partial: boolean };

export function feedbackThresholds(assessment: SpeakingAssessment) {
  const info = assessment.interpretation;
  const practice = info && Number.isFinite(info.practiceThreshold) && info.practiceThreshold >= .25 && info.practiceThreshold <= 1.95 ? info.practiceThreshold : 1.5;
  const review = info && Number.isFinite(info.reviewThreshold) && info.reviewThreshold >= practice && info.reviewThreshold <= 2 ? info.reviewThreshold : Math.max(1.5, practice);
  return { practice, review };
}

export function wordFeedback(word: SpeakingWord | undefined, assessment: SpeakingAssessment): WordFeedback {
  if (feedbackMode(assessment) === "record_again")
    return { tone: "unassessed", label: "Cần ghi âm lại", description: "Bản ghi chưa ổn định; chưa kết luận từ này đọc đúng hay sai.", partial: false };
  if (!word || word.status !== "scored" || word.score === null || !Number.isFinite(word.score) || word.score < 0 || word.score > 2 ||
    !word.phones.length || word.phones.some(phone => !Number.isFinite(phone.score) || phone.score < 0 || phone.score > 2))
    return { tone: "unassessed", label: "Chưa đánh giá được", description: "Chưa đủ điểm âm được hỗ trợ để nhận xét từ này.", partial: false };
  const { practice, review } = feedbackThresholds(assessment);
  const score = Math.min(...word.phones.map(phone => phone.score));
  const partial = !!word.reason?.trim();
  const detail = `Âm có điểm thấp nhất: ${score.toFixed(2)}/2.${partial ? " Chỉ chấm được một phần từ." : ""}`;
  if (score < practice) return { tone: "practice", label: "Ưu tiên luyện", description: detail, partial };
  if (score < review) return { tone: "listen", label: "Nên nghe lại", description: detail, partial };
  if (partial) return { tone: "unassessed", label: "Chấm được một phần", description: detail + " Chưa đánh giá toàn bộ từ.", partial };
  return { tone: "good", label: "Điểm tốt", description: detail + " Các âm đã chấm đạt ngưỡng tham khảo, chưa phải bảo đảm phát âm đúng.", partial };
}

export function sentenceFeedback(text: string, assessment: SpeakingAssessment) {
  const byIndex = new Map(assessment.words.map(word => [word.index, word]));
  const key = (value: string) => value.replaceAll("’", "'").toLowerCase();
  let index = -1;
  return text.split(/([A-Za-z]+(?:['’][A-Za-z]+)*)/g).map((part, i) => {
    if (i % 2 === 0) return { text: part, wordIndex: null, feedback: null };
    index++;
    const word = byIndex.get(index);
    return { text: part, wordIndex: index, feedback: wordFeedback(word && key(word.text) === key(part) ? word : undefined, assessment) };
  });
}

export function practiceTargets(words: SpeakingWord[], practiceThreshold = 1.5, reviewThreshold = practiceThreshold) {
  return words.filter(word => word.status === "scored" && word.score !== null && word.phones.length > 0).map(word => {
    let phoneIndex = -1;
    word.phones.forEach((phone, i) => { if (phoneIndex < 0 || phone.score < word.phones[phoneIndex].score) phoneIndex = i; });
    const phone = phoneIndex >= 0 ? word.phones[phoneIndex] : null;
    const priority = phone!.score;
    return { word, phone, phoneIndex, priority, band: priority < practiceThreshold ? "practice" as const : "listen" as const };
  }).filter(target => Number.isFinite(target.priority) && target.priority < Math.max(practiceThreshold, reviewThreshold))
    .sort((a, b) => a.priority - b.priority || a.word.index - b.word.index).slice(0, 3);
}

export function feedbackMode(assessment: SpeakingAssessment) {
  return assessment.interpretation?.feedbackMode ?? (assessment.coverage < .8 ? "limited_coverage" : "normal");
}

const guides: Record<string, string> = {
  P: "Khép hai môi, giữ hơi trong chốc lát rồi bật ra; không rung cổ và không thêm nguyên âm /ə/ phía sau.",
  B: "Khép hai môi rồi bật ra, có rung cổ; tránh thêm nguyên âm sau phụ âm cuối.",
  T: "Đặt đầu lưỡi ở lợi sau răng trên rồi nhả luồng hơi; không thêm nguyên âm sau âm cuối.",
  D: "Đặt đầu lưỡi ở lợi sau răng trên rồi nhả ra, có rung cổ.",
  K: "Nâng phần sau lưỡi chạm ngạc mềm rồi nhả hơi, không rung cổ.",
  G: "Nâng phần sau lưỡi chạm ngạc mềm rồi nhả ra, có rung cổ.",
  F: "Chạm nhẹ răng trên vào môi dưới và thổi hơi liên tục, không rung cổ.",
  V: "Chạm nhẹ răng trên vào môi dưới, đẩy hơi và làm rung cổ.",
  TH: "Đưa đầu lưỡi nhẹ giữa hai hàm răng và thổi hơi, không rung cổ.",
  DH: "Đưa đầu lưỡi nhẹ giữa hai hàm răng, đẩy hơi và làm rung cổ.",
  S: "Đưa đầu lưỡi gần lợi trên, để hơi đi qua khe hẹp; không rung cổ.",
  Z: "Giữ khe hẹp như /s/ và thêm rung cổ.",
  SH: "Đưa lưỡi hơi lùi sau lợi trên, môi hơi tròn và đẩy hơi liên tục.",
  ZH: "Giữ vị trí lưỡi như /ʃ/ và thêm rung cổ.",
  CH: "Chặn hơi ngắn ở vùng sau lợi trên rồi nhả thành âm xát /ʃ/.",
  JH: "Chặn hơi ngắn ở vùng sau lợi trên rồi nhả thành âm xát, có rung cổ.",
  M: "Khép hai môi, có rung cổ và để hơi thoát qua mũi.",
  N: "Chạm đầu lưỡi vào lợi trên, có rung cổ và để hơi thoát qua mũi.",
  NG: "Nâng phần sau lưỡi lên ngạc mềm, để hơi qua mũi; không tự thêm /g/ ở cuối.",
  L: "Chạm đầu lưỡi vào lợi sau răng trên; hơi thoát ở hai bên lưỡi.",
  R: "Lưỡi hơi lùi và không chạm vòm miệng; môi có thể hơi tròn, không rung đầu lưỡi.",
  W: "Tròn môi rồi chuyển nhanh sang nguyên âm tiếp theo, không chạm răng vào môi.",
  Y: "Nâng phần giữa lưỡi gần ngạc cứng rồi chuyển nhanh sang nguyên âm tiếp theo.",
  HH: "Thở nhẹ qua miệng, thả lỏng cổ rồi chuyển sang nguyên âm tiếp theo.",
  IY: "Nâng lưỡi cao về phía trước, môi thả lỏng hơi giãn; nghe mẫu để giữ chất lượng nguyên âm.",
  IH: "Lưỡi thấp và thả lỏng hơn /iː/; tránh chỉ rút ngắn /iː/ mà giữ nguyên khẩu hình.",
  EH: "Mở miệng vừa, lưỡi ở phía trước; nghe mẫu để phân biệt với /æ/.",
  AE: "Hạ hàm và đặt lưỡi thấp về phía trước; giữ miệng mở hơn khi đọc /ɛ/.",
  AA: "Mở hàm, đặt lưỡi thấp và hơi lùi; giữ môi thả lỏng.",
  AO: "Đặt lưỡi hơi lùi và tròn môi; đối chiếu giọng mẫu vì nguyên âm có thể khác giữa các giọng Anh–Mỹ.",
  AH: "Thả lỏng môi, đặt lưỡi gần giữa miệng; nghe mẫu vì âm này có thể là /ʌ/ hoặc /ə/ tùy trọng âm.",
  ER: "Đặt lưỡi ở giữa và hơi lùi, không chạm vòm miệng; giữ âm mang sắc thái /r/ của giọng Mỹ.",
  UH: "Đặt lưỡi hơi cao về phía sau và tròn môi nhẹ; khẩu hình thả lỏng hơn /uː/.",
  UW: "Nâng lưỡi về phía sau và tròn môi; nghe mẫu để giữ đúng chất lượng nguyên âm.",
  EY: "Chuyển liền từ /e/ về /ɪ/ trong một âm tiết; tránh tách thành hai tiếng.",
  AY: "Chuyển liền từ /a/ về /ɪ/ trong một âm tiết.",
  OY: "Bắt đầu với môi tròn ở /ɔ/ rồi chuyển về /ɪ/ trong một âm tiết.",
  AW: "Chuyển liền từ /a/ về /ʊ/, môi tròn dần ở cuối.",
  OW: "Chuyển liền từ /o/ về /ʊ/, môi tròn dần; không tách thành hai tiếng.",
};

export function phoneGuidance(sourcePhone: string) {
  return guides[sourcePhone.replace(/[0-2]$/, "")] ?? "Nghe mẫu, đọc chậm âm trong từ rồi ghép lại; giữ rõ phụ âm và nguyên âm, không tự thêm âm ở cuối.";
}
