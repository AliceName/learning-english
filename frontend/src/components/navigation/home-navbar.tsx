import { getCurrentUser } from "@/lib/server-auth";
import MemberNavbar from "./member-navbar";
import NavbarShell from "./navbar-shell";
import PublicNavbar from "./public-navbar";
import styles from "./navbar.module.css";

export default async function HomeNavbar() {
  const session = await getCurrentUser();
  if (session.status === "authenticated") return <MemberNavbar user={session.user} variant="compact" />;
  // Preserve access to the account and sign-out action during an API outage.
  if (session.status === "unavailable") return <MemberNavbar variant="compact" />;
  return <PublicNavbar />;
}

export function NavbarFallback() {
  return <NavbarShell><span className={styles.loading} role="status">Đang tải tài khoản…</span></NavbarShell>;
}
