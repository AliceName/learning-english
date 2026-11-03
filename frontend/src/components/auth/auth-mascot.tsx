"use client";

import { Mascot } from "page-mascot";
import { useEffect, useRef, useState } from "react";
import styles from "./auth-screen.module.css";

export type AuthReaction = "sparkle" | "heart" | "delighted";
export type MascotReaction = { expression: AuthReaction; sequence: number };

const directions = [5, 8, 7, 6, 3, 0, 1, 2];
// The local fox sheet uses its middle cell for star eyes.
const expressions: Record<AuthReaction, number> = { heart: 1, sparkle: 4, delighted: 8 };
const cell = (index: number) => `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%`;

export default function AuthMascot({ reaction }: { reaction: MascotReaction | null }) {
  const stage = useRef<HTMLDivElement>(null);
  const [look, setLook] = useState<number | null>(null);

  useEffect(() => {
    let focused: HTMLElement | null = null;

    function aim() {
      if (!focused?.isConnected || !stage.current) {
        setLook(null);
        return;
      }
      const origin = stage.current.getBoundingClientRect();
      const target = focused.getBoundingClientRect();
      const dx = target.left + target.width / 2 - origin.left - origin.width / 2;
      const dy = target.top + target.height / 2 - origin.top - origin.height / 2;
      const sector = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
      setLook(Math.hypot(dx, dy) < 70 ? 4 : directions[sector]);
    }

    function onFocus(event: FocusEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (stage.current?.contains(target)) {
        releaseFocus();
        return;
      }
      focused = target.closest<HTMLElement>("input, select, textarea, button, a");
      aim();
    }

    function releaseFocus() {
      focused = null;
      setLook(null);
    }

    function onPointerMove(event: PointerEvent) {
      // Touch selection must keep looking at the field after the finger lifts.
      if (event.pointerType === "mouse" || event.pointerType === "pen") releaseFocus();
    }

    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", releaseFocus);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", aim, { passive: true, capture: true });
    window.addEventListener("resize", aim);
    window.addEventListener("blur", releaseFocus);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", releaseFocus);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", aim, true);
      window.removeEventListener("resize", aim);
      window.removeEventListener("blur", releaseFocus);
    };
  }, []);

  const expression = reaction?.expression;
  const override = expression !== undefined || look !== null;

  return (
    <div ref={stage} className={styles.mascotStage} data-reaction={expression} data-look={look ?? undefined} data-override={override || undefined}>
      <Mascot
        directions="/mascots/fox-directions.webp"
        reactions="/mascots/fox-reactions.webp"
        size={224}
        label="Cáo LEWA"
        className={styles.mascot}
      />
      {override && <span aria-hidden="true" className={styles.mascotSprite} style={{
        backgroundImage: `url(/mascots/fox-${expression ? "reactions" : "directions"}.webp)`,
        backgroundPosition: cell(expression ? expressions[expression] : look ?? 4),
      }} />}
    </div>
  );
}
