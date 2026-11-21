import type { ReactNode } from "react";
import type { PublicUser } from "@/lib/server-auth";
import { BookmarkProvider } from "@/components/bookmarks/bookmark-provider";
import MemberNavbar from "./member-navbar";
import styles from "./member-navbar.module.css";

export default function MemberShell({ user, children, variant = "default", contentClassName, bookmarks = false }: {
  user?: PublicUser;
  children: ReactNode;
  variant?: "default" | "catalog";
  contentClassName?: string;
  bookmarks?: boolean;
}) {
  return <div className={`${styles.workspace} ${variant === "catalog" ? styles.catalogWorkspace : ""}`}>
    <MemberNavbar user={user} />
    <div className={`${styles.content} ${contentClassName ?? ""}`}>
      {bookmarks && user ? <BookmarkProvider key={user.userId}>{children}</BookmarkProvider> : children}
    </div>
  </div>;
}
