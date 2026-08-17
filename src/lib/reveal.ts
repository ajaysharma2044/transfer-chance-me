// Animated numerals — the one motion primitive `useScrollFx` doesn't cover.
//
// Division of labour, so the page never runs two systems that fight:
//
//   useScrollFx (src/hooks/useScrollFx.ts)  entrance choreography. One
//     rAF-throttled scroll listener, global DOM query, class-based. Owns
//     [data-fx] / [data-fx-stagger] / [data-fx-track].
//
//   this file                               a single number counting up to
//     its true value. Per-element, needs a value rather than a class, so it
//     carries its own IntersectionObserver. Observers are passive and cheap;
//     the thing worth avoiding was a second scroll listener, not this.
//
// Two rules enforced here so no caller has to remember them:
//
//   1. `prefers-reduced-motion: reduce` shows the final value immediately.
//   2. No IntersectionObserver in the browser? Also immediate.
//
// Both failure paths resolve to "the true number is on screen", never to a
// zero or a blank — a figure this product stakes its credibility on must not
// depend on animation to become correct.

import { useEffect, useRef, useState } from "react";

/** True when the reader asked for less motion, or the browser can't observe. */
function motionOff(): boolean {
  if (typeof window === "undefined") return true;
  if (!("IntersectionObserver" in window)) return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Count `target` up when the element scrolls into view.
 *
 *   const [ref, shown] = useInView<HTMLSpanElement>();
 *   const n = useCountUp(58.3, shown, { decimals: 1 });
 *   <span ref={ref} className="num">{n.toFixed(1)}%</span>
 *
 * The rendered value is the exact target once the tween lands, so what a
 * reader screenshots is always the real figure and never a tween artefact.
 */
export function useCountUp(
  target: number,
  shown: boolean,
  { duration = 900, decimals = 0 }: { duration?: number; decimals?: number } = {},
): number {
  const [value, setValue] = useState(() => (motionOff() ? target : 0));
  const done = useRef(false);

  useEffect(() => {
    if (motionOff()) { setValue(target); return; }
    if (!shown || done.current) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutExpo — quick off the mark, long settle. The deceleration is
      // what reads as an instrument coming to rest; a linear tween reads as
      // digits scrambling, which looks like a slot machine, not a measurement.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const p = Math.pow(10, decimals);
      setValue(Math.round(target * eased * p) / p);
      if (t < 1) raf = requestAnimationFrame(tick);
      else { done.current = true; setValue(target); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, shown, duration, decimals]);

  // A target that changes after the tween finished — the reader edited their
  // GPA — must show the new number, not the one the tween happened to land on.
  useEffect(() => { if (done.current) setValue(target); }, [target]);

  return value;
}

/** Minimal one-shot in-view flag, for driving `useCountUp`. */
export function useInView<T extends HTMLElement = HTMLElement>(): [
  React.RefObject<T | null>,
  boolean,
] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState<boolean>(motionOff);

  useEffect(() => {
    if (motionOff()) { setSeen(true); return; }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return [ref, seen];
}
