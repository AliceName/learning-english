"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import Icon from "@/components/site-icon";
import { activityLabels } from "@/lib/learning-activity";
import { nextSteps } from "@/lib/writing-practice";
import { greetingNow, lastSevenDays, revisionChange, todayPlan } from "./dashboard-model";
import { LoadError, Stat } from "./dashboard-parts";
import { SkillsPanel, type Skill } from "./skills-panel";
import { TodayPlan } from "./today-plan";
import { useDashboardData } from "./use-dashboard-data";
import { WritingProgress } from "./writing-progress";
import styles from "./dashboard.module.css";

/** Learner overview built only from what LEWA records; sections without data say so instead of showing numbers. */
export default function DashboardView({ fullName }: { fullName: string }) {
  const { calendar, decks, writing, retryCalendar, retryDecks, retryWriting } = useDashboardData();
  // Data only loads in the browser, so the server (and hydration) always render the neutral greeting.
  const greeting = calendar.state === "loading" ? "Xin chào" : greetingNow();

  const deckList = decks.state === "ready" ? decks.value : null;
  const writingData = writing.state === "ready" ? writing.value : null;
  const steps = useMemo(() => writingData?.latest ? nextSteps(writingData.latest) : [], [writingData]);
  const plan = useMemo(() => todayPlan(deckList, writingData, steps), [deckList, writingData, steps]);
  const streak = calendar.state === "ready" ? calendar.value.streak : null;
  const week = calendar.state === "ready" ? lastSevenDays(calendar.value) : [];
  const due = deckList?.reduce((sum, deck) => sum + deck.dueCount, 0) ?? 0;
  const ownDecks = deckList?.filter(deck => deck.canEdit && !deck.isAdminDeck) ?? [];
  const change = writingData ? revisionChange(writingData) : null;
  const latestRound = writingData?.rounds[0];
  const rounds = writingData ? `${writingData.rounds.length}${writingData.rounds.length === 10 ? "+" : ""}` : "—";
  const firstName = fullName.trim().split(/\s+/u).at(-1) ?? fullName;

  const skills: Skill[] = [
    { key: "writing", icon: "writing", name: "Luyện viết", href: "/writing", measured: true,
      status: writing.state === "loading" ? "Đang tải…" : !writingData ? "Chưa tải được" : latestRound ? `${rounds} lượt · lượt gần nhất có ${latestRound.submissionCount} bản` : "Chưa có bài viết" },
    { key: "cards", icon: "cards", name: "Flashcards", href: "/flashcards", measured: true,
      status: decks.state === "loading" ? "Đang tải…" : !deckList ? "Chưa tải được" : `${ownDecks.length} bộ · ${due} thẻ đến lịch` },
    { key: "speaking", icon: "mic", name: "Luyện nói", href: "/speaking", measured: false, status: "Lịch sử chỉ lưu trên trình duyệt, chưa tổng hợp" },
    { key: "translation", icon: "translate", name: "Luyện phiên dịch", href: "/translation-practice", measured: false, status: "Chưa có số liệu" },
    { key: "courses", icon: "book", name: "Khóa học", href: "/courses", measured: false, status: "Chưa có số liệu" },
  ];

  return <main id="main-content" className={styles.page} tabIndex={-1}>
    <header className={styles.heading}>
      <nav className={styles.breadcrumb} aria-label="Đường dẫn trang">
        <Link href="/" aria-label="Trang chủ"><Icon name="home" /></Link><Icon name="chevron" /><span aria-current="page">Tổng quan</span>
      </nav>
      <div className={styles.headingText}>
        <span className={styles.headingIcon}><Icon name="dashboard" /></span>
        <div><h1>{greeting}, {firstName}!</h1>
          <p>{streak === null ? "Đang tải hoạt động của bạn…" : streak.studiedToday ? "Hôm nay bạn đã học. Tiếp tục giữ nhịp nhé." : "Hôm nay chưa có hoạt động nào."}</p></div>
      </div>
      <Image className={styles.heroArt} src="/illustrations/speaking-reading-cat.webp" width={660} height={440} alt="" loading="eager" />
    </header>

    <div className={styles.topRow}>
      <TodayPlan plan={plan} loading={decks.state === "loading" || writing.state === "loading"} studiedToday={streak?.studiedToday ?? null} />
      <Link className={styles.streak} href="/account#learning-streak" prefetch={false}
        aria-label={streak ? `Chuỗi ${streak.currentStreak} ngày học liên tiếp, kỷ lục ${streak.longestStreak} ngày. Xem lịch học` : "Xem lịch học"}>
        <span className={styles.flame}><Icon name="flame" /></span>
        <strong>{streak?.currentStreak ?? "—"}</strong>
        <span>ngày học liên tiếp</span>
        <small>{streak ? `Kỷ lục ${streak.longestStreak} ngày · ${streak.studiedToday ? "đã học hôm nay" : "hôm nay chưa học"}` : calendar.state === "error" ? "Chưa tải được" : "Đang tải…"}</small>
        <span className={styles.textLink}>Xem lịch học →</span>
      </Link>
    </div>

    <section className={styles.stats} aria-labelledby="dashboard-stats">
      <h2 id="dashboard-stats" className={styles.srOnly}>Số liệu chính</h2>
      <Stat icon="trend" label="Tuần này" footer={calendar.state === "ready" && <ol className={styles.week} aria-label="Hoạt động 7 ngày gần nhất">
        {week.map(day => <li key={day.date} data-active={day.activities.length > 0 || undefined} aria-current={day.today ? "date" : undefined}>
          <i aria-hidden="true">{day.activities.length || ""}</i><span>{day.label}</span>
          <span className={styles.srOnly}>{day.activities.length ? day.activities.map(kind => activityLabels[kind]).join(", ") : "chưa học"}</span>
        </li>)}</ol>}>
        {calendar.state === "error" ? <LoadError message="Chưa tải được." onRetry={retryCalendar} />
          : <><b>{calendar.state === "ready" ? week.filter(day => day.activities.length > 0).length : "—"}</b><small>/7 ngày có học</small></>}
      </Stat>
      <Stat icon="cards" tone="purple" label="Thẻ đến lịch ôn" footer={deckList && <Link className={styles.textLink} href="/flashcards" prefetch={false}>{due ? "Ôn ngay →" : "Mở Flashcards →"}</Link>}>
        {decks.state === "error" ? <LoadError message="Chưa tải được." onRetry={retryDecks} /> : <><b>{deckList ? due : "—"}</b><small> thẻ</small></>}
      </Stat>
      <Stat icon="check" tone="green" label="Sửa bài trong lượt gần nhất" footer={<small className={styles.muted}>{change?.note ?? (writing.state === "error" ? "Chưa tải được" : "")}</small>}>
        {writing.state === "error" ? <LoadError message="Chưa tải được." onRetry={retryWriting} />
          : <><b>{change?.value ?? "—"}</b><small>{change?.unit ?? ""}</small></>}
      </Stat>
      <Stat icon="writing" tone="orange" label="Lượt luyện viết" footer={<small className={styles.muted}>Mỗi lượt gồm các bản sửa của cùng một bài</small>}>
        <b>{rounds}</b><small> lượt</small>
      </Stat>
    </section>

    <div className={styles.bottomRow}>
      <WritingProgress writing={writing} steps={steps} onRetry={retryWriting} />
      <SkillsPanel skills={skills} />
    </div>
  </main>;
}
