"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const interactive = "a, button, input, textarea, select, label, [contenteditable=true]";

/** One panel per gesture, with native vertical scrolling left to the page. */
export default function useSkillCarousel(count: number) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const selected = useRef(0);
  const gesture = useRef<{ x: number; y: number; position: number; started: number; moved: boolean } | null>(null);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState(0);
  const [dragging, setDragging] = useState(false);

  function goTo(index: number) {
    const next = Math.max(0, Math.min(count - 1, index));
    selected.current = next;
    setActive(next);
    setPosition(next);
    setDragging(false);
  }

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let accumulated = 0;
    let lastEvent = 0;
    let consumed = false;

    function wheel(event: WheelEvent) {
      // Horizontal trackpads and Shift + wheel; ordinary wheel still scrolls sections.
      if (event.ctrlKey || (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY))) return;
      const now = performance.now();
      if (now - lastEvent > 180) { accumulated = 0; consumed = false; }
      lastEvent = now;
      const delta = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX;
      const direction = Math.sign(delta);
      if ((selected.current === 0 && direction < 0) || (selected.current === count - 1 && direction > 0)) return;
      event.preventDefault();
      if (consumed) return;
      accumulated += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientWidth : 1);
      if (Math.abs(accumulated) < 32) return;
      consumed = true;
      const next = Math.max(0, Math.min(count - 1, selected.current + Math.sign(accumulated)));
      selected.current = next;
      setActive(next);
      setPosition(next);
      setDragging(false);
    }

    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [count]);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest(interactive)) return;
    const width = event.currentTarget.clientWidth;
    const gap = track.current ? parseFloat(getComputedStyle(track.current).columnGap) || 0 : 0;
    const transform = track.current ? getComputedStyle(track.current).transform : "none";
    const current = transform === "none" ? selected.current : -new DOMMatrixReadOnly(transform).m41 / (width + gap);
    gesture.current = { x: event.clientX, y: event.clientY, position: current, started: performance.now(), moved: false };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = gesture.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dy) > Math.max(8, Math.abs(dx))) { gesture.current = null; return; }
      if (Math.abs(dx) < 8) return;
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    const gap = track.current ? parseFloat(getComputedStyle(track.current).columnGap) || 0 : 0;
    const next = drag.position - dx / (event.currentTarget.clientWidth + gap);
    // A little resistance at the first/last panel rather than an empty screen.
    setPosition(next < 0 ? next * .18 : next > count - 1 ? count - 1 + (next - count + 1) * .18 : next);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = gesture.current;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag?.moved) return;
    const dx = event.clientX - drag.x;
    const threshold = Math.min(80, event.currentTarget.clientWidth * .16);
    const swipe = Math.abs(dx) > threshold || (Math.abs(dx) > 25 && performance.now() - drag.started < 250);
    goTo(selected.current + (event.type !== "pointercancel" && swipe ? -Math.sign(dx) : 0));
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.target as Element).closest(interactive)) return;
    const destinations: Record<string, number> = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: count - 1 };
    const next = destinations[event.key];
    if (next === undefined) return;
    event.preventDefault();
    goTo(next);
  }

  return { viewport, track, active, position, dragging, goTo, startDrag, moveDrag, endDrag, handleKeys };
}
