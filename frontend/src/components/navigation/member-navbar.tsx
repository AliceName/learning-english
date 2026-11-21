"use client";

import Link from "next/link";
import Image from "next/image";
import { isProfileAvatar } from "@/lib/profile-avatar";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DAY_MS, LEARNING_ACTIVITY_CHANGED, VIETNAM_OFFSET } from "@/lib/learning-activity";
import type { PublicUser } from "@/lib/server-auth";
import Icon, { type SiteIconName } from "@/components/site-icon";
import { useCloseWhenHidden } from "@/lib/use-close-when-hidden";
import Brand from "./brand";
import NavbarShell from "./navbar-shell";
import LogoutButton from "./logout-button";
import publicStyles from "./navbar.module.css";
import styles from "./member-navbar.module.css";

const links: { label: string; icon: SiteIconName; href?: string }[] = [
  { label: "Tổng quan", icon: "dashboard", href: "/dashboard" },
  { label: "Khóa học", icon: "book", href: "/courses" },
  { label: "Luyện nói", icon: "mic", href: "/speaking" },
  { label: "Luyện phiên dịch", icon: "translate", href: "/translation-practice" },
  { label: "Luyện viết", icon: "writing", href: "/writing" },
  { label: "Tạo khóa học AI", icon: "sparkles", href: "/courses/create-ai" },
  { label: "Flashcards", icon: "cards", href: "/flashcards" },
  { label: "Ôn tập lỗi sai", icon: "replay" },
  { label: "Bookmark", icon: "bookmark" },
  { label: "Chuỗi ngày học", icon: "trend", href: "/account#learning-streak" },
  { label: "Hồ sơ", icon: "person", href: "/account#profile" },
];

export default function MemberNavbar({ user, variant = "workspace" }: { user?: PublicUser; variant?: "workspace" | "compact" }) {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  useCloseWhenHidden(drawer);
  const userId = user?.userId;
  const [latest, setLatest] = useState<{ userId: number; streak: number }>();
  const streak = latest && latest.userId === userId ? latest.streak : user?.currentStreak;
  useEffect(() => {
    if (userId == null || variant !== "workspace") return;
    let request: AbortController | undefined;
    let midnight: number;
    function refresh() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      void fetch("/api/auth/me", { cache: "no-store", signal: controller.signal })
        .then(response => response.ok ? response.json() as Promise<PublicUser> : null)
        .then(value => {
          if (!controller.signal.aborted && value && value.userId === userId && typeof value.currentStreak === "number")
            setLatest({ userId: value.userId, streak: value.currentStreak });
        }).catch(() => {});
    }
    function scheduleMidnight() {
      midnight = window.setTimeout(() => {
        refresh();
        scheduleMidnight();
      }, DAY_MS - (Date.now() + VIETNAM_OFFSET) % DAY_MS + 100);
    }
    scheduleMidnight();
    window.addEventListener(LEARNING_ACTIVITY_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      request?.abort();
      window.clearTimeout(midnight);
      window.removeEventListener(LEARNING_ACTIVITY_CHANGED, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [userId, variant]);
  const initials = user?.fullName.trim().split(/\s+/).slice(-2).map(part => Array.from(part)[0]).join("").toUpperCase() || "?";
  const avatar = user?.avatarUrl && isProfileAvatar(user.avatarUrl)
    ? <Image src={user.avatarUrl} alt="" width={35} height={35} unoptimized style={{ borderRadius: "50%" }} /> : initials;
  if (variant === "compact") return <NavbarShell links={[{ href: "/", label: "Trang chủ" }, { href: "/courses", label: "Khóa học" }]}>
    <Link href="/account" className={publicStyles.account}><span className={publicStyles.avatar}>{avatar}</span><span className={publicStyles.accountName}>{user?.fullName ?? "Tài khoản của bạn"}</span></Link><LogoutButton />
  </NavbarShell>;

  const navigation = <>
    <div className={styles.brand}><Brand /></div><span className={styles.navLabel}>KHÔNG GIAN HỌC TẬP</span>
    <nav aria-label="Điều hướng học tập" className={styles.navigation}>
      {user?.role === "admin" && <Link href="/admin/courses"><Icon name="shield"/><span>Quản trị khóa học</span></Link>}
      {links.map(item => item.href ? <Link key={item.label} href={item.href}
        aria-current={pathname === item.href || item.href === "/courses" && pathname.startsWith("/courses/") && pathname !== "/courses/create-ai" ? "page" : undefined}
        onClick={() => drawer.current?.close()}><Icon name={item.icon} /><span>{item.label}</span></Link>
        : <span key={item.label} className={styles.unavailable} aria-disabled="true" title="Chức năng đang được phát triển"><Icon name={item.icon} /><span>{item.label}</span><small>Sắp có</small></span>)}
    </nav>
    <div className={styles.sidebarBottom}><div className={styles.tip}><Icon name="bulb" /><strong>Mỗi ngày một bước tiến</strong><p>Dành thời gian cho tiếng Anh, xây dựng thói quen của riêng bạn.</p></div><LogoutButton /><Link href="/" className={styles.homeLink}>← Về trang chủ</Link></div>
  </>;
  return <>
    <a href="#main-content" className={styles.skipLink}>Chuyển đến nội dung</a>
    <aside className={styles.sidebar}>{navigation}</aside>
    <dialog ref={drawer} className={styles.drawer} aria-label="Menu học tập" onClick={event => { if (event.target === event.currentTarget) drawer.current?.close(); }}>
      <div className={styles.drawerInner}><button type="button" className={styles.drawerClose} onClick={() => drawer.current?.close()} aria-label="Đóng menu"><Icon name="close" /></button>{navigation}</div>
    </dialog>
    <header className={styles.header}>
      <button type="button" className={styles.menuButton} onClick={() => drawer.current?.showModal()} aria-label="Mở menu học tập" aria-haspopup="dialog"><Icon name="menu" /></button>
      <form action="/courses" className={styles.quickSearch} role="search" aria-label="Tìm nhanh khóa học"><Icon name="search" /><input name="search" placeholder="Tìm khóa học, chủ đề…" aria-label="Tìm khóa học, chủ đề" maxLength={200} /><button type="submit" aria-label="Tìm kiếm nhanh"><Icon name="arrow" /></button></form>
      <div className={styles.headerRight}>
        {user?.targetLevel && <Link href="/account#profile" className={styles.target}><Icon name="compass" /><span>Mục tiêu <strong>{user.targetLevel}</strong></span></Link>}
        {typeof streak === "number" && <Link href="/account#learning-streak" className={styles.streak} aria-label={`Xem chuỗi ngày học, ${streak} ngày`}><Icon name="flame" /><strong>{streak}</strong><span>ngày</span></Link>}
        <span className={styles.divider} />
        <Link href="/account#profile" className={styles.profile} aria-label="Xem hồ sơ của bạn"><span className={styles.userText}><strong>{user?.fullName ?? "Tài khoản của bạn"}</strong><small>{user?.email}</small></span><span className={styles.avatar}>{avatar}</span></Link>
      </div>
    </header>
  </>;
}
