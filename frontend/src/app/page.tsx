import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import Brand from "@/components/navigation/brand";
import HomeNavbar, { NavbarFallback } from "@/components/navigation/home-navbar";
import Icon, { type SiteIconName } from "@/components/site-icon";
import CourseDetails from "@/components/home/course-details";
import { featuredCourses } from "@/components/home/courses";
import DocumentPreview from "@/components/home/document-preview";
import SpeakingPreview from "@/components/home/speaking-preview";
import styles from "@/components/home/home.module.css";

export const metadata: Metadata = {
  title: "LinguaAI | Gia sư AI & Lộ trình học tiếng Anh thích ứng",
  description: "Khám phá trải nghiệm học tiếng Anh cá nhân hóa cùng LinguaAI: luyện nói, viết, nghe, đọc và lộ trình theo mục tiêu của bạn.",
};

const metrics: { icon: SiteIconName; value: string; label: string }[] = [
  { icon: "users", value: "120k+", label: "Học viên đang tiến bộ tích cực" },
  { icon: "trend", value: "94.8%", label: "Đạt mục tiêu CEFR trong 3 tháng" },
  { icon: "mic", value: "18+", label: "Giọng đọc AI bản ngữ tự nhiên" },
  { icon: "star", value: "4.9/5", label: "Hơn 45,000 bài đánh giá 5 sao" },
];

const comparisons = [
  ["Tốc độ sửa bài Speaking & Writing", "Chờ 3 – 7 ngày để giảng viên chấm", "Tức thì với phản hồi chi tiết"],
  ["Thời lượng thực hành nói thực tế", "5 – 10 phút/buổi trong lớp đông người", "Chủ động luyện tập cùng AI Coach"],
  ["Cá nhân hóa theo nghề nghiệp", "Giáo trình cố định cho cả lớp", "Tạo khóa học từ tài liệu riêng"],
  ["Tâm lý học tập", "Ngại ngùng, sợ nói sai trước đám đông", "Thoải mái thử nghiệm, không phán xét"],
];

const testimonials = [
  { initials: "TH", name: "Trần Minh Hoàng", role: "Product Manager tại Fintech Hub", quote: "Trước đây mình rất sợ Speaking trong phỏng vấn công ty đa quốc gia. Luyện với tính năng phỏng vấn mô phỏng của LinguaAI, mình tự tin hơn rất nhiều!" },
  { initials: "MA", name: "Nguyễn Mai Anh", role: "Du học sinh Thạc sĩ tại Melbourne", quote: "Tính năng chấm bài viết luận C1 cực đỉnh. AI chỉ ra đúng chỗ sai collocations, giúp mình hiểu và cải thiện cách diễn đạt qua từng bài viết." },
  { initials: "ĐV", name: "Lê Đức Vũ", role: "Head of HR, VinaCorp", quote: "Công cụ tạo khóa học từ file PDF báo cáo kinh doanh là ý tưởng rất hữu ích cho đào tạo nội bộ. Rất phù hợp cho dân văn phòng bận rộn!" },
];

function Features() {
  return (
    <section id="features" className={styles.section} aria-labelledby="features-heading">
      <div className={styles.sectionHeading}><span className={styles.eyebrow}>Đột phá phương pháp</span><h2 id="features-heading">Luyện toàn diện 4 kỹ năng<br className={styles.desktopBreak} /> chuẩn quốc tế với AI</h2><p>Từng kỹ năng được tinh chỉnh bởi các mô hình ngôn ngữ chuyên sâu, giúp bạn phản hồi tự tin không sợ sai.</p></div>
      <div className={styles.skillsGrid}>
        <article id="speaking" className={styles.skillCard}>
          <div className={styles.skillTop}><span className={styles.skillIcon}><Icon name="mic" /></span><span className={styles.skillBadge}>IPA Realtime</span></div>
          <h3>Speaking AI Coach</h3><p>Chẩn đoán từng nguyên âm, phụ âm và trọng âm. Luyện phát âm, hội thoại theo tình huống và nhận gợi ý để diễn đạt tự nhiên hơn.</p>
          <div className={styles.skillExample}><div className={styles.exampleRow}><strong>Phân tích khẩu hình /θ/ vs /s/</strong><span>Chính xác 97.4%</span></div><div className={styles.progressTrack}><span style={{ width: "97.4%" }} /></div></div>
        </article>
        <article id="writing" className={styles.skillCard}>
          <div className={styles.skillTop}><span className={styles.skillIcon}><Icon name="writing" /></span><span className={styles.skillBadge}>CEFR A1 – C2</span></div>
          <h3>Writing AI Assistant</h3><p>Chấm luận điểm, bố cục chuẩn IELTS/TOEFL. Gợi ý nâng cấp từ vựng học thuật, tái cấu trúc câu và giải thích cặn kẽ bằng tiếng Việt.</p>
          <div className={styles.skillExample}><div className={styles.writingExample}><del lang="en">A lot of bad effects</del><Icon name="arrow" /><strong lang="en">Detrimental repercussions</strong></div><small><Icon name="check" />Nâng cấp cách diễn đạt học thuật</small></div>
        </article>
        <article id="listening" className={styles.skillCard}>
          <div className={styles.skillTop}><span className={styles.skillIcon}><Icon name="headphones" /></span><span className={styles.skillBadge}>Multi-Accents</span></div>
          <h3>Smart Listening</h3><p>Luyện nghe đa dạng phương ngữ Anh, Mỹ, Úc và hơn thế nữa. Điều chỉnh tốc độ, khám phá phụ đề tương tác và luyện phản xạ qua từng đoạn hội thoại.</p>
          <div className={`${styles.skillExample} ${styles.listeningExample}`}><span className={styles.playIcon}><Icon name="play" /></span><div><strong>BBC News Digest (London Accent)</strong><small>Tốc độ thích ứng: 1.1x · 04:30</small></div><Icon name="wave" /></div>
        </article>
        <article id="reading" className={styles.skillCard}>
          <div className={styles.skillTop}><span className={styles.skillIcon}><Icon name="book" /></span><span className={styles.skillBadge}>Contextual AI</span></div>
          <h3>Interactive Reading</h3><p>Khám phá bài đọc quốc tế với phụ đề song ngữ thông minh. Tra cứu collocations và idioms theo đúng ngữ cảnh chuyên ngành, ghi nhớ ngay khi đọc.</p>
          <div className={`${styles.skillExample} ${styles.readingExample}`}><span>Tra từ 1 chạm:</span><strong lang="en">Ubiquitous</strong><small>Có mặt khắp mọi nơi</small></div>
        </article>
      </div>
      <p className={styles.demoNote}>Bản xem trước các trải nghiệm học tập đang được phát triển.</p>
    </section>
  );
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}><Brand /><p>Nền tảng học tiếng Anh thích ứng với trí tuệ nhân tạo. Đồng hành cùng bạn trên hành trình chinh phục ngôn ngữ, từng ngày một.</p><span className={styles.footerTag}><Icon name="globe" />Học chủ động. Kết nối thế giới.</span></div>
          <div><h2>Trải nghiệm AI</h2><a href="#speaking">Speaking AI Coach</a><a href="#writing">Writing Assistant</a><a href="#listening">Smart Listening</a><a href="#reading">Interactive Reading</a><a href="#course-creator">AI Course Creator</a></div>
          <div><h2>Chương trình học</h2><a href="#course-ielts">Luyện thi IELTS 7.5+</a><a href="#course-business">Tiếng Anh doanh nghiệp</a><a href="#course-communication">Giao tiếp công sở</a><a href="#course-pronunciation">Phát âm chuẩn IPA</a></div>
          <div><h2>Bắt đầu cùng LinguaAI</h2><Link href="/register">Tạo tài khoản miễn phí</Link><Link href="/login">Đăng nhập</Link><Link href="/account">Tài khoản của bạn</Link><a href="#features">Khám phá tính năng</a></div>
        </div>
        <div className={styles.footerBottom}><span>© 2026 LinguaAI. Học chủ động, tiến bộ mỗi ngày.</span><span>Được xây dựng với <Icon name="sparkles" /> và niềm đam mê giáo dục</span></div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <div className={styles.page}>
      <Suspense fallback={<NavbarFallback />}><HomeNavbar /></Suspense>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <div className={styles.heroBlock}>
          <section className={styles.hero} aria-labelledby="hero-heading">
            <span className={styles.heroBadge}><Icon name="sparkles" />Nền tảng học tiếng Anh cá nhân hóa với trí tuệ nhân tạo thế hệ mới</span>
            <h1 id="hero-heading">Làm chủ tiếng Anh đột phá với <span>Gia sư AI</span> &amp; Lộ trình thích ứng</h1>
            <p className={styles.heroDescription}>Tự động chấm phát âm chuẩn IPA, hỗ trợ bài viết học thuật C1 và cá nhân hóa khóa học từ mọi tài liệu thực tế của bạn.</p>
            <div className={styles.heroActions}><Link href="/register" className={styles.primaryButton}>Bắt đầu học miễn phí ngay <Icon name="arrow" /></Link><a href="#courses" className={styles.secondaryButton}><Icon name="compass" />Khám phá khóa học</a></div>
            <p className={styles.reassurance}><Icon name="shield" />Không cần thẻ tín dụng · Học theo nhịp độ của bạn</p>
            <SpeakingPreview />
          </section>
        </div>

        <section className={styles.metricsBand} aria-label="Cộng đồng LinguaAI — số liệu minh họa"><div className={styles.container}><div className={styles.metrics}>{metrics.map(metric => <div key={metric.value}><strong><Icon name={metric.icon} />{metric.value}</strong><p>{metric.label}</p></div>)}</div><p className={styles.demoNote}>Số liệu minh họa</p></div></section>

        <Features />

        <section id="course-creator" className={styles.creatorBand} aria-labelledby="creator-heading"><div className={`${styles.container} ${styles.creatorGrid}`}>
          <div className={styles.creatorCopy}><span className={styles.creatorEyebrow}><Icon name="bolt" />Tính năng độc quyền tại LinguaAI</span><h2 id="creator-heading">Biến bất kỳ tài liệu nào thành <span>khóa học tương tác</span></h2><p>Bạn có bài thuyết trình tiếng Anh ngày mai? Hợp đồng kinh doanh quốc tế hay giáo trình chuyên ngành? Để AI biến tài liệu thực tế thành từ vựng, hội thoại và bài tập dành riêng cho bạn.</p><ul className={styles.checklist}><li><Icon name="check" /><span>Hỗ trợ PDF, PPTX, DOCX và ảnh chụp tài liệu</span></li><li><Icon name="check" /><span>Bảng thuật ngữ song ngữ kèm IPA và ví dụ thực tế</span></li><li><Icon name="check" /><span>Lộ trình luyện tập theo mục tiêu CEFR của bạn</span></li></ul><a href="#document-preview" className={styles.primaryButton}><Icon name="upload" />Thử xem trước tài liệu</a></div>
          <DocumentPreview />
        </div></section>

        <section id="courses" className={styles.section} aria-labelledby="courses-heading">
          <div className={styles.coursesHeading}><div><span className={styles.eyebrow}>Chương trình tinh hoa</span><h2 id="courses-heading">Khóa học ứng dụng AI<br className={styles.desktopBreak} /> được học viên yêu thích nhất</h2></div><a href="#course-ielts" className={styles.textLink}>Khám phá các lộ trình <Icon name="chevron" /></a></div>
          <div className={styles.coursesGrid}>{featuredCourses.map(course => <article key={course.id} id={`course-${course.id}`} className={styles.courseCard}><div className={styles.courseImage}><Image src={course.image} alt={course.imageAlt} fill sizes="(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 25vw" /><span>{course.category}</span></div><div className={styles.courseContent}><p className={styles.rating}><Icon name="star" /><strong>{course.rating}</strong><span>({course.learners} học viên)</span></p><h3>{course.title}</h3><p className={styles.courseDescription}>{course.description}</p><div className={styles.courseMeta}><span>Lộ trình: {course.days} ngày</span><strong>{course.level}</strong></div><CourseDetails course={course} /></div></article>)}</div>
          <p className={styles.demoNote}>Khóa học, điểm đánh giá và số học viên là nội dung minh họa.</p>
        </section>

        <section className={styles.comparisonBand} aria-labelledby="comparison-heading"><div className={styles.container}>
          <div className={styles.sectionHeading}><span className={styles.eyebrow}>Sự khác biệt vượt bậc</span><h2 id="comparison-heading">Một cách học mới.<br />Một phiên bản tự tin hơn của bạn.</h2><p>Khám phá sự khác biệt giữa học truyền thống và trải nghiệm học thích ứng bằng AI.</p></div>
          <div className={styles.tableWrap} role="region" aria-label="So sánh phương pháp học — có thể cuộn ngang" tabIndex={0}><table className={styles.comparisonTable}><caption className={styles.visuallyHidden}>So sánh trải nghiệm học truyền thống và các tính năng dự kiến của LinguaAI</caption><thead><tr><th scope="col">Tiêu chí so sánh</th><th scope="col">Trung tâm / Học truyền thống</th><th scope="col"><Icon name="sparkles" />Nền tảng LinguaAI</th></tr></thead><tbody>{comparisons.map(([criterion, traditional, ai]) => <tr key={criterion}><th scope="row">{criterion}</th><td>{traditional}</td><td><span><Icon name="check" />{ai}</span></td></tr>)}</tbody></table></div>
          <div className={styles.testimonials}>{testimonials.map(person => <figure key={person.name} className={styles.testimonial}><div className={styles.stars} aria-label="5 trên 5 sao">{Array.from({ length: 5 }, (_, index) => <Icon key={index} name="star" />)}</div><blockquote>“{person.quote}”</blockquote><figcaption><span className={styles.personAvatar}>{person.initials}</span><span><strong>{person.name}</strong><small>{person.role}</small></span></figcaption></figure>)}</div>
          <p className={styles.demoNote}>Các đánh giá trên là nội dung minh họa.</p>
        </div></section>

        <section id="get-started" className={styles.section} aria-labelledby="start-heading"><div className={styles.finalCta}>
          <span>Sẵn sàng bứt phá tiếng Anh</span><h2 id="start-heading">Bắt đầu hành trình làm chủ ngôn ngữ ngay hôm nay cùng AI</h2>
          <form action="/register" method="get" className={styles.startForm}><label htmlFor="start-email" className={styles.visuallyHidden}>Địa chỉ email của bạn</label><input id="start-email" name="email" type="email" autoComplete="email" maxLength={255} placeholder="Nhập địa chỉ email của bạn…" required /><button type="submit">Bắt đầu học <Icon name="arrow" /></button></form>
          <p>Miễn phí để bắt đầu. Một hành trình dành riêng cho bạn.</p>
        </div></section>
      </main>
      <Footer />
    </div>
  );
}
