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

  // The target lives in a ref, NOT in the effect's dependency list.
  //
  // This is the whole design. `target` is derived from the profile, and the
  // profile is replaced at least once on load (local copy first, then the
  // account's). An effect keyed on `target` therefore tears down and restarts
  // mid-flight — and if the restarts arrive faster than the animation runs,
  // the tween is cancelled forever and the figure freezes at whatever partial
  // value it had reached. That shipped: the portal sat at "23–25%" against a
  // true 90–99%, which is not a cosmetic bug, it is the product displaying a
  // wrong number with total confidence.
  //
  // Reading the target through a ref means a change retargets the SAME
  // in-flight animation instead of restarting it, so the tween always
  // converges on the latest value.
  const targetRef = useRef(target);
  targetRef.current = target;
  /** True only while a tween is in flight. */
  const running = useRef(false);

  useEffect(() => {
    if (motionOff()) { setValue(target); return; }
    if (!shown) return;

    let raf = 0;
    let cancelled = false;
    running.current = true;
    const start = performance.now();
    const from = 0;

    const tick = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / duration);
      // easeOutExpo — quick off the mark, long settle. The deceleration reads
      // as an instrument coming to rest; a linear tween reads as digits
      // scrambling, which looks like a slot machine, not a measurement.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const to = targetRef.current;
      const p = Math.pow(10, decimals);
      setValue(Math.round((from + (to - from) * eased) * p) / p);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        running.current = false;
        setValue(to); // land on the exact figure, never a tween artefact
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      running.current = false;
      cancelAnimationFrame(raf);
      // Unmounting or turning motion off mid-flight must not leave a partial
      // number on screen as if it were real.
      setValue(targetRef.current);
    };
    // Deliberately excludes `target` — see the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, duration, decimals]);

  // A target that changes AFTER the tween has landed — the reader edited
  // their GPA — updates the figure directly. Guarded on `running` so it
  // cannot fight an animation that is still converging on the same value.
  useEffect(() => {
    if (!running.current) setValue(target);
  }, [target]);

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
