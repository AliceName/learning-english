"use client";

import Link from "next/link";
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import Icon, { type SiteIconName } from "@/components/site-icon";
import BearMascot from "./bear-mascot";
import { HeroBackdrop, HeroCrown, HeroStickers } from "./hero-artwork";
import SkillPreview, { type SkillId } from "./skill-previews";
import SkillArtwork, { PeekingCat } from "./skill-artwork";
import useSkillCarousel from "./use-skill-carousel";
import styles from "./landing.module.css";

const skills: { id: SkillId; title: string; icon: SiteIconName; description: string; metric: string; value: string; hint: string; action: string }[] = [
  { id: "speaking", title: "Speaking", icon: "mic", description: "Luyện nói và phát âm IPA cùng AI", metric: "Native Match", value: "98%", hint: "Luyện phát âm theo từng âm vị", action: "Luyện Speaking" },
  { id: "reading", title: "Reading", icon: "book", description: "Đọc hiểu và tra từ theo ngữ cảnh", metric: "Tốc độ đọc", value: "245 wpm", hint: "Khám phá từ vựng trong ngữ cảnh", action: "Bắt đầu đọc tương tác" },
  { id: "writing", title: "Writing", icon: "writing", description: "Sửa ngữ pháp, nâng cấp cách diễn đạt", metric: "Mạch lạc (CC)", value: "Band 8.0", hint: "Phát triển kỹ năng viết học thuật", action: "Mở trình sửa bài AI" },
  { id: "listening", title: "Listening", icon: "headphones", description: "Luyện nghe và nhận diện từ khóa", metric: "Giọng đọc", value: "US / UK", hint: "Lắng nghe và luyện theo nhịp của bạn", action: "Bắt đầu luyện nghe" },
  { id: "grammar", title: "Grammar", icon: "brain", description: "Hiểu cấu trúc qua ví dụ thực tế", metric: "Cấu trúc", value: "Inversion", hint: "Hiểu cấu trúc qua các ví dụ thực tế", action: "Luyện bài tập ngữ pháp" },
];

const sectionNames = ["Giới thiệu", "5 kỹ năng AI", "Khóa học"];
const scrollBehavior = (): ScrollBehavior => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";

export default function LandingPage({ courseCards }: { courseCards: ReactNode }) {
  const main = useRef<HTMLElement>(null);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const [activeSection, setActiveSection] = useState(0);
  const {
    viewport: carouselRef, track: trackRef, active: activeSkill, position, dragging,
    goTo: goToSkill, startDrag, moveDrag, endDrag, handleKeys: handleSkillKeys,
  } = useSkillCarousel(skills.length);

  function goToSection(index: number) {
    const section = sections.current[index];
    if (!section || !main.current) return;
    section.focus({ preventScroll: true });
    main.current.scrollTo({ top: section.offsetTop, behavior: scrollBehavior() });
  }

  function trackSections() {
    if (!main.current) return;
    const probe = main.current.scrollTop + Math.min(240, main.current.clientHeight * .3);
    let current = 0;
    sections.current.forEach((section, index) => { if (section && section.offsetTop <= probe) current = index; });
    setActiveSection(current);
  }

  function handleKeys(event: KeyboardEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true], dialog")) return;
    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      goToSection(Math.max(0, Math.min(2, activeSection + (event.key === "PageDown" ? 1 : -1))));
    }
  }

  function nextCue(index: number) {
    return <button type="button" className={styles.scrollCue} aria-label={`Cuộn tới ${sectionNames[index]}`} onClick={() => goToSection(index)}><Icon name="chevron" /></button>;
  }

  return <>
    <nav className={styles.sectionNav} aria-label="Các phần trang chủ">{sectionNames.map((name, index) => <button key={name} type="button" aria-label={`Cuộn tới ${name}`} aria-current={activeSection === index ? "step" : undefined} onClick={() => goToSection(index)}><span className={styles.sectionTooltip}>{name}</span><i /></button>)}</nav>
    <main id="main-content" ref={main} className={styles.scrollContainer} tabIndex={-1} onScroll={trackSections} onKeyDown={handleKeys}>
      <section id="introduction" ref={node => { sections.current[0] = node; }} className={`${styles.slide} ${styles.introduction}`} tabIndex={-1} aria-labelledby="hero-heading">
        <HeroBackdrop />
        <div className={styles.heroGrid}>
          <div className={styles.heroMascot}>
            <BearMascot />
            <HeroCrown />
            <span className={styles.heroCloud} aria-hidden="true" />
          </div>
          <div className={styles.speechBubble}>
            <HeroStickers />
            <span className={styles.greeting}>Chào mừng đến với LEWA</span>
            <h1 id="hero-heading">Giới thiệu về website{" "}<span>LEWA</span></h1>
            <p>LEWA là trợ lý học tiếng Anh thông minh, giúp bạn học từ vựng, luyện nghe nói và phát âm một cách cá nhân hóa, thú vị và hiệu quả.</p>
            <div className={styles.heroActions}>
              <button type="button" className={styles.primaryButton} onClick={() => goToSection(1)}>Bắt đầu học <Icon name="play" /></button>
              <button type="button" className={styles.secondaryButton} onClick={() => goToSection(2)}><Icon name="plus" />Khám phá thêm</button>
            </div>
          </div>
        </div>
        {nextCue(1)}
      </section>

      <section id="features" ref={node => { sections.current[1] = node; }} className={`${styles.slide} ${styles.skillsSlide}`} data-skill-theme={skills[activeSkill].id} tabIndex={-1} aria-labelledby="skills-heading">
        <div className={styles.skillsContent}>
          <div className={styles.sectionHeading}><h2 id="skills-heading">Bộ Kỹ Năng Thông Minh{" "}<span>LEWA</span></h2><div className={styles.peekingCat}><PeekingCat /></div></div>
          <div className={styles.skillStage}>
          <div id="skills-carousel" ref={carouselRef} className={styles.carousel} role="region" aria-roledescription="carousel" aria-label="Trải nghiệm 5 kỹ năng AI" tabIndex={0} data-dragging={dragging} data-skill={skills[activeSkill].id}
            onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={handleSkillKeys}>
            <div ref={trackRef} className={styles.carouselTrack} style={{ "--skill-position": position } as CSSProperties}>
              {skills.map((skill, index) => <article id={`skill-${skill.id}`} key={skill.id} className={`${styles.skillCard} ${styles[skill.id] ?? ""}`} role="group" aria-roledescription="slide" aria-label={`${index + 1} / 5: ${skill.title}`} data-active={activeSkill === index} aria-hidden={activeSkill !== index} inert={activeSkill !== index} style={{ "--panel-distance": Math.min(1, Math.abs(index - position)) } as CSSProperties}>
                <div className={styles.skillHeader}><div className={styles.skillIdentity}><span className={styles.skillIcon}><SkillArtwork skill={skill.id} /></span><div className={styles.skillTitle}><h3>{skill.title}<small>Kỹ năng 0{index + 1}</small></h3><p>{skill.description}</p></div></div><div className={styles.skillMetric}><span>{skill.metric}</span><strong>{skill.value}</strong></div></div>
                <div className={styles.skillBody}><SkillPreview skill={skill.id} active={activeSkill === index} /></div>
                <div className={styles.skillFooter}><span><Icon name={skill.icon} />{skill.hint}</span><Link href="/register"><Icon name={skill.icon} />{skill.action}</Link></div>
              </article>)}
            </div>
          </div>
            <button type="button" className={`${styles.skillArrow} ${styles.previousSkill}`} aria-label="Kỹ năng trước" aria-controls="skills-carousel" disabled={activeSkill === 0} onClick={() => goToSkill(activeSkill - 1)}><Icon name="chevron" /></button>
            <button type="button" className={`${styles.skillArrow} ${styles.nextSkill}`} aria-label="Kỹ năng tiếp theo" aria-controls="skills-carousel" disabled={activeSkill === skills.length - 1} onClick={() => goToSkill(activeSkill + 1)}><Icon name="chevron" /></button>
          </div>
          <span className={styles.skillStatus} role="status" aria-live="polite" aria-atomic="true">{skills[activeSkill].title}, kỹ năng {activeSkill + 1} trên 5</span>
        </div>
      </section>

      <section id="courses" ref={node => { sections.current[2] = node; }} className={`${styles.slide} ${styles.coursesSlide}`} tabIndex={-1} aria-labelledby="courses-heading">
        <HeroBackdrop />
        <div className={styles.coursesContent}>
          <h2 id="courses-heading"><span>Khóa học</span></h2>
          {courseCards}
        </div>
        <footer className={styles.footer}><span><strong>LEWA © 2026</strong> — Nền tảng học tiếng Anh trực quan AI</span><div><button type="button" onClick={() => goToSection(0)}>↑ Về đầu trang</button><button type="button" onClick={() => goToSection(1)}>5 Kỹ Năng AI</button><Link href="/courses">Khóa học</Link></div></footer>
      </section>
    </main>
  </>;
}
