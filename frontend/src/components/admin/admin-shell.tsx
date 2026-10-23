import type {ReactNode} from "react";
import type {PublicUser} from "@/lib/server-auth";
import AdminNavbar from "./admin-navbar";
import styles from "./admin.module.css";
export default function AdminShell({user,children}:{user:PublicUser;children:ReactNode}) {return <div className={styles.shell}><AdminNavbar user={user}/><main id="main-content" className={styles.main} tabIndex={-1}>{children}</main></div>;}
