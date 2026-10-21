"use client";

import { useId, useRef, useState } from "react";
import Icon from "@/components/site-icon";
import styles from "./home.module.css";

export default function DocumentPreview() {
  const input = useRef<HTMLInputElement>(null);
  const messageId = useId();
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  function selectFile(selected?: File) {
    setError("");
    if (!selected) return;
    if (!/\.(pdf|pptx|docx|jpe?g|png|webp)$/i.test(selected.name)) { setError("Chọn tệp PDF, PPTX, DOCX hoặc ảnh JPG, PNG, WebP."); return; }
    if (selected.size === 0 || selected.size > 50 * 1024 * 1024) { setError("Tệp cần có nội dung và dung lượng không quá 50 MB."); return; }
    setFile({ name: selected.name, size: selected.size });
  }

  return (
    <div id="document-preview" className={styles.documentCard}>
      <div className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]); }}>
        <span className={styles.uploadIcon}><Icon name="upload" /></span>
        <h3>Kéo thả tài liệu của bạn vào đây</h3>
        <p>PDF, slide bài giảng, báo cáo, hình ảnh<br />Dung lượng tối đa 50 MB</p>
        <input ref={input} type="file" hidden accept=".pdf,.pptx,.docx,.jpg,.jpeg,.png,.webp" aria-label="Chọn tài liệu để xem trước" onChange={event => { selectFile(event.target.files?.[0]); event.target.value = ""; }} />
        <button type="button" onClick={() => input.current?.click()} aria-describedby={messageId}>Chọn tệp từ máy tính <Icon name="arrow" /></button>
        <p id={messageId} className={styles.localFileNote}>Xem trước trên thiết bị, tệp chưa được tải lên.</p>
      </div>
      <div className={styles.filePreview} aria-live="polite">
        {error && <p className={styles.fileError} role="alert">{error}</p>}
        <div className={styles.fileTitle}><span><Icon name="file" /></span><div><strong>{file?.name ?? "Quarterly_Financial_Report.pdf"}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · Đã chọn để xem trước` : "Ví dụ minh họa · Phân tích cấu trúc 4 kỹ năng"}</small></div></div>
        {file ? <p className={styles.demoNote}>Đã chọn tài liệu. Tính năng tạo khóa học từ tệp đang được phát triển.</p> : <><div className={styles.progressTrack}><span /></div><div className={styles.fileReady}><span>100%</span><strong><Icon name="check" />Sẵn sàng</strong></div><div className={styles.resultTags}><span>✨ 42 từ vựng C1</span><span>🎧 3 audio mô phỏng</span><span>💬 1 kịch bản đàm phán</span></div></>}
      </div>
    </div>
  );
}
