import type { ReactNode } from "react";
import type { PublicUser } from "@/lib/server-auth";
import MemberNavbar from "./member-navbar";
import styles from "./member-navbar.module.css";

export default function MemberShell({ user, children, variant = "default", contentClassName }: {
  user?: PublicUser;
  children: ReactNode;
  variant?: "default" | "catalog";
  contentClassName?: string;
}) {
  return <div className={`${styles.workspace} ${variant === "catalog" ? styles.catalogWorkspace : ""}`}>
    <MemberNavbar user={user} />
    <div className={`${styles.content} ${contentClassName ?? ""}`}>{children}</div>
  </div>;
}
