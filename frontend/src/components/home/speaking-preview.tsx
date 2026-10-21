"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/site-icon";
import styles from "./home.module.css";

const sentence = "I strongly believe this strategic partnership will accelerate our market expansion.";
const waveHeights = [24, 40, 56, 32, 48, 64, 28, 44, 20, 56, 36, 64, 40, 16, 32, 48, 20, 38, 52, 28, 46, 60, 32];

export default function SpeakingPreview() {
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

  function playSample() {
    if (!("speechSynthesis" in window)) {
      setMessage("Trình duyệt này chưa hỗ trợ đọc câu mẫu. Bạn có thể luyện đọc theo câu phía trên.");
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    if (playing) { setPlaying(false); return; }
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    utterance.voice = synth.getVoices().find(voice => voice.lang === "en-US") ?? null;
    utterance.onend = () => setPlaying(false);
    utterance.onerror = event => {
      setPlaying(false);
      if (event.error !== "canceled" && event.error !== "interrupted") setMessage("Chưa thể phát câu mẫu. Vui lòng thử lại hoặc kiểm tra giọng đọc trên thiết bị.");
    };
    setMessage("");
    setPlaying(true);
    synth.speak(utterance);
  }

  return (
    <div className={styles.studio} aria-label="Bản xem trước luyện phát âm với AI">
      <div className={styles.studioToolbar}>
        <div className={styles.windowLabel}><span className={styles.windowDots} aria-hidden="true"><i /><i /><i /></span><span>lingua.ai/studio/speaking-coach</span></div>
        <span className={styles.streak}><Icon name="flame" />14 ngày streak</span>
      </div>
      <div className={styles.studioGrid}>
        <div className={styles.speakingPanel}>
          <div className={styles.speakingLabel}><span className={styles.levelBadge}>B2 → C1</span><span>Luyện hội thoại thương thuyết</span><span className={styles.previewLabel}>Bản minh họa</span></div>
          <h2 lang="en">&ldquo;{sentence}&rdquo;</h2>
          <p className={styles.phonetics} lang="en"><span>aɪ</span><span>ˈstrɔːŋ.li</span><span>bɪˈliːv</span><span>ðɪs</span><mark>strəˈtiː.dʒɪk</mark><span>ˈpɑːt.nə.ʃɪp</span></p>
          <div className={`${styles.waveform} ${playing ? styles.wavePlaying : ""}`} aria-hidden="true">{waveHeights.map((height, index) => <span key={index} style={{ height, animationDelay: `${index * 65}ms` }} />)}</div>
          <div className={styles.speakingControls}>
            <div className={styles.micStatus}><span className={styles.micIcon}><Icon name="mic" /></span><span><strong>{playing ? "Đang phát câu mẫu…" : "Lắng nghe và luyện nói"}</strong><small>Tập nói theo nhịp độ của bạn</small></span></div>
            <button type="button" onClick={playSample} aria-pressed={playing}><Icon name={playing ? "pause" : "volume"} />{playing ? "Dừng nghe mẫu" : "Nghe mẫu Native US"}</button>
          </div>
          <p className={styles.audioMessage} role="status">{message}</p>
        </div>
        <div className={styles.scorePanel}>
          <span className={styles.scoreHeading}>Chỉ số phân tích AI</span>
          <div className={styles.scoreRing} role="img" aria-label="Điểm AI minh họa: 98 trên 100">
            <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" stroke="#e2e7ff" strokeWidth="8" /><circle cx="50" cy="50" r="42" fill="none" stroke="#2563eb" strokeWidth="8" strokeDasharray="264" strokeDashoffset="8" strokeLinecap="round" /></svg>
            <div><strong>98</strong><span>ĐIỂM AI</span></div>
          </div>
          <strong className={styles.scoreCaption}>Độ chuẩn xác bản ngữ</strong>
          <dl className={styles.scoreBreakdown}><div><dt><i />Âm tiết nối (Linking)</dt><dd>99%</dd></div><div><dt><i />Ngữ điệu câu (Intonation)</dt><dd>96%</dd></div><div><dt><i />Trọng âm (Stress)</dt><dd>98%</dd></div></dl>
          <div className={styles.coachTip}><Icon name="bulb" /><p>Tuyệt vời! Bạn đã nhấn trọng âm âm tiết thứ hai ở từ <strong lang="en">strategic</strong> cực kỳ tự nhiên.</p></div>
        </div>
      </div>
    </div>
  );
}
