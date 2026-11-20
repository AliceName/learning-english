"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import Icon, { type SiteIconName } from "@/components/site-icon";
import { loadSentences, saveSentence, sentenceKey, type PracticeResult, type PracticeSentence } from "@/lib/free-speaking-history";
import { feedbackMode, sentenceFeedback, wordFeedback } from "@/lib/pronunciation-feedback";
import FreeSpeakingDialog, { playSample } from "./free-speaking-dialog";
import { PronunciationLegend, pronunciationToneClasses } from "./pronunciation-feedback";
import styles from "./free-speaking.module.css";

const bands = {
  priority: { label: "Ưu tiên luyện", icon: "replay" },
  review: { label: "Nên nghe lại", icon: "wave" },
  good: { label: "Đạt chuẩn", icon: "check" },
  excellent: { label: "Xuất sắc", icon: "star" },
  pending: { label: "Chưa chấm", icon: "clock" },
} as const;
const filters = [
  { id: "all", label: "Tất cả", icon: "dashboard" },
  { id: "priority", label: "Cần luyện lại", icon: "replay" },
  { id: "review", label: "Nên nghe lại", icon: "wave" },
  { id: "good", label: "Đạt chuẩn", icon: "check" },
  { id: "excellent", label: "Xuất sắc", icon: "star" },
  { id: "saved", label: "Đã lưu sổ tay", icon: "bookmark" },
] as const;
type Filter = typeof filters[number]["id"];
type Sort = "newest" | "lowest" | "highest";
type Dialog = { sentence?: PracticeSentence; showResult?: boolean };
const pageSize = 5;
const dateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });
const number = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

function scoreOf(sentence: PracticeSentence) {
  const assessment = sentence.result?.assessment;
  return assessment && feedbackMode(assessment) !== "record_again" ? assessment.overallScore : null;
}

function bandOf(sentence: PracticeSentence): keyof typeof bands {
  const score = scoreOf(sentence);
  if (score === null) return sentence.result ? "priority" : "pending";
  if (score < 60) return "priority";
  if (score < 80) return "review";
  if (score < 90) return "good";
  return "excellent";
}

function Stat({ icon, label, children, tone }: { icon: SiteIconName; label: string; children: React.ReactNode; tone?: string }) {
  return <div className={styles.stat} data-tone={tone}>
    <span className={styles.statIcon}><Icon name={icon} /></span>
    <div><dt>{label}</dt><dd>{children}</dd></div>
  </div>;
}

export default function FreeSpeaking({ account }: { account: string }) {
  const [history, setHistory] = useState<PracticeSentence[] | null>(null);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const playback = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
  const listTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    loadSentences(account).then(data => { if (active) setHistory(data); }, () => {
      if (!active) return;
      setHistory([]);
      setNotice("Chưa mở được lịch sử trên trình duyệt. Bạn vẫn có thể luyện nói trong phiên này.");
    });
    return () => {
      active = false;
      window.speechSynthesis?.cancel();
      if (playback.current) {
        playback.current.audio.pause();
        URL.revokeObjectURL(playback.current.url);
        playback.current = null;
      }
    };
  }, [account]);

  const items = history ?? [];
  const scored = items.map(scoreOf).filter(score => score !== null);
  const average = scored.length ? scored.reduce((sum, score) => sum + score, 0) / scored.length : null;
  let goodWords = 0;
  let assessedWords = 0;
  for (const { result } of items) {
    if (!result) continue;
    for (const word of result.assessment.words) {
      const { tone } = wordFeedback(word, result.assessment);
      if (tone !== "unassessed") assessedWords++;
      if (tone === "good") goodWords++;
    }
  }
  const goodPercent = assessedWords ? Math.round(goodWords / assessedWords * 100) : null;
  const counts = { all: items.length, priority: 0, review: 0, good: 0, excellent: 0, pending: 0, saved: 0 };
  for (const item of items) {
    counts[bandOf(item)]++;
    if (item.saved) counts.saved++;
  }
  const search = query.trim().toLowerCase();
  const matches = items.filter(item => item.text.toLowerCase().includes(search)
    && (filter === "all" || (filter === "saved" ? item.saved : bandOf(item) === filter)))
    .sort((a, b) => {
      if (sort !== "newest") {
        const aScore = scoreOf(a) ?? (sort === "lowest" ? Infinity : -Infinity);
        const bScore = scoreOf(b) ?? (sort === "lowest" ? Infinity : -Infinity);
        if (aScore !== bScore) return sort === "lowest" ? aScore - bScore : bScore - aScore;
      }
      return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
    });
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;

  function stopAudio() {
    window.speechSynthesis?.cancel();
    if (playback.current) {
      playback.current.audio.pause();
      URL.revokeObjectURL(playback.current.url);
      playback.current = null;
    }
    setPlaying(null);
  }

  async function listenRecording(sentence: PracticeSentence) {
    const same = playing === sentence.id;
    stopAudio();
    if (same || !sentence.result) return;
    const url = URL.createObjectURL(sentence.result.recording);
    const audio = new Audio(url);
    playback.current = { audio, url };
    setPlaying(sentence.id);
    audio.onended = () => { if (playback.current?.audio === audio) stopAudio(); };
    try { await audio.play(); }
    catch {
      if (playback.current?.audio !== audio) return;
      stopAudio();
      setNotice("Chưa phát được bản ghi. Vui lòng thử lại.");
    }
  }

  async function persist(sentence: PracticeSentence, changes?: Parameters<typeof saveSentence>[1]) {
    let updated: PracticeSentence;
    try { updated = await saveSentence(sentence, changes); }
    catch {
      setNotice("Chưa lưu được vào trình duyệt. Thay đổi này chỉ có trong phiên hiện tại.");
      updated = { ...sentence, ...changes };
    }
    setHistory(previous => [updated, ...(previous ?? []).filter(item => item.id !== updated.id)]);
    return updated;
  }

  function create(text: string) {
    const id = sentenceKey(text);
    const existing = items.find(item => item.id === id);
    setFilter("all"); setQuery(""); setSort("newest"); setPage(1);
    return existing ?? persist({ account, id, text, saved: false, updatedAt: Date.now() });
  }

  async function saveResult(sentence: PracticeSentence, result: PracticeResult) {
    setPage(1);
    return persist(sentence, { result, updatedAt: Date.now() });
  }

  async function toggleSaved(sentence: PracticeSentence) {
    if (saving !== null) return;
    setSaving(sentence.id);
    try { await persist(sentence, { saved: !sentence.saved }); }
    finally { setSaving(null); }
  }

  function openDialog(next: Dialog) {
    stopAudio();
    setDialog(next);
  }

  function selectFilter(next: Filter) {
    stopAudio();
    setFilter(next); setPage(1);
  }

  function showPriority() {
    setQuery(""); setSort("lowest"); selectFilter("priority");
    listTitle.current?.focus();
  }

  return <main id="main-content" tabIndex={-1} className={styles.dashboard}>
    <header className={styles.hero}>
      <p className={styles.breadcrumb}><Icon name="mic" /> Luyện tập kỹ năng <Icon name="chevron" /> <strong>Luyện nói</strong></p>
      <div className={styles.intro}>
        <span className={styles.heroIcon}><Icon name="mic" /></span>
        <div><h1>Luyện nói</h1><p>Tự tạo câu tiếng Anh, luyện đọc và theo dõi tiến bộ phát âm cùng AI.</p></div>
      </div>
      <Image className={styles.mascot} src="/illustrations/speaking-cat.svg" alt="" width={320} height={224} priority />
      <div className={styles.heroActions}>
        <button className={styles.primary} disabled={!history} onClick={() => openDialog({})}><Icon name="writing" /> Tạo câu &amp; thực hành ngay</button>
        <button className={styles.secondary} disabled={!counts.priority} onClick={showPriority}><Icon name="replay" /> Luyện lại câu điểm thấp</button>
      </div>
    </header>

    <dl className={styles.stats} aria-label="Thống kê luyện nói">
      <Stat icon="clipboard" label="Tổng số câu đã tạo">{history ? items.length : "—"}</Stat>
      <Stat icon="star" label="Điểm phát âm trung bình" tone="cyan">{average === null ? "—" : <>{number.format(average)}<small>/100</small></>}</Stat>
      <Stat icon="trend" label="Tỷ lệ từ đạt ngưỡng tốt" tone="cyan">{goodPercent === null ? "—" : <>
        {goodPercent}%<span className={styles.progress} aria-hidden="true"><span style={{ width: `${goodPercent}%` }} /></span>
      </>}</Stat>
      <Stat icon="compass" label="Câu cần luyện lại" tone="red">{history ? counts.priority : "—"}</Stat>
    </dl>

    <div className={styles.legend}><PronunciationLegend /></div>

    <section aria-labelledby="speaking-history">
      <div className={styles.toolbar}>
        <h2 id="speaking-history" ref={listTitle} tabIndex={-1}>Lịch sử câu luyện nói</h2>
        <div className={styles.searchRow}>
          <label className={styles.search}><Icon name="search" /><input type="search" value={query} aria-label="Tìm trong các câu luyện nói" placeholder="Tìm từ vựng hoặc câu đã luyện…"
            onChange={event => { stopAudio(); setQuery(event.target.value); setPage(1); }} /></label>
          <select value={sort} aria-label="Sắp xếp lịch sử" onChange={event => { stopAudio(); setSort(event.target.value as Sort); setPage(1); }}>
            <option value="newest">Mới nhất trước</option><option value="lowest">Điểm thấp trước</option><option value="highest">Điểm cao trước</option>
          </select>
        </div>
        <div className={styles.filters} aria-label="Lọc câu luyện nói">
          {filters.map(({ id, label, icon }) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => selectFilter(id)}>
            <Icon name={icon} /> {label} ({counts[id]})
          </button>)}
        </div>
      </div>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {!history ? <p className={styles.empty} role="status">Đang tải lịch sử…</p> : matches.length === 0 ?
        <div className={styles.empty}>
          <span className={styles.emptyIcon}><Icon name={items.length ? "search" : "mic"} /></span>
          <h3>{items.length ? "Không tìm thấy câu phù hợp" : "Bắt đầu với câu đầu tiên của bạn"}</h3>
          <p>{items.length ? "Thử đổi từ khóa hoặc bộ lọc." : "Nhập một câu tiếng Anh bạn muốn nói, ghi âm và nhận điểm phát âm theo từng từ."}</p>
          {items.length ? <button className={styles.secondary} onClick={() => { setQuery(""); selectFilter("all"); }}>Xóa bộ lọc</button> :
            <button className={styles.primary} onClick={() => openDialog({})}><Icon name="plus" /> Tạo câu luyện nói</button>}
        </div> :
        <ul className={styles.entries}>{matches.slice(start, start + pageSize).map(sentence => {
          const band = bandOf(sentence);
          const badge = bands[band];
          const score = scoreOf(sentence);
          const assessment = sentence.result?.assessment;
          return <li key={sentence.id} className={styles.entry} data-band={band}>
            <div className={styles.entryMeta}>
              <time dateTime={new Date(sentence.updatedAt).toISOString()}><Icon name="clock" /> {dateTime.format(sentence.updatedAt)}</time>
              <span className={styles.badge} data-band={band}><Icon name={badge.icon} />
                {score !== null && <><strong>{number.format(score)}</strong> /100 <span aria-hidden="true">·</span> </>}{badge.label}
              </span>
            </div>
            <p className={styles.sentence} lang="en">“{assessment ? sentenceFeedback(sentence.text, assessment).map((part, index) =>
              part.feedback ? <mark className={pronunciationToneClasses[part.feedback.tone]} data-tone={part.feedback.tone}
                title={part.feedback.label} key={index}>{part.text}</mark> : part.text) : sentence.text}”</p>
            {assessment && band === "priority" && <p className={styles.priorityNote}><Icon name="bulb" /> {assessment.feedback}</p>}
            <div className={styles.entryActions}>
              {assessment && <button onClick={() => void listenRecording(sentence)} aria-pressed={playing === sentence.id}>
                <Icon name={playing === sentence.id ? "pause" : "play"} /> {playing === sentence.id ? "Dừng nghe" : `Nghe bản ghi (${number.format(assessment.durationSeconds)}s)`}
              </button>}
              <button onClick={() => { stopAudio(); playSample(sentence.text, setNotice); }}><Icon name="wave" /> Nghe giọng mẫu</button>
              {assessment && <button onClick={() => openDialog({ sentence, showResult: true })}><Icon name="sparkles" /> Xem chi tiết</button>}
              <button className={styles.bookmark} aria-label={sentence.saved ? "Bỏ lưu sổ tay" : "Lưu vào sổ tay"} aria-pressed={sentence.saved}
                title={sentence.saved ? "Bỏ lưu sổ tay" : "Lưu vào sổ tay"} disabled={saving !== null} onClick={() => void toggleSaved(sentence)}>
                <Icon name="bookmark" />
              </button>
              <button className={styles.primary} onClick={() => openDialog({ sentence })}><Icon name="mic" />
                {band === "priority" ? "Luyện lại ngay" : assessment ? "Luyện lại" : "Bắt đầu luyện"}
              </button>
            </div>
          </li>;
        })}</ul>}
      {matches.length > 0 && <div className={styles.pagination}>
        <span>Hiển thị {start + 1}–{Math.min(start + pageSize, matches.length)} trên tổng số <strong>{matches.length}</strong> câu</span>
        <nav aria-label="Phân trang lịch sử">
          <button disabled={currentPage <= 1} aria-label="Trang trước" onClick={() => { stopAudio(); setPage(currentPage - 1); }}>‹</button>
          <span aria-current="page">{currentPage} / {totalPages}</span>
          <button disabled={currentPage >= totalPages} aria-label="Trang sau" onClick={() => { stopAudio(); setPage(currentPage + 1); }}>›</button>
        </nav>
      </div>}
      <p className={styles.storageNote}>Lịch sử trên trình duyệt này lưu lần chấm gần nhất của mỗi câu.</p>
    </section>
    {dialog && <FreeSpeakingDialog initialSentence={dialog.sentence} showResult={dialog.showResult} onCreate={create}
      onScore={saveResult} onClose={() => setDialog(null)} />}
  </main>;
}
