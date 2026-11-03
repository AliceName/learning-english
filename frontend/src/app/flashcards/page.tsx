import { Suspense } from "react";
import { redirect } from "next/navigation";
import MemberShell from "@/components/navigation/member-shell";
import { backendUrl, getCurrentUser, SESSION_COOKIE } from "@/lib/server-auth";
import { backendRequestSignal } from "@/lib/backend-request";
import { cookies } from "next/headers";
import type { Deck } from "@/lib/flashcards";
import FlashcardsWorkspace from "./workspace";
import styles from "./flashcards.module.css";

export const metadata = { title: "Flashcards | LinguaAI" };
export const instant = false;
async function Content() {
  const session = await getCurrentUser();
  if (session.status === "anonymous") redirect("/login");
  let decks: Deck[] | null = null;
  if (session.status === "authenticated") {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    try {
      const response = await fetch(backendUrl("/api/v1/flashcards/decks"), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: backendRequestSignal() });
      if (response.ok) decks = await response.json();
    } catch { /* Show a retry control if the API is temporarily unavailable. */ }
  }
  return <MemberShell user={session.status === "authenticated" ? session.user : undefined}><FlashcardsWorkspace initialDecks={decks} isAdmin={session.status === "authenticated" && session.user.role === "admin"} /></MemberShell>;
}
export default function FlashcardsPage() { return <Suspense fallback={<p className={styles.page}>Đang tải bộ thẻ…</p>}><Content /></Suspense>; }
