import { useEffect, useRef, useState } from "react";
import { MODEL } from "../engine";
import "./corpus.css";

// Every recorded outcome, plotted. 8,910 cells — one per application in the
// study — on a fixed lattice. Two states, one transition, played once:
//
//   A "corpus"  every outcome, admits in brand colour, denials in pale navy.
//   B "by GPA"  the 4,243 admits rise into their REAL admitted-GPA
//               distribution; the 4,667 denials PARK in a labelled reservoir
//               at the baseline rather than vanishing.
//
// Denials are never placed on the GPA axis: the study records admitted-GPA
// distributions, not rejected ones. Putting them on that scale would be
// inventing data, so we state the gap instead.

interface P {
  x: number; y: number;
  tx: number; ty: number;
  admit: boolean;
  bucket: number;   // 0..19 → GPA 3.00–4.00, admits only
  idx: number;
}

const BUCKETS = 20;
const DOT = 2;      // CSS px, device-pixel snapped — never scaled down
const GUT = 1;

function admitDistribution(): number[] {
  const acc = new Array(BUCKETS).fill(0);
  for (const s of MODEL.schools) {
    if (!s.hist?.length || !s.nAdmits) continue;
    const sum = s.hist.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < Math.min(BUCKETS, s.hist.length); i++) {
      acc[i] += (s.hist[i] / sum) * s.nAdmits;
    }
  }
  const total = acc.reduce((a, b) => a + b, 0) || 1;
  return acc.map((v) => v / total);
}

const DIST = admitDistribution();
const TOTAL = Number(MODEL.meta.rows) || 8910;
const ADMITS = Number(MODEL.meta.admits) || 4243;
const DENIED = TOTAL - ADMITS;
const ADMIT_PCT = ((ADMITS / TOTAL) * 100).toFixed(1);
const DENY_PCT = ((DENIED / TOTAL) * 100).toFixed(1);
/** Share of admits at 3.90+ — the fact this plot exists to show. */
const TOP_SHARE = Math.round(DIST.slice(18).reduce((a, b) => a + b, 0) * 100);

export default function CorpusField() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"corpus" | "gpa">("corpus");
  const [shown, setShown] = useState(TOTAL);
  const fired = useRef(false);

  // One transition, played once, when the plot is properly on screen.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("gpa");
      return;
    }
    if (!("IntersectionObserver" in window)) { setPhase("gpa"); return; }
    const io = new IntersectionObserver(
      (es) => {
        if (fired.current || !es.some((e) => e.isIntersecting)) return;
        fired.current = true;
        io.disconnect();
        window.setTimeout(() => setPhase("gpa"), 1100);
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    const box = wrap.current;
    if (!cv || !box) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0;
    let ps: P[] = [];
    let plotted = TOTAL;

    const build = () => {
      // Lattice capacity at a fixed dot size. We never shrink the dot; if the
      // viewport can't hold the corpus we subsample and say so on screen.
      const padX = 16, padTop = 34, padBot = 30;
      const cols = Math.max(1, Math.floor((w - padX * 2) / (DOT + GUT)));
      const rows = Math.max(1, Math.floor((h - padTop - padBot) / (DOT + GUT)));
      const cap = cols * rows;
      const step = cap >= TOTAL ? 1 : Math.ceil(TOTAL / cap);
      plotted = Math.floor(TOTAL / step);
      setShown(plotted);

      const admitTarget = Math.round(ADMITS / step);
      const perBucket = DIST.map((d) => Math.round(d * admitTarget));

      ps = [];
      let made = 0;
      for (let b = 0; b < BUCKETS; b++) {
        for (let i = 0; i < perBucket[b] && made < admitTarget; i++, made++) {
          ps.push({ x: 0, y: 0, tx: 0, ty: 0, admit: true, bucket: b, idx: 0 });
        }
      }
      while (made < admitTarget) { ps.push({ x: 0, y: 0, tx: 0, ty: 0, admit: true, bucket: BUCKETS - 1, idx: 0 }); made++; }
      while (ps.length < plotted) ps.push({ x: 0, y: 0, tx: 0, ty: 0, admit: false, bucket: -1, idx: 0 });

      // Deterministic interleave so state A isn't two solid blocks.
      let seed = 20260816;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let i = ps.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [ps[i], ps[j]] = [ps[j], ps[i]];
      }
      ps.forEach((p, i) => { p.idx = i; });

      // State A targets: the full lattice.
      ps.forEach((p, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        p.tx = padX + c * (DOT + GUT);
        p.ty = padTop + r * (DOT + GUT);
      });
      // Start where they belong — the plot is legible at rest, no fly-in.
      ps.forEach((p) => { p.x = p.tx; p.y = p.ty; });
    };

    const layoutGpa = () => {
      const padX = 22, padTop = 34;
      const innerW = w - padX * 2;
      // The reservoir holds every denial, at the baseline, still counted.
      const resH = 26;
      const base = h - 26 - resH;
      const colW = innerW / BUCKETS;
      const maxD = Math.max(...DIST) || 1;
      const perCol = Math.max(1, Math.floor((colW - 3) / (DOT + GUT)));
      const counts = new Array(BUCKETS).fill(0);
      const resCols = Math.max(1, Math.floor(innerW / (DOT + GUT)));
      let resN = 0;

      for (const p of ps) {
        if (!p.admit) {
          const c = resN % resCols, r = Math.floor(resN / resCols);
          resN++;
          p.tx = padX + c * (DOT + GUT);
          p.ty = h - 24 - r * (DOT + GUT);
          continue;
        }
        const b = p.bucket;
        // Square-root height: the top bucket alone holds half the admits, so a
        // linear axis flattens every other column into an invisible stub.
        const colH = Math.sqrt(DIST[b] / maxD) * (base - padTop);
        const n = counts[b]++;
        const rowIdx = Math.floor(n / perCol);
        const colIdx = n % perCol;
        const total = Math.max(1, Math.round(DIST[b] * (ADMITS / (TOTAL / plotted))));
        const rowsTotal = Math.max(1, Math.ceil(total / perCol));
        p.tx = padX + b * colW + 2 + colIdx * (DOT + GUT);
        p.ty = base - (rowIdx / rowsTotal) * colH;
      }
    };

    const resize = () => {
      const r = box.getBoundingClientRect();
      w = Math.floor(r.width); h = Math.floor(r.height);
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
      if (phase === "gpa") { layoutGpa(); ps.forEach((p) => { p.x = p.tx; p.y = p.ty; }); }
      paint();
    };

    const ADMIT = "#2478e5";
    const ADMIT_TOP = "#14b8a0";
    const DENY = "rgba(20,24,63,0.14)";

    const paint = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        ctx.fillStyle = p.admit ? (p.bucket >= 18 ? ADMIT_TOP : ADMIT) : DENY;
        // Snap to device pixels so every cell keeps a hard edge.
        ctx.fillRect(Math.round(p.x), Math.round(p.y), DOT, DOT);
      }
    };

    let raf = 0;
    let t0 = 0;
    const DUR = 1150;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const animate = (now: number) => {
      if (!t0) t0 = now;
      const e = now - t0;
      let moving = false;
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        // Positional stagger: the ridge builds left to right, like a plotter.
        const delay = (p.tx / Math.max(w, 1)) * 260;
        const t = Math.max(0, Math.min(1, (e - delay) / DUR));
        if (t < 1) moving = true;
        const k = ease(t);
        const x = p.x + (p.tx - p.x) * k;
        const y = p.y + (p.ty - p.y) * k;
        ctx.fillStyle = p.admit ? (p.bucket >= 18 ? ADMIT_TOP : ADMIT) : DENY;
        ctx.fillRect(Math.round(x), Math.round(y), DOT, DOT);
      }
      if (moving) raf = requestAnimationFrame(animate);
      else { ps.forEach((p) => { p.x = p.tx; p.y = p.ty; }); paint(); } // then stop: zero frames at rest
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    if (phase === "gpa") {
      layoutGpa();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        ps.forEach((p) => { p.x = p.tx; p.y = p.ty; });
        paint();
      } else {
        t0 = 0;
        raf = requestAnimationFrame(animate);
      }
    }

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [phase]);

  const sub = shown < TOTAL;

  return (
    <figure className="cf" ref={wrap}>
      <canvas ref={canvas} aria-hidden="true" />

      <figcaption className="cf-read">
        <span><i>PLOTTED</i> {shown.toLocaleString()} / {TOTAL.toLocaleString()}</span>
        <span className="cf-k cf-k-admit"><i>ADMIT</i> {ADMITS.toLocaleString()} · {ADMIT_PCT}%</span>
        <span className="cf-k cf-k-deny"><i>DENY</i> {DENIED.toLocaleString()} · {DENY_PCT}%</span>
        {phase === "gpa" && <span className="cf-axis" aria-hidden="true"><i>3.0</i><i>3.5</i><i>4.0</i></span>}
      </figcaption>

      {phase === "gpa" && (
        <>
          <p className="cf-callout">
            <b className="num">{TOP_SHARE}%</b> of admits sit at 3.90 or above
          </p>
          <p className="cf-res">
            {DENIED.toLocaleString()} DENIED · GPA NOT RECORDED — held here, not positioned on the axis
          </p>
        </>
      )}

      <p className="cf-note">
        {phase === "corpus"
          ? "Every application in the study, one cell each — 2011 to 2026."
          : `Admitted GPAs only, square-root height scale.${sub ? ` Showing 1 in ${Math.round(TOTAL / shown)} at this width.` : ""}`}
      </p>
    </figure>
  );
}
