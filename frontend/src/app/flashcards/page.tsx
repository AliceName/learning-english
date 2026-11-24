import { Suspense } from "react";
import { redirect } from "next/navigation";
import MemberShell from "@/components/navigation/member-shell";
import { backendUrl, getCurrentUser, SESSION_COOKIE } from "@/lib/server-auth";
import { backendRequestSignal } from "@/lib/backend-request";
import { cookies } from "next/headers";
import type { Deck, DeckDetail } from "@/lib/flashcards";
import FlashcardsWorkspace from "./workspace";
import styles from "./flashcards.module.css";

export const metadata = { title: "Flashcards | LinguaAI" };
export const instant = false;
function positiveId(value: string | string[] | undefined) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) return null;
  return Number(value);
}

async function Content({ searchParams }: PageProps<"/flashcards">) {
  const query = await searchParams;
  const deckId = positiveId(query.deckId);
  const cardId = positiveId(query.cardId);
  const session = await getCurrentUser();
  if (session.status === "anonymous") {
    const destination = deckId && cardId ? `/flashcards?deckId=${deckId}&cardId=${cardId}` : "/flashcards";
    redirect("/login?next=" + encodeURIComponent(destination));
  }
  let decks: Deck[] | null = null;
  let detail: DeckDetail | null = null;
  if (session.status === "authenticated") {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    async function load<T>(path: string): Promise<T | null> {
      try {
        const response = await fetch(backendUrl("/api/v1/flashcards/decks" + path), {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: backendRequestSignal(),
        });
        return response.ok ? await response.json() : null;
      } catch {
        return null;
      }
    }
    [decks, detail] = await Promise.all([
      load<Deck[]>(""),
      deckId && cardId ? load<DeckDetail>("/" + deckId) : null,
    ]);
  }
  const user = session.status === "authenticated" ? session.user : undefined;
  const account = user ? `${user.userId}:${user.createdAt}` : undefined;
  return <MemberShell user={user} bookmarks>
    <FlashcardsWorkspace key={`${account}:${deckId}:${cardId}`} initialDecks={decks} initialDetail={detail}
      linkedCardId={deckId ? cardId : null} account={account} isAdmin={user?.role === "admin"} />
  </MemberShell>;
}
export default function FlashcardsPage(props: PageProps<"/flashcards">) {
  return <Suspense fallback={<p className={styles.page}>Đang tải bộ thẻ…</p>}><Content {...props} /></Suspense>;
}
