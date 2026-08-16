import { useEffect } from "react";

// Scroll choreography.
//
// Two mechanisms, both driven off one rAF-throttled scroll listener so the
// page never runs competing observers:
//
//   [data-fx]        elements ease in on entry with weighted, staggered motion
//   [data-fx-track]  elements publish their own scroll progress as --p (0→1),
//                    so CSS can drive transforms continuously as you pass them
//
// Everything is inert under prefers-reduced-motion.

const EASE_IN_VIEW = 0.12; // fraction of viewport an element must cross

export function useScrollFx(deps: unknown[] = []) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const fx = Array.from(document.querySelectorAll<HTMLElement>("[data-fx]"));
    const tracks = Array.from(document.querySelectorAll<HTMLElement>("[data-fx-track]"));

    if (reduced) {
      fx.forEach((el) => el.classList.add("fx-in"));
      tracks.forEach((el) => el.style.setProperty("--p", "1"));
      return;
    }

    // Stagger children of a group so rows cascade rather than pop together.
    fx.forEach((el) => {
      const group = el.getAttribute("data-fx-stagger");
      if (!group) return;
      Array.from(el.children).forEach((child, i) => {
        (child as HTMLElement).style.setProperty("--i", String(i));
      });
    });

    let ticking = false;

    const measure = () => {
      ticking = false;
      const vh = window.innerHeight || 1;

      for (const el of fx) {
        if (el.classList.contains("fx-in")) continue;
        const r = el.getBoundingClientRect();
        if (r.top < vh * (1 - EASE_IN_VIEW) && r.bottom > 0) el.classList.add("fx-in");
      }

      for (const el of tracks) {
        const r = el.getBoundingClientRect();
        // 0 when the element's top hits the bottom of the viewport,
        // 1 when its bottom clears the top — a full pass-through.
        const span = r.height + vh;
        const p = Math.max(0, Math.min(1, (vh - r.top) / span));
        el.style.setProperty("--p", p.toFixed(4));
      }
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
