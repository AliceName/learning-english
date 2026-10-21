import Link from "next/link";
import NavbarShell from "./navbar-shell";
import styles from "./navbar.module.css";

export default function PublicNavbar() {
  return (
    <NavbarShell>
      <Link href="/login" className={styles.login}>Đăng nhập</Link>
      <Link href="/register" className={styles.signup}>Đăng ký</Link>
    </NavbarShell>
  );
}
