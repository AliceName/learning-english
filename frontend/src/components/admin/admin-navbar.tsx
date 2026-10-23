"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import type { PublicUser } from "@/lib/server-auth";
import Icon, {type SiteIconName} from "@/components/site-icon";
import LogoutButton from "@/components/navigation/logout-button";
import styles from "./admin.module.css";
const items: {name:string;icon:SiteIconName;href?:string}[] = [
  {name:"Tổng quan",icon:"dashboard",href:"/account"},{name:"Quản lý khóa học",icon:"book",href:"/admin/courses"},
  {name:"Quản lý người dùng",icon:"users"},{name:"Quản lý AI & Prompts",icon:"brain"}
];
export default function AdminNavbar({user}:{user:PublicUser}) {
  const path = usePathname(); const drawer = useRef<HTMLDialogElement>(null);
  const nav = <><Link href="/admin/courses" className={styles.brand}><span><Icon name="globe" /></span><div><strong>LinguaAI</strong><small>STUDIO ADMIN</small></div></Link>
    <div className={styles.sidebarNav}><span className={styles.navCaption}>CHỨC NĂNG CHÍNH</span><nav aria-label="Điều hướng Admin">{items.map(item=>item.href?<Link key={item.name} href={item.href} aria-current={path.startsWith(item.href)?"page":undefined} onClick={()=>drawer.current?.close()}><Icon name={item.icon}/>{item.name}</Link>:<span key={item.name} aria-disabled="true"><Icon name={item.icon}/>{item.name}<small>Sắp có</small></span>)}</nav></div>
    <div className={styles.sidebarFooter}><div className={styles.adminCard}><span>Quản trị viên</span><strong>{user.fullName}</strong><small>{user.email}</small></div><LogoutButton/><Link href="/courses">← Không gian học tập</Link></div></>;
  return <><a className={styles.skipLink} href="#main-content">Đến nội dung chính</a><aside className={styles.sidebar}>{nav}</aside><dialog ref={drawer} className={styles.drawer} aria-label="Menu Admin"><button className={styles.drawerClose} onClick={()=>drawer.current?.close()} aria-label="Đóng menu"><Icon name="close"/></button>{nav}</dialog>
    <header className={styles.topbar}><button className={styles.menuButton} onClick={()=>drawer.current?.showModal()} aria-label="Mở menu Admin"><Icon name="menu"/></button><form action="/admin/courses" role="search"><Icon name="search"/><input name="search" maxLength={200} placeholder="Tìm kiếm khóa học…" aria-label="Tìm khóa học quản trị"/><button aria-label="Tìm kiếm"><Icon name="arrow"/></button></form><div className={styles.topbarRight}><Link href="/courses" className={styles.studentLink}>Không gian học tập <Icon name="arrow"/></Link><span className={styles.userName}><strong>{user.fullName}</strong><small>Quản trị viên</small></span><span className={styles.avatar}>{Array.from(user.fullName)[0]?.toUpperCase() || "A"}</span></div></header></>;
}
