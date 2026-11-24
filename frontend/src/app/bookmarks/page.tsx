import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import MemberShell from "@/components/navigation/member-shell";
import { BookmarkProvider } from "@/components/bookmarks/bookmark-provider";
import Icon from "@/components/site-icon";
import { backendRequestSignal } from "@/lib/backend-request";
import type { Bookmark } from "@/lib/bookmarks";
import { backendUrl, getCurrentUser, SESSION_COOKIE } from "@/lib/server-auth";
import BookmarkList from "./bookmark-list";
import styles from "./bookmarks.module.css";

export const metadata = { title: "Dấu trang | LEWA" };

async function Content() {
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect("/login?next=%2Fbookmarks");
  let items: Bookmark[] | null = null;
  if (session.status === "authenticated") {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const response = await fetch(backendUrl("/api/v1/bookmarks"), {
      headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: backendRequestSignal(),
    }).catch(() => null);
    if (response?.status === 401) redirect("/login?next=%2Fbookmarks");
    if (response?.ok) {
      const value: unknown = await response.json().catch(() => null);
      if (Array.isArray(value)) items = value;
    }
  }

  const user = session.status === "authenticated" ? session.user : undefined;
  const account = user && `${user.userId}:${user.createdAt}`;
  return <MemberShell user={user}>
    <main id="main-content" tabIndex={-1} className={styles.page}>
      <header className={styles.heading}>
        <span className={styles.headingIcon}><Icon name="bookmark" /></span>
        <div><h1>Dấu trang</h1><p>Mở lại nội dung bạn đã đánh dấu để học tiếp.</p></div>
      </header>
      {account
        ? <BookmarkProvider key={account} initialItems={items}><BookmarkList account={account} /></BookmarkProvider>
        : <BookmarkList />}
    </main>
  </MemberShell>;
}

export default function BookmarksPage() {
  return <Suspense fallback={<p className={styles.page} role="status">Đang tải dấu trang…</p>}>
    <Content />
  </Suspense>;
}
