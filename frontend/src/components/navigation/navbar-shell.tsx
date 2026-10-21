"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, useState, type ReactNode } from "react";
import Icon from "@/components/site-icon";
import Brand from "./brand";
import styles from "./navbar.module.css";

type NavItem = { href: string; label: string };
const publicLinks: NavItem[] = [
  { href: "/", label: "Trang chủ" },
  { href: "/#features", label: "Tính năng" },
  { href: "/#courses", label: "Khóa học" },
];

export default function NavbarShell({ children, links = publicLinks }: { children: ReactNode; links?: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const menuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);

  return (
    <header className={styles.header} onKeyDown={event => { if (event.key === "Escape" && open) { setOpen(false); menuButton.current?.focus(); } }}>
      <a href="#main-content" className={styles.skipLink}>Đến nội dung chính</a>
      <div className={styles.inner}>
        <Brand />
        <nav id={menuId} className={`${styles.navigation} ${open ? styles.open : ""}`} aria-label="Điều hướng chính">
          {links.map(link => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)} aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>
          ))}
          <div className={styles.mobileActions} onClickCapture={() => setOpen(false)}>{children}</div>
        </nav>
        <div className={styles.desktopActions}>{children}</div>
        <button ref={menuButton} type="button" className={styles.menuToggle} aria-expanded={open} aria-controls={menuId} aria-label={open ? "Đóng menu" : "Mở menu"} onClick={() => setOpen(!open)}>
          <Icon name={open ? "close" : "menu"} />
        </button>
      </div>
    </header>
  );
}
