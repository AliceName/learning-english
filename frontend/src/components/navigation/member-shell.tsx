import type { ReactNode } from "react";
import type { PublicUser } from "@/lib/server-auth";
import MemberNavbar from "./member-navbar";
import styles from "./member-navbar.module.css";

export default function MemberShell({ user, children }: { user?: PublicUser; children: ReactNode }) {
  return <div className={styles.workspace}><MemberNavbar user={user} /><div className={styles.content}>{children}</div></div>;
}
