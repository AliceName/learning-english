"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Icon from "@/components/site-icon";
import { aiJson, aiRequest, aiStatus, type AiConfig, type AiJob } from "@/lib/ai-courses";
import { SESSION_CHANGED } from "@/lib/session-events";
import { authoringSkills, lessonKinds } from "@/lib/admin-courses";
import { aiConfigForGoal, courseFileError, courseLevels, learningGoals, personalizedAiConfig } from "@/lib/ai-course-personalization";
import AiLessonPreview from "./lesson-preview";
import styles from "./studio.module.css";

const base = "/api/ai-courses";
const busyStates = ["queued", "planning", "generating", "generating_audio"];
type OutlineEdit = { title: string; description: string; lessons: { id: string; title: string; objective: string }[] };
const skillDescriptions = { speaking: "Nói tự tin", listening: "Nghe chủ động", reading: "Đọc hiểu sâu", writing: "Viết rõ ý", grammar: "Vững cấu trúc" };
const dateFormat = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });

export default function CourseGenerator({ fullName, targetLevel }: { fullName?: string; targetLevel?: string | null }) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [job, setJob] = useState<AiJob | null>(null);
  const [config, setConfig] = useState(() => personalizedAiConfig(targetLevel));
  const [goalPreset, setGoalPreset] = useState<string | null>("document");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [edit, setEdit] = useState<OutlineEdit | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<boolean | null>(null);
  const [sessionActive, setSessionActive] = useState(true);
  const key = useRef<string | null>(null);
  const selected = useRef<string | null>(null);
  const sessionValid = useRef(true);
  const editRevision = useRef("");
  const fileInput = useRef<HTMLInputElement>(null);
  const jobPanel = useRef<HTMLElement>(null);
  const firstName = fullName?.trim().split(/\s+/).at(-1)?.slice(0, 40) || "bạn";
  const totalLessons = config.skills.length * config.lessonCount;
  const profileLevel = courseLevels.find(level => level.value === targetLevel);
  const locked = pending || !sessionActive;
  const jobId = job?.id;
  const jobStatus = job?.status;
  const accept = useCallback((item: AiJob) => {
    if (!sessionValid.current) return;
    const revision = `${item.id}/${item.outlineRevision}`;
    if (editRevision.current !== revision) {
      editRevision.current = revision;
      setEdit(item.outline ? { title: item.outline.title, description: item.outline.description,
        lessons: item.outline.lessons.map(({ id, title, objective }) => ({ id, title, objective })) } : null);
    }
    selected.current = item.id; setJob(item);
    setJobs(list => [item, ...list.filter(old => old.id !== item.id)]);
    history.replaceState(null, "", `?job=${item.id}`);
  }, []);

  useEffect(() => {
    sessionValid.current = true;
    const invalidate = () => {
      sessionValid.current = false; selected.current = null; key.current = null;
      setSessionActive(false);
      setJob(null); setEdit(null); setJobs([]); setReady(null); setPending(false);
      setFile(null); setError("Phiên đăng nhập đã thay đổi. Hãy đăng nhập lại để tiếp tục.");
    };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SESSION_CHANGED);
    if (channel) channel.onmessage = invalidate;
    window.addEventListener(SESSION_CHANGED, invalidate);
    return () => { sessionValid.current = false; channel?.close(); window.removeEventListener(SESSION_CHANGED, invalidate); };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      aiRequest<{ items: AiJob[] }>(base, { signal: abort.signal }),
      aiRequest<{ configured: boolean }>(`${base}/options`, { signal: abort.signal }),
    ]).then(async ([list, options]) => {
      if (abort.signal.aborted || !sessionValid.current) return;
      setJobs(list.items); setReady(options.configured);
      const id = new URLSearchParams(location.search).get("job");
      if (id && /^[a-f\d-]{36}$/i.test(id)) {
        const item = await aiRequest<AiJob>(`${base}/${id}`, { signal: abort.signal });
        if (!abort.signal.aborted) accept(item);
      }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [accept]);

  useEffect(() => {
    if (!jobId || !jobStatus) return;
    const abort = new AbortController();
    let refreshing = false;
    const refresh = () => {
      if (refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      void aiRequest<AiJob>(`${base}/${jobId}`, { signal: abort.signal }).then(item => {
        if (!abort.signal.aborted && selected.current === item.id) {
          accept(item);
        }
      }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); })
        .finally(() => { refreshing = false; });
    };
    const interval = busyStates.includes(jobStatus) ? 3000 : jobStatus === "failed" ? 10000 : 0;
    const timer = interval ? setInterval(refresh, interval) : null;
    if (jobStatus === "failed") refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { if (timer) clearInterval(timer); abort.abort(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [jobId, jobStatus, accept]);
  useEffect(() => {
    if (jobId) jobPanel.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [jobId]);
  async function run(action: () => Promise<AiJob>) {
    setError(""); setPending(true);
    try { accept(await action()); } catch (failure) { setError(failure instanceof Error ? failure.message : "Chưa thực hiện được yêu cầu."); }
    finally { setPending(false); }
  }
  function change<K extends keyof AiConfig>(field: K, value: AiConfig[K]) {
    key.current = null; setConfig(current => ({ ...current, [field]: value }));
  }
  function chooseFile(value: File | null) {
    key.current = null;
    const issue = value && courseFileError(value);
    if (issue) {
      setError(issue); setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setFile(value); setError("");
    if (!value && fileInput.current) fileInput.current.value = "";
  }
  async function create() {
    if (pending || !sessionValid.current || ready !== true) return;
    if (config.skills.length === 0) { setError("Hãy chọn ít nhất một kỹ năng cho khóa học."); return; }
    if (!file) { setError("Hãy chọn tài liệu PDF hoặc DOCX."); return; }
    const issue = courseFileError(file);
    if (issue) { setError(issue); return; }
    const form = new FormData(); form.set("file", file); form.set("config", JSON.stringify(config));
    key.current ??= crypto.randomUUID();
    await run(() => aiRequest<AiJob>(base, { method: "POST", headers: { "Idempotency-Key": key.current! }, body: form }));
  }

  return <main id="main-content" tabIndex={-1} className={styles.page}>
    <div className={styles.hero}>
      <nav className={styles.breadcrumb} aria-label="Đường dẫn"><Link href="/dashboard" aria-label="Tổng quan"><Icon name="home" /></Link><Icon name="chevron" /><Link href="/courses">Khóa học</Link><Icon name="chevron" /><span>Tạo khóa học AI</span></nav>
      <header className={styles.intro}>
        <div className={styles.introCopy}>
          <p className={styles.greeting}>Chào {firstName}, cùng tạo một lộ trình mới.</p>
          <h1>Học điều bạn cần.<br /><span>Theo cách của bạn.</span></h1>
          <p className={styles.introText}>Biến tài liệu của bạn thành khóa học tiếng Anh.<br />Bạn chọn mục tiêu, AI giúp bạn xây dựng từng bài học.</p>
          <ul className={styles.benefits} aria-label="Lợi ích khóa học AI"><li><Icon name="book" />Cá nhân hóa nội dung</li><li><Icon name="bolt" />Tạo khóa học nhanh</li><li><Icon name="trend" />Học hiệu quả hơn</li></ul>
        </div>
        <div className={styles.heroArt} aria-hidden="true"><Image src="/illustrations/ai-course-hero.png" alt="" width={1536} height={1024} sizes="(max-width: 600px) 250px, (max-width: 1449px) 34vw, 400px" loading="eager" /></div>
        <div className={styles.introAside}><span className={styles.private}><Icon name="shield" />Không gian học tập cá nhân</span><Link href="/courses?source=user_upload">Khóa học của tôi<Icon name="arrow" /></Link><a href="#ai-course-history">Lượt tạo gần đây<small>{jobs.length}</small></a></div>
      </header>
    </div>
    <ol className={styles.workflow} aria-label="Quy trình tạo khóa học"><li><span>01</span><div><strong>Thiết lập lộ trình</strong><small>Tài liệu & mục tiêu của bạn</small></div></li><li><span>02</span><div><strong>Duyệt dàn ý</strong><small>Điều chỉnh trước khi tạo bài</small></div></li><li><span>03</span><div><strong>Sẵn sàng học</strong><small>Kiểm tra & lưu khóa học riêng</small></div></li></ol>
    {error && <div role="alert" className={styles.error}><Icon name="bulb" /><span>{error}</span></div>}
    {ready === false && <p role="status" className={styles.notice}>Tạo khóa học AI tạm thời chưa khả dụng. Bạn vẫn có thể chuẩn bị tài liệu và thiết lập lộ trình trước.</p>}
    <div className={styles.layout}>
      <form id="ai-course-form" className={styles.editor} onSubmit={event => { event.preventDefault(); void create(); }}>
        <fieldset disabled={locked} className={styles.editorFields}>
          <section className={styles.formSection} aria-labelledby="source-title">
            <div className={styles.sectionHeading}><span>01</span><div><h2 id="source-title">Bắt đầu từ tài liệu của bạn</h2><p>Một chương sách, tài liệu công việc hay chủ đề bạn yêu thích.</p></div></div>
            <input ref={fileInput} className={styles.fileInput} type="file" id="ai-course-source" accept=".pdf,.docx" aria-label="Chọn tài liệu PDF hoặc DOCX" onChange={event => chooseFile(event.target.files?.[0] ?? null)} />
            <div className={styles.dropzone} data-dragging={dragging} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (!locked) chooseFile(event.dataTransfer.files?.[0] ?? null); }}>
              {file ? <div className={styles.selectedFile}><span className={styles.fileIcon}><Icon name="file" /></span><div><strong>{file.name}</strong><span>{Math.max(1, Math.ceil(file.size / 1024)).toLocaleString("vi-VN")} KB · Đã chọn tài liệu</span></div><button type="button" className={styles.removeFile} aria-label="Gỡ tài liệu đã chọn" onClick={() => chooseFile(null)}><Icon name="close" /></button></div>
                : <label htmlFor="ai-course-source" className={styles.dropLabel}><span className={styles.uploadIcon}><Icon name="upload" /></span><strong>Kéo thả tài liệu vào đây</strong><span>hoặc <b>chọn tệp từ máy tính<Icon name="arrow" /></b></span></label>}
              <p>PDF hoặc DOCX · Tối đa 10 MB</p>
            </div>
            <p className={styles.fieldNote}><Icon name="file" />PDF có văn bản, tối đa 30 trang. Chưa hỗ trợ tài liệu scan.</p>
          </section>
          <section className={styles.formSection} aria-labelledby="goal-title">
            <div className={styles.sectionHeading}><span>02</span><div><h2 id="goal-title">Bạn muốn tiến bộ ở đâu?</h2><p>Chọn mục tiêu để gợi ý kỹ năng, sau đó điều chỉnh theo ý bạn.</p></div></div>
            <div className={styles.goalChoices} role="group" aria-label="Mục tiêu học tập gợi ý">{learningGoals.map(preset => <button key={preset.id} type="button" aria-pressed={goalPreset === preset.id} onClick={() => { key.current = null; setGoalPreset(preset.id); setConfig(current => aiConfigForGoal(current, preset.id)); }}><Icon name={preset.icon} /><span><strong>{preset.title}</strong><small>{preset.description}</small></span><i aria-hidden="true">{goalPreset === preset.id && <Icon name="check" />}</i></button>)}</div>
            <label className={styles.goalField}>Mục tiêu cụ thể của bạn<textarea aria-label="Mục tiêu cụ thể của bạn" required minLength={5} maxLength={1000} rows={3} value={config.goal} onChange={event => { change("goal", event.target.value); setGoalPreset(null); }} placeholder="Ví dụ: Tự tin trao đổi với khách hàng, viết email ngắn gọn và hiểu tài liệu chuyên ngành…" /><span>{config.goal.length}/1.000 ký tự</span></label>
          </section>
          <section className={styles.formSection} aria-labelledby="personalize-title">
            <div className={styles.sectionHeading}><span>03</span><div><h2 id="personalize-title">Thiết kế lộ trình vừa sức</h2><p>Chọn trình độ và các kỹ năng bạn muốn tập trung.</p></div></div>
            <fieldset className={styles.choiceGroup}><legend>Trình độ khóa học</legend><div className={styles.levelChoices}>{courseLevels.map(level => <label key={level.value}><input type="radio" name="ai-course-level" value={level.value} checked={config.difficultyLevel === level.value} onChange={() => change("difficultyLevel", level.value)} /><strong>{level.value}</strong><span>{level.label}</span></label>)}</div>{profileLevel && <p className={styles.profileNote}><Icon name="person" />Gợi ý từ mục tiêu {profileLevel.value} trong hồ sơ của bạn.{config.difficultyLevel !== targetLevel && <button type="button" onClick={() => change("difficultyLevel", profileLevel.value)}>Dùng {profileLevel.value}</button>}</p>}</fieldset>
            <fieldset className={styles.choiceGroup}><legend>Kỹ năng muốn luyện <span>{config.skills.length}/5 kỹ năng</span></legend><div className={styles.skillChoices}>{authoringSkills.map(skill => <label key={skill}><input type="checkbox" checked={config.skills.includes(skill)} onChange={event => change("skills", event.target.checked ? authoringSkills.filter(item => item === skill || config.skills.includes(item)) : config.skills.filter(item => item !== skill))} /><Icon name={lessonKinds[skill].icon} /><strong>{lessonKinds[skill].label}</strong><span>{skillDescriptions[skill]}</span></label>)}</div><button type="button" className={styles.selectAll} disabled={config.skills.length === 5} onClick={() => change("skills", [...authoringSkills])}>Chọn cả 5 kỹ năng<Icon name="plus" /></button></fieldset>
            <div className={styles.formGrid}><label>Số bài cho mỗi kỹ năng<select value={config.lessonCount} onChange={event => change("lessonCount", Number(event.target.value))}>{[1, 2, 3].map(value => <option key={value} value={value}>{value} bài / kỹ năng</option>)}</select></label>{config.skills.some(skill => skill !== "writing") && <label>Số câu luyện mỗi bài<select value={config.questionsPerLesson} onChange={event => change("questionsPerLesson", Number(event.target.value))}>{[3, 4, 5].map(value => <option key={value} value={value}>{value} câu / bài</option>)}</select></label>}</div>
            {config.skills.includes("listening") && <details className={styles.audioSettings}><summary><Icon name="headphones" />Tùy chỉnh audio Listening<Icon name="chevron" /></summary><div className={styles.formGrid}><label>Độ dài audio Listening<select value={config.targetAudioSeconds} onChange={event => change("targetAudioSeconds", Number(event.target.value))}>{[30, 60, 90, 120].map(value => <option key={value} value={value}>{value} giây / bài</option>)}</select></label><label>Giọng đọc Listening<select value={config.voice} onChange={event => change("voice", event.target.value)}>{["Kore", "Puck", "Aoede", "Charon"].map(voice => <option key={voice}>{voice}</option>)}</select></label></div><p className={styles.fieldNote}>Độ dài audio thực tế có thể thay đổi theo nội dung.</p></details>}
          </section>
        </fieldset>
      </form>
      <aside className={styles.rail} aria-labelledby="plan-title">
        <div className={styles.planCard}>
          <div className={styles.planCover}><Image src="/images/courses/ai-default.png" alt="" width={1672} height={941} sizes="(max-width: 850px) 100vw, 310px" loading="eager" /><span><Icon name="sparkles" />LEWA PERSONAL COURSE</span></div>
          <div className={styles.planBody}><span className={styles.eyebrow}>LỘ TRÌNH SẮP TẠO</span><h2 id="plan-title">Dành riêng cho {firstName}</h2><p className={styles.planGoal}>{learningGoals.find(preset => preset.id === goalPreset)?.title || "Mục tiêu riêng của bạn"}</p>
            <div className={styles.planStats}><div><strong>{config.difficultyLevel}</strong><span>trình độ CEFR</span></div><div><strong>{totalLessons.toString().padStart(2, "0")}</strong><span>bài học dự kiến</span></div></div>
            <ol className={styles.planSkills}>{config.skills.map((skill, index) => <li key={skill}><span>{String(index + 1).padStart(2, "0")}</span><Icon name={lessonKinds[skill].icon} /><strong>{lessonKinds[skill].label}</strong><small>{config.lessonCount} bài</small></li>)}</ol>
            {!config.skills.length && <p className={styles.fieldNote}>Chọn ít nhất một kỹ năng để bắt đầu.</p>}
            <div className={styles.planDocument}><Icon name="file" /><span>{file?.name || "Chưa chọn tài liệu"}</span>{file && <Icon name="check" />}</div>
            <button className={styles.primary} form="ai-course-form" type="submit" disabled={locked || ready !== true || !config.skills.length}>{pending ? "Đang xử lý…" : ready === null ? "Đang kiểm tra…" : "Tạo dàn ý khóa học"}<Icon name="arrow" /></button>
            <p className={styles.approvalNote}>Bạn sẽ duyệt và chỉnh dàn ý trước khi AI tạo nội dung bài học.</p>
          </div>
          <div className={styles.planFooter}><Icon name="shield" /><span>Khóa học chỉ hiển thị với bạn.</span></div>
        </div>
        <div className={styles.dataNote}><span className={styles.noteIcon}><Icon name="bulb" /></span><p>Tài liệu được gửi đến Gemini để tạo nội dung theo mục tiêu bạn chọn.<small>Bản thử · Tối đa 3 lượt tạo mỗi ngày</small></p></div>
      </aside>
    </div>
    <section id="ai-course-history" className={`${styles.panel} ${styles.historyPanel}`} aria-labelledby="history-title"><div className={styles.historyHeading}><div><span className={styles.eyebrow}>TIẾP TỤC HÀNH TRÌNH</span><h2 id="history-title">Lượt tạo của bạn</h2><p>Lộ trình đang tạo được lưu để bạn có thể quay lại bất cứ lúc nào.</p></div><span>{jobs.length} lượt tạo</span></div>
      <div className={styles.history}>{jobs.length === 0 && <div className={styles.emptyHistory}><Icon name="file" /><p>{ready === null ? error ? "Chưa tải được lịch sử. Hãy tải lại trang để kiểm tra." : "Đang tải lượt tạo…" : "Chưa có lượt tạo nào. Khóa học đầu tiên của bạn bắt đầu từ tài liệu phía trên."}</p></div>}{jobs.map(item => <button disabled={locked} key={item.id} type="button" aria-pressed={job?.id === item.id} onClick={() => void run(() => aiRequest<AiJob>(`${base}/${item.id}`))}><span className={styles.historyIcon}><Icon name={item.status === "completed" ? "check" : busyStates.includes(item.status) ? "clock" : "file"} /></span><span className={styles.historyName}><strong>{item.outline?.title ?? item.fileName}</strong><small>{item.config.difficultyLevel} · {item.totalLessons} bài · {dateFormat.format(new Date(item.createdAt))}</small></span><span className={styles.historyStatus} data-state={item.status}>{aiStatus[item.status] ?? item.status}</span><Icon name="arrow" /></button>)}</div>
    </section>
    {job && <section ref={jobPanel} tabIndex={-1} className={`${styles.panel} ${styles.jobPanel}`} aria-labelledby="job-title">
      <div className={styles.heading}><span className={styles.number}>02</span><div><h2 id="job-title">{job.nextAttemptAt ? "Đang chờ tự tiếp tục" : aiStatus[job.status] ?? job.status}</h2><p>{job.fileName} · {job.config.difficultyLevel} · {job.completedLessons}/{job.totalLessons} bài đã tạo</p><p>{(job.config.skills ?? ["listening"]).map(skill => lessonKinds[skill].label).join(" · ")}</p></div></div>
      <ol className={styles.steps}>{["Tài liệu & kỹ năng", "Duyệt dàn ý", "Tạo nội dung", "Lưu khóa học"].map((step, index) => <li key={step} data-done={index <= (job.status === "completed" ? 3 : job.status === "awaiting_review" || job.status.startsWith("generating") ? 2 : job.outline ? 1 : 0)}>{step}</li>)}</ol>
      {job.error && <p className={styles.notice}>{job.error.message}{job.nextAttemptAt && <> Tự tiếp tục lúc {dateFormat.format(new Date(job.nextAttemptAt))}.</>}</p>}
      {busyStates.includes(job.status) && <p role="status">{job.nextAttemptAt ? "Lượt tạo được giữ để tự tiếp tục sau thời gian chờ." : "Đang xử lý. Bạn có thể rời trang và quay lại lượt tạo này."}</p>}
      {job.status === "failed" && <button type="button" className={styles.secondary} disabled={pending} onClick={() => void run(() => aiRequest<AiJob>(`${base}/${job.id}/retry`, aiJson("POST")))}>Thử lại từ bước đã lưu</button>}
      {job.outline && <p className={styles.summary}>{job.outline.summary}</p>}
      {job.status === "awaiting_outline" && edit && <form onSubmit={event => {
        event.preventDefault(); void run(async () => {
          const updated = await aiRequest<AiJob>(`${base}/${job.id}/outline`, aiJson("PUT", { revision: job.outlineRevision, ...edit }));
          accept(updated);
          return aiRequest<AiJob>(`${base}/${job.id}/generate`, aiJson("POST", { revision: updated.outlineRevision }));
        });
      }}><fieldset className={styles.fields} disabled={pending}>
        <label>Tên khóa học<input required maxLength={255} value={edit.title} onChange={event => setEdit({ ...edit, title: event.target.value })} /></label>
        <label>Mô tả<textarea required maxLength={10000} rows={3} value={edit.description} onChange={event => setEdit({ ...edit, description: event.target.value })} /></label>
        {edit.lessons.map((lesson, index) => <div key={lesson.id} className={styles.outlineLesson}><strong>Bài {index + 1} · {lessonKinds[job.outline!.lessons.find(item => item.id === lesson.id)!.skillType ?? "listening"].label}</strong><label>Tên bài<input required maxLength={255} value={lesson.title} onChange={event => setEdit({ ...edit, lessons: edit.lessons.map(item => item.id === lesson.id ? { ...item, title: event.target.value } : item) })} /></label><label>Mục tiêu<textarea required maxLength={1000} rows={2} value={lesson.objective} onChange={event => setEdit({ ...edit, lessons: edit.lessons.map(item => item.id === lesson.id ? { ...item, objective: event.target.value } : item) })} /></label></div>)}
        <button className={styles.primary} type="submit">Duyệt dàn ý &amp; tạo khóa học →</button>
      </fieldset></form>}
      {(job.status === "awaiting_review" || job.status === "completed") && job.outline && <>
        <h3>{job.outline.title}</h3><p>{job.outline.description}</p>
        {job.outline.lessons.map((lesson, index) => <article key={lesson.id} className={styles.preview}><span className={styles.badge}>{lessonKinds[lesson.skillType ?? "listening"].label}</span><h3>Bài {index + 1} · {lesson.title}</h3><p>{lesson.objective}</p>
          {lesson.audioUrl && <><audio controls preload="none" src={lesson.audioUrl}>Trình duyệt chưa hỗ trợ phát audio.</audio><small>Audio thực tế: {lesson.audioSeconds} giây · {job.config.voice}</small></>}
          <AiLessonPreview lesson={lesson} />
        </article>)}
        {job.status === "awaiting_review" && <div className={styles.save}><p>Kiểm tra nội dung và nghe thử audio trước khi lưu. Khóa học chỉ hiển thị cho tài khoản của bạn.</p><button type="button" className={styles.primary} disabled={pending} onClick={() => void run(() => aiRequest<AiJob>(`${base}/${job.id}/activate`, aiJson("POST", { revision: job.outlineRevision })))}>Lưu vào khóa học của tôi</button></div>}
        {job.courseUrl && <div className={styles.success}><strong>Khóa học riêng tư đã được lưu.</strong><Link className={styles.primary} href={job.courseUrl}>Mở khóa học →</Link></div>}
      </>}
    </section>}
  </main>;
}
