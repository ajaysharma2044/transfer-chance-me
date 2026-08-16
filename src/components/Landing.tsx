import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { DEFAULT_PROFILE, estimateAll, MODEL, TAG_CAMPUSES } from "../engine";
import type { Estimate, Profile } from "../engine";
import { buildPlan } from "../lib/actionplan";
import { markOf } from "../lib/schools";
import { useReveal } from "../hooks/useReveal";
import { useScrollFx } from "../hooks/useScrollFx";
import { countdown } from "../lib/deadlines";
import GpaStrip from "./GpaStrip";
import CorpusField from "./CorpusField";
import Tile from "./Tile";
import "./landing.css";

// Marketing page in the minimal-SaaS format: centered hero with a real data
// visual, authority strip, clickable school wall, alternating feature sections
// with product visuals, findings from the study, numbers band, FAQ, closing
// CTA. All visuals are ours, drawn from the dataset.

const LADDER = [
  "UC Riverside", "UC Santa Cruz", "UC Santa Barbara", "UC Davis", "UC San Diego",
  "UNC", "UC Irvine", "Michigan", "UC Berkeley", "UCLA", "Cornell",
  "Columbia", "UPenn", "Stanford", "Yale", "Harvard",
];

/** The hero demo — the whole product in one loop: a real profile goes in, the
 *  engine researches it against the corpus, odds come out, and a dated action
 *  plan comes back with the true lift of each move (computed, not written). */
const DEMO_PROFILE: Profile = {
  ...DEFAULT_PROFILE,
  gpa: 3.71,
  schoolName: "De Anza College",
  institution: "cc",
  caResident: true,
  standing: "junior",
  major: "econ",
  ecLevel: "minimal",
  ptk: false,
  honors: false,
  igetc: false,
  essay: "general",
  gpaTrend: "upward",
};
const DEMO_EST = estimateAll(DEMO_PROFILE);
const DEMO_PLAN = buildPlan(DEMO_PROFILE, DEMO_EST);
/** A spread, not four identical rows: the guarantee they'd win, a strong
 *  target, a real target, and the long shot — the whole ladder in one glance. */
const DEMO_ROWS = (() => {
  const pick = (f: (e: Estimate) => boolean) => DEMO_EST.find((e) => f(e) && !seen.has(e.school.name));
  const seen = new Set<string>();
  const out: Estimate[] = [];
  for (const f of [
    (e: Estimate) => e.tier === "TAG guarantee",
    (e: Estimate) => e.p >= 0.2 && e.p < 0.9,
    (e: Estimate) => e.p >= 0.08 && e.p < 0.2,
    (e: Estimate) => e.p < 0.05,
  ]) {
    const hit = pick(f);
    if (hit) { out.push(hit); seen.add(hit.school.name); }
  }
  return out.length >= 3 ? out : DEMO_EST.slice(0, 4);
})();
const DEMO_TAG_WEEKS = DEMO_PLAN.windows.find((w) => w.school === "UC TAG")?.weeks ?? 6;
/** The activities lane on its own — not the whole stacked plan. Every
 *  Extracurricular move pulls the same engine lever, so its computed lift is
 *  what fixing this lane is actually worth. */
const DEMO_EC_LIFT =
  DEMO_PLAN.moves.find((m) => m.tag === "Extracurricular" && m.liftPp > 0)?.liftPp ?? 0;

const DEMO_FIELDS = [
  { label: "College GPA", value: "3.71", hint: "upward" },
  { label: "Now at", value: "De Anza College", hint: "Cupertino, CA" },
  { label: "Standing", value: "Junior · 48 credits", hint: "transfer-ready" },
  { label: "Major", value: "Economics", hint: "prep partial" },
];

/** Their activities, exactly as a student would type them — vague, undersold,
 *  and missing the things they never thought counted. */
const DEMO_ACTS = [
  { raw: "Part-time job at a coffee shop", verdict: "18 hrs/wk, unlisted hours", tone: "warn" },
  { raw: "Member of the econ club", verdict: "member, no role", tone: "warn" },
  { raw: "Volunteered sometimes", verdict: "no span, no number", tone: "bad" },
];

/** What the engine goes and looks up about THEIR school and region. */
const DEMO_SCANS = [
  { run: "Reading your 3 activities against 4,087 catalogued admit activities", found: "all 3 undersold" },
  { run: "De Anza College — campus orgs, honors, PTK chapter", found: "honors + PTK both open to you" },
  { run: "Checking the campus learning center for tutor openings", found: "hires every term" },
  { run: "Scanning your region for major-relevant roles", found: "econ research + civic internships nearby" },
  { run: "Matching against admits from California community colleges", found: "214 comparable files" },
];

/** Per-activity upgrade: the same activity, made legible to a reader. */
const DEMO_UPGRADES = [
  {
    tag: "Your job",
    before: "Part-time job at a coffee shop",
    after: "Shift lead, 18 hrs/wk for 14 months while enrolled full-time — trained 4 new hires, closed nightly registers.",
    why: "Paid work is 13% of admit activities. Hours read as substance.",
    c: "var(--blue)",
  },
  {
    tag: "Your club",
    before: "Member of the econ club",
    after: "Treasurer, Economics Society — elected this term, manage a $2,400 budget across 6 events.",
    why: "Leadership is 11% of admit activities, and officer seats sit unfilled.",
    c: "var(--teal)",
  },
  {
    tag: "Your volunteering",
    before: "Volunteered sometimes",
    after: "Food bank volunteer, 4 hrs/wk for 22 months — coordinate Saturday intake for ~60 families.",
    why: "Same work. A span and a number make it countable.",
    c: "var(--accent)",
  },
];

function useCountUp(target: number, active: boolean, dur = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!active) { setV(0); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, dur]);
  return v;
}

function DemoOdds({ e, active, delay }: { e: Estimate; active: boolean; delay: number }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!active) { setArmed(false); return; }
    const t = window.setTimeout(() => setArmed(true), delay);
    return () => clearTimeout(t);
  }, [active, delay]);
  const lo = useCountUp(e.lo * 100, armed);
  const hi = useCountUp(e.hi * 100, armed);
  const cls = e.p >= 0.45 ? "ok" : e.p >= 0.12 ? "mid" : "low";
  return (
    <div className={`ld-demo-row${armed ? " on" : ""}`}>
      <Tile name={e.school.name} size={22} />
      <span className="ld-demo-rname">{e.school.name}</span>
      <span className="ld-demo-metre" aria-hidden="true">
        <span className={`ld-demo-metre-fill ld-${cls}`} style={{ width: armed ? `${Math.min(100, e.hi * 100)}%` : "0%" }} />
      </span>
      <span className={`ld-demo-band ld-${cls} num`}>
        {lo < 10 ? lo.toFixed(1) : Math.round(lo)}–{hi < 10 ? hi.toFixed(1) : Math.round(hi)}%
      </span>
      <span className="ld-demo-tier">{e.tier}</span>
    </div>
  );
}

function HeroDemo() {
  // 0 profile+activities · 1 analysing each activity · 2 researching school/area · 3 upgrades
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(0);
  const [judged, setJudged] = useState(0);
  const [scan, setScan] = useState(0);
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduced) {
      setStep(3); setTyped(DEMO_FIELDS.length); setJudged(DEMO_ACTS.length); setScan(DEMO_SCANS.length);
      return;
    }
    let t: number[] = [];
    const run = () => {
      setStep(0); setTyped(0); setJudged(0); setScan(0);
      DEMO_FIELDS.forEach((_, i) => t.push(window.setTimeout(() => setTyped(i + 1), 260 + i * 300)));
      t.push(window.setTimeout(() => setStep(1), 1700));
      DEMO_ACTS.forEach((_, i) => t.push(window.setTimeout(() => setJudged(i + 1), 2000 + i * 480)));
      t.push(window.setTimeout(() => setStep(2), 3600));
      DEMO_SCANS.forEach((_, i) => t.push(window.setTimeout(() => setScan(i + 1), 3800 + i * 480)));
      t.push(window.setTimeout(() => setStep(3), 6400));
      t.push(window.setTimeout(run, 17500));
    };
    run();
    return () => { t.forEach(clearTimeout); t = []; };
  }, [reduced]);

  return (
    <div className="ld-demo" aria-hidden="true">
      {/* 1 — the file, as they'd actually enter it */}
      <div className={`ld-demo-panel ld-demo-in${step === 0 ? " scanning" : ""}`}>
        <p className="mock-label">Your profile</p>
        {DEMO_FIELDS.map((f, i) => (
          <div className={`ld-demo-field${i < typed ? " on" : ""}`} key={f.label}>
            <span className="ld-demo-flabel">{f.label}</span>
            <span className="ld-demo-fvalue">
              {f.value}
              {i === typed - 1 && step === 0 && <i className="ld-caret" />}
            </span>
            <span className="ld-demo-fhint">{f.hint}</span>
          </div>
        ))}
        <p className="ld-demo-sub">Your activities, as you'd type them</p>
        {DEMO_ACTS.map((a, i) => (
          <div className={`ld-demo-act${step >= 1 && i < judged ? " judged" : ""}${typed >= DEMO_FIELDS.length ? " on" : ""}`} key={a.raw}>
            <span className="ld-demo-actraw">{a.raw}</span>
            {step >= 1 && i < judged && (
              <span className={`ld-demo-actv ld-demo-${a.tone}`}>{a.verdict}</span>
            )}
          </div>
        ))}
      </div>

      {/* 2 — reading each activity against the corpus */}
      <div className={`ld-demo-panel ld-demo-scan${step >= 1 ? " on" : ""}`}>
        <p className="mock-label">
          Researching your file
          {(step === 1 || step === 2) && <span className="ld-demo-live">live</span>}
        </p>
        {DEMO_SCANS.map((sc, i) => (
          <div className={`ld-demo-scanrow${i < scan ? " done" : i === scan && step === 2 ? " active" : ""}`} key={sc.run}>
            <span className="ld-demo-scanicon">
              {i < scan ? "✓" : i === scan && step === 2 ? <span className="ld-demo-spin" /> : "·"}
            </span>
            <span className="ld-demo-scantext">
              {sc.run}
              {i < scan && <b>{sc.found}</b>}
            </span>
          </div>
        ))}
        <div className={`ld-demo-scanfoot${scan >= DEMO_SCANS.length ? " on" : ""}`}>
          Every activity you listed can be rewritten from what you already do
        </div>
      </div>

      {/* 3 — each activity, upgraded */}
      <div className={`ld-demo-panel ld-demo-fix${step >= 3 ? " on" : ""}`}>
        <p className="mock-label">
          How to upgrade each one
          <span className="ld-demo-clock">{DEMO_TAG_WEEKS} weeks to TAG</span>
        </p>
        {DEMO_UPGRADES.map((u, i) => (
          <div
            className={`ld-demo-up${step >= 3 ? " on" : ""}`}
            key={u.tag}
            style={{ transitionDelay: `${i * 160}ms`, "--fx": u.c } as CSSProperties}
          >
            <span className="ld-demo-uptag">{u.tag}</span>
            <p className="ld-demo-before">{u.before}</p>
            <p className="ld-demo-after">{u.after}</p>
            <p className="ld-demo-upwhy">{u.why}</p>
          </div>
        ))}
      </div>

      {/* 4 — what it does to the odds */}
      <div className={`ld-demo-panel ld-demo-out${step >= 3 ? " on" : ""}`}>
        <p className="mock-label">Your chances</p>
        {DEMO_ROWS.map((e, i) => (
          <DemoOdds key={e.school.id} e={e} active={step >= 3} delay={i * 150} />
        ))}
        <div className={`ld-demo-stack${step >= 3 ? " on" : ""}`}>
          {DEMO_EC_LIFT >= 0.1 ? (
            <>Fixing the activities lane alone → <b className="num">+{DEMO_EC_LIFT.toFixed(1)} pts</b> across your list</>
          ) : (
            <>Same work, made legible — the whole plan is worth <b className="num">+{DEMO_PLAN.stackedPp.toFixed(1)} pts</b></>
          )}
        </div>
      </div>
    </div>
  );
}

/** Official transfer admit rates, highest to lowest —
 *  the ~50× spread is the single most striking fact in the dataset. */
function RateLadder() {
  const schools = LADDER
    .map((n) => MODEL.schools.find((s) => s.name === n)!)
    .sort((a, b) => b.rate - a.rate);
  const max = schools[0].rate;
  return (
    <figure className="ld-ladder" aria-label="Official transfer admit rates from highest to lowest">
      <div className="ld-ladder-rows">
        {schools.map((s, i) => (
          <button
            type="button"
            className="ld-ladder-row"
            key={s.id}
            onClick={() => window.location.assign(`#/schools/${s.id}`)}
          >
            <span className="ld-ladder-school">
              <Tile name={s.name} size={22} />
              <span>{markOf(s.name).word}</span>
            </span>
            <span className="ld-ladder-barwrap">
              <span
                className="ld-ladder-bar"
                style={{ width: `${(s.rate / max) * 100}%`, transitionDelay: `${120 + i * 70}ms` }}
              />
            </span>
            <span className="ld-ladder-rate num">{s.rate.toFixed(1)}%</span>
          </button>
        ))}
      </div>
      <figcaption>
        Official transfer admit rates, latest Common Data Set — a {Math.round(schools[0].rate / schools[schools.length - 1].rate)}× spread across the T25. Click any school.
      </figcaption>
    </figure>
  );
}

/** Animated count-up that starts when the number scrolls into view.
 *  Skips straight to the final value under prefers-reduced-motion. */
function CountUp({ value, duration = 1300 }: { value: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) {
      setShown(value);
      return;
    }
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || started.current) return;
        started.current = true;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / duration);
          const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
          setShown(Math.round(value * eased));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);
  return <span ref={ref} className="num">{shown.toLocaleString()}</span>;
}

/** Official university lockups (Wikimedia Commons, openly hosted brand SVGs).
 *  Order is deliberate; each renders in an identical box (object-fit) so
 *  every logo occupies the same footprint. */
const LOCKUPS: { n: string; src: string }[] = [
  { n: "Stanford University", src: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Stanford_wordmark_%282012%29.svg" },
  { n: "University of Pennsylvania", src: "https://upload.wikimedia.org/wikipedia/commons/9/92/University_of_Pennsylvania_wordmark.svg" },
  { n: "Cornell University", src: "https://upload.wikimedia.org/wikipedia/commons/4/4b/Cornell_University_logo.svg" },
  { n: "Duke University", src: "https://upload.wikimedia.org/wikipedia/commons/e/e6/Duke_University_logo.svg" },
  { n: "Columbia University", src: "https://upload.wikimedia.org/wikipedia/commons/e/e4/Columbia_University_1754_updated.svg" },
  { n: "Brown University", src: "https://upload.wikimedia.org/wikipedia/commons/a/a1/Brown_University_logo.svg" },
];

/** Dramatic hero ticker: cycles school → animated admit rate, color-coded. */
const TICKER = [
  "Harvard", "UC Riverside", "Stanford", "Michigan", "Yale", "UC Davis",
  "Columbia", "UNC", "Cornell", "UC Berkeley", "UPenn", "UCLA",
];

function OddsTicker() {
  const [i, setI] = useState(0);
  const [disp, setDisp] = useState(() => MODEL.schools.find((s) => s.name === TICKER[0])!.rate);
  const raf = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % TICKER.length), 2600);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const target = MODEL.schools.find((s) => s.name === TICKER[i])!.rate;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisp(target);
      return;
    }
    const from = disp;
    const t0 = performance.now();
    const dur = 700;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisp(from + (target - from) * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  const name = TICKER[i];
  const rate = MODEL.schools.find((s) => s.name === name)!.rate;
  const color = rate < 5 ? "var(--coral)" : rate < 15 ? "var(--accent)" : rate < 40 ? "var(--blue)" : "var(--teal)";

  return (
    <div className="ld-ticker" aria-hidden="true">
      <span className="ld-ticker-school" key={i}>
        <Tile name={name} size={34} />
        <span>
          <b>{markOf(name).word}</b>
          <i>transfer admit rate</i>
        </span>
      </span>
      <span className="ld-ticker-num num" style={{ color }}>{disp.toFixed(1)}%</span>
      <span className="ld-ticker-bar" key={`b${i}`} style={{ background: color }} />
    </div>
  );
}

/** School logos drifting behind the hero. */
const ORBIT: { n: string; top: string; left: string; s: number; d: number }[] = [
  { n: "Harvard", top: "12%", left: "6%", s: 34, d: 11 },
  { n: "Stanford", top: "30%", left: "12%", s: 26, d: 14 },
  { n: "UCLA", top: "62%", left: "7%", s: 30, d: 12 },
  { n: "Cornell", top: "16%", left: "90%", s: 30, d: 13 },
  { n: "Michigan", top: "40%", left: "94%", s: 26, d: 10 },
  { n: "UC Berkeley", top: "66%", left: "89%", s: 34, d: 15 },
  { n: "Yale", top: "82%", left: "16%", s: 24, d: 12 },
  { n: "Columbia", top: "84%", left: "82%", s: 24, d: 11 },
];

function OrbitLogos() {
  return (
    <div className="ld-orbit" aria-hidden="true">
      {ORBIT.map((o, idx) => (
        <span
          key={o.n}
          className="ld-orbit-item"
          style={{ top: o.top, left: o.left, animationDuration: `${o.d}s`, animationDelay: `${idx * -1.7}s` }}
        >
          <Tile name={o.n} size={o.s} />
        </span>
      ))}
    </div>
  );
}

function FeatureStrip() {
  const cornell = MODEL.schools.find((s) => s.name === "Cornell")!;
  return (
    <section className="features" id="how">
      <h2>Nothing here is a vibe</h2>
      <p className="sec-dek">Every number traces to a source you can check.</p>

      <div className="feature ld-feature" data-fx>
        <div className="f-copy">
          <h3>Your GPA against real admits</h3>
          <p>
            Each school shows the actual GPA range of its observed admitted transfers — 25th percentile,
            median, 75th — with your mark on the same scale. No mystery score, no black box.
          </p>
        </div>
        <div className="f-visual">
          <div className="mock ld-mock">
            <div className="mock-row">
              <Tile name="Cornell" />
              <div>
                <b>Cornell</b>
                <span className="mock-sub">{cornell.rate.toFixed(1)}% official transfer admit rate</span>
              </div>
              <span className="mock-band">11–21%</span>
            </div>
            <GpaStrip school={cornell} gpa={3.85} />
          </div>
        </div>
      </div>

      <div className="feature ld-feature" data-fx>
        <div className="f-copy">
          <h3>Upload your actual application</h3>
          <p>
            Drop in a transcript or Common App PDF and we read the GPA, credits, courses, and credentials
            straight from the document. Parsed on your device — your file never leaves the browser.
          </p>
        </div>
        <div className="f-visual">
          <div className="mock ld-mock">
            <p className="mock-label">Found in transcript.pdf</p>
            <div className="chipset">
              {["GPA 3.87", "52 credits → junior", "California CC", "Phi Theta Kappa", "IGETC", "Major: computer science"].map((c) => (
                <span key={c} className="chip">{c}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="feature ld-feature" data-fx>
        <div className="f-copy">
          <h3>An essay check with ground truth</h3>
          <p>
            Admits' essays name programs, professors, and courses; complaint-shaped essays fail. Paste your
            "why transfer" draft and see which of your targets it actually speaks to — checked against what
            {" "}{Number(MODEL.meta.rows).toLocaleString()} recorded outcomes say works.
          </p>
        </div>
        <div className="f-visual">
          <div className="mock ld-mock">
            <p className="mock-label">Essay check</p>
            <p className="mock-line">412 words · school-specific for <b>Cornell, UCLA</b> · 2 professors named</p>
            <p className="mock-note ok">Schools you name get the specificity credit in your chances.</p>
            <p className="mock-note warn">Michigan isn't named — admits there cite LSA and Ross specifics.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Interactive per-school intelligence file: pick any measured school and the
 *  dossier updates with everything we hold on it. */
function SchoolIntel({ onOpenSchool }: { onOpenSchool: (name: string) => void }) {
  const [sel, setSel] = useState("Cornell");
  const s = MODEL.schools.find((x) => x.name === sel)!;
  const cd = countdown(s.name);
  const tagMin = TAG_CAMPUSES[s.name];
  const clean = (v: string) => v.replace(/\s*\(\d+\)\s*/g, " ").trim();
  const rateColor =
    s.rate < 5 ? "var(--coral)" : s.rate < 15 ? "var(--accent)" : s.rate < 40 ? "var(--blue)" : "var(--teal)";
  const gpaPos = (g: number) => `${Math.min(100, Math.max(0, ((g - 3.0) / 1.0) * 100))}%`;

  return (
    <section className="shell ld-intel" data-fx aria-labelledby="ld-intel-h">
      <h2 id="ld-intel-h">Pick a school. See what we know.</h2>
      <p className="sec-dek">
        An intelligence file on every school we measure — official numbers, observed admits, feeders,
        deadlines, and what actually moves a file there.
      </p>
      <div className="ld-intel-tabs" role="tablist" aria-label="Choose a school">
        {MODEL.schools.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={x.name === sel}
            aria-label={x.name}
            title={x.name}
            className={`ld-intel-tab${x.name === sel ? " on" : ""}`}
            style={{ "--sc": markOf(x.name).color } as CSSProperties}
            onClick={() => setSel(x.name)}
          >
            <Tile name={x.name} size={24} />
          </button>
        ))}
      </div>

      <article className="ld-dossier" key={s.id} aria-live="polite">
        <header className="ld-dossier-head">
          <Tile name={s.name} size={40} />
          <div>
            <h3>{s.name}</h3>
            <p>{s.cycle || "latest Common Data Set"}</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => onOpenSchool(s.name)}>
            Full profile →
          </button>
        </header>

        <div className="ld-dossier-stats">
          <div className="ld-dstat">
            <i>Transfer admit rate</i>
            <b className="num" style={{ color: rateColor }}>{s.rate.toFixed(1)}%</b>
            <span>official, not forum lore</span>
          </div>
          <div className="ld-dstat">
            <i>Last cycle</i>
            <b className="num">{s.applicants ? s.applicants.toLocaleString() : "—"}</b>
            <span>applied · {s.admitted ? s.admitted.toLocaleString() : "—"} admitted</span>
          </div>
          <div className="ld-dstat ld-dstat-gpa">
            <i>Admitted GPA</i>
            {s.gpa.p50 != null ? (
              <>
                <div className="ld-gpabar" aria-hidden="true">
                  <span
                    className="ld-gpaband"
                    style={{ left: gpaPos(s.gpa.p25!), width: `calc(${gpaPos(s.gpa.p75!)} - ${gpaPos(s.gpa.p25!)})` }}
                  />
                  <span className="ld-gpatick" style={{ left: gpaPos(s.gpa.p50) }} />
                </div>
                <span>
                  <b className="num">{s.gpa.p25!.toFixed(2)}</b> – median <b className="num">{s.gpa.p50.toFixed(2)}</b> –{" "}
                  <b className="num">{s.gpa.p75!.toFixed(2)}</b> · n={s.nGpa}
                </span>
              </>
            ) : (
              <>
                <b>Not published</b>
                <span>UC stopped releasing it — we estimate from selectivity</span>
              </>
            )}
          </div>
          <div className="ld-dstat">
            <i>Deadline</i>
            <b className="num" style={{ color: "var(--accent)" }}>{cd ? cd.days : "—"}</b>
            <span>{cd ? `days · ${cd.label}` : "see school page"}{tagMin ? ` · TAG by Sep 30 (${tagMin.toFixed(1)}+)` : ""}</span>
          </div>
        </div>

        <div className="ld-dossier-body">
          <div>
            {s.counsel?.typical && (
              <>
                <h4>Who actually gets in</h4>
                <p>{s.counsel.typical}</p>
              </>
            )}
            {s.counsel?.levers?.length ? (
              <>
                <h4>What moves a file here</h4>
                <ul>
                  {s.counsel.levers.slice(0, 2).map((l) => <li key={l}>{l}</li>)}
                </ul>
              </>
            ) : null}
          </div>
          <div>
            {s.majors.length > 0 && (
              <>
                <h4>Common admit majors</h4>
                <div className="chipset">
                  {s.majors.slice(0, 4).map((m) => <span className="chip" key={m}>{clean(m)}</span>)}
                </div>
              </>
            )}
            {s.counsel?.feeders && (
              <>
                <h4>Feeders</h4>
                <p>{s.counsel.feeders}</p>
              </>
            )}
            {s.coadmit.length > 0 && (
              <>
                <h4>Cross-admits also got into</h4>
                <div className="ld-coadmit">
                  {s.coadmit.slice(0, 5).map((c) => {
                    const n = clean(c);
                    return <Tile key={n} name={n} size={24} />;
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="ld-dossier-foot">
          {s.nAdmits > 0 ? (
            <span><b>{s.nAdmits}</b> observed admits · <b>{s.nGpa}</b> GPA points · <b>{s.trend.length}</b> cycles tracked in our study</span>
          ) : (
            <span>Official published transfer data · {s.cycle || "latest cycle"}</span>
          )}
          <span className="ld-dossier-srcs">Sources: Common Data Set · UC admit data · 8,910-outcome study</span>
        </footer>
      </article>
      <p className="ld-findfoot">All {MODEL.schools.length} measured schools above — plus directory profiles for 4,025 more in <a href="#/browse">Browse</a>.</p>
    </section>
  );
}

/** What admits actually list, from the activity inventory — and the moves
 *  you can copy, with the lifts the engine actually scores. */
const ADMIT_ACTIVITIES = [
  { label: "Campus club membership", pct: 16 },
  { label: "Real job / paid work", pct: 13 },
  { label: "Club leadership — officer, founder", pct: 11 },
  { label: "Volunteering", pct: 8 },
  { label: "Competitions & awards", pct: 8 },
  { label: "Internships", pct: 8 },
  { label: "Faculty research", pct: 7 },
  { label: "Scholarships — PTK, Jack Kent Cooke", pct: 6 },
  { label: "Tutoring / TA-ing", pct: 6 },
  { label: "Student government", pct: 3 },
];

const MOVES = [
  { t: "Take a leadership seat on campus", d: "Officer, president, or founder of a campus org — leadership is 11% of everything admits list, and it's open to anyone who shows up.", c: "var(--teal)" },
  { t: "Keep your job on the application", d: "Paid work is 13% of admit activities. Hours worked read as substance and maturity — never as a gap.", c: "var(--blue)" },
  { t: "Get into the institutional stack", d: "PTK, honors program, Dean's List — credentials every admissions reader recognizes in one line.", c: "var(--accent)" },
  { t: "TA, tutor, or join a lab", d: "Faculty-adjacent roles are the strongest \"already doing the work\" signal in admit files.", c: "var(--coral)" },
];

const LEVERS = [
  { t: "File TAG by Sep 30", lift: "guarantee", d: "Six UCs sign a contract at 2.7–3.4+ GPA. Not odds — a guarantee." },
  { t: "Apply to UCs from a California CC", lift: "×1.5", d: "The pipeline the UC system is built on." },
  { t: "Name the program in your essay", lift: "×1.3", d: "The #1 differentiator admits credit." },
  { t: "Finish IGETC", lift: "×1.15", d: "The UC breadth pattern, done." },
  { t: "Join Phi Theta Kappa", lift: "×1.12", d: "One application. Every reader knows it." },
  { t: "Show an upward GPA trend", lift: "×1.08", d: "Redemption arcs are 16% of admits." },
];

function Playbook() {
  return (
    <section className="shell ld-play" data-fx aria-labelledby="ld-play-h">
      <h2 id="ld-play-h">What we can get you — specifically</h2>
      <p className="sec-dek">
        We catalogued 4,087 activities from 628 admitted files. This is what their lists look like,
        the moves you can copy, and the exact lifts we score.
      </p>

      <div className="ld-play-grid">
        <div className="ld-play-card">
          <p className="mock-label">What 628 admits actually listed</p>
          <div className="ld-acts">
            {ADMIT_ACTIVITIES.map((a, i) => (
              <div className="ld-act" key={a.label}>
                <span className="ld-act-label">{a.label}</span>
                <span className="ld-act-track">
                  <span className="ld-act-bar" style={{ width: `${(a.pct / 16) * 100}%`, transitionDelay: `${i * 60}ms` }} />
                </span>
                <span className="ld-act-pct num">{a.pct}%</span>
              </div>
            ))}
          </div>
          <p className="ld-act-note">
            <b className="ld-teal">50%</b> of admit activities live on their own campus — only{" "}
            <b className="ld-coral">9%</b> are national-level. Pattern beats prestige.
          </p>
        </div>

        <div className="ld-play-moves">
          <p className="mock-label">Moves you can start this semester</p>
          {MOVES.map((m) => (
            <div className="ld-move" key={m.t} style={{ "--mc": m.c } as CSSProperties}>
              <h3>{m.t}</h3>
              <p>{m.d}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="ld-levers">
        {LEVERS.map((l, i) => (
          <div className={`ld-lever${i === 0 ? " ld-lever-big" : ""}`} key={l.t}>
            <span className="ld-lever-lift num">{l.lift}</span>
            <h3>{l.t}</h3>
            <p>{l.d}</p>
          </div>
        ))}
      </div>

      <p className="ld-play-honest">
        And what we can't: nothing on this page rescues a below-median GPA at the single-digit schools.
        When a door is shut we say so — and show you the ones standing open.
      </p>
    </section>
  );
}

interface Finding {
  figure: string;
  unit?: string;
  color: string;
  title: string;
  body: string;
  tiles?: string[];
}

const FINDINGS: Finding[] = [
  {
    figure: "16%",
    color: "var(--accent)",
    title: "of admits are redemption cases",
    body: "High-school record barely predicts college GPA (correlation 0.016). Transfer is scored on what you did after — a weak start at 17 doesn't follow you.",
  },
  {
    figure: "92%",
    color: "var(--blue)",
    title: "UCLA runs on the CC pipeline",
    body: "92% of UCLA's admitted transfers come from California community colleges. Where you're applying from matters.",
  },
  {
    figure: "3.95–4.0",
    color: "var(--teal)",
    title: "Elite privates cluster at the top",
    body: "Admitted transfers at elite private universities cluster in the 3.95–4.0 college-GPA band.",
  },
  {
    figure: "5",
    unit: "schools",
    color: "var(--coral)",
    title: "Where transfer beats freshman",
    body: "Cornell, Northwestern, UChicago, Vanderbilt, and Michigan all admit transfers at a higher rate than freshmen.",
    tiles: ["Cornell", "Northwestern", "Chicago", "Vanderbilt", "Michigan"],
  },
];

function Findings({ rows }: { rows: string }) {
  return (
    <section className="shell ld-findings" data-fx aria-labelledby="ld-findings-h">
      <h2 id="ld-findings-h">What the data says</h2>
      <p className="ld-sec-dek">Findings from {rows} recorded outcomes — some of them surprising.</p>
      <div className="ld-findgrid" data-fx-stagger>
        {FINDINGS.map((f, i) => (
          <div key={f.title} style={{ "--d": `${i * 90}ms` } as CSSProperties}>
            <div className="ld-findcard" style={{ "--fc": f.color } as CSSProperties}>
              <span className="ld-fig">
                {f.figure}
                {f.unit && <small>{f.unit}</small>}
              </span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              {f.tiles && (
                <div className="ld-findtiles" aria-hidden="true">
                  {f.tiles.map((t) => <Tile key={t} name={t} size={22} />)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="ld-findfoot">Every finding above comes from the study behind this tool, not from folklore.</p>
    </section>
  );
}

export default function Landing({ onStart, onOpenSchool }: { onStart: () => void; onOpenSchool: (name: string) => void }) {
  const rows = Number(MODEL.meta.rows).toLocaleString();
  useReveal();
  useScrollFx();

  // Pointer parallax: the hero's cards and glow orbs drift a few pixels
  // toward the cursor at different depths. Off under reduced motion.
  const heroRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = heroRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--px", (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3));
        el.style.setProperty("--py", (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3));
      });
    };
    el.addEventListener("mousemove", onMove);
    return () => { el.removeEventListener("mousemove", onMove); cancelAnimationFrame(raf); };
  }, []);

  return (
    <main>
      <div className="ld-herowrap" ref={heroRef}>
        <div className="ld-orbs" aria-hidden="true">
          <span className="ld-orb ld-orb-a" />
          <span className="ld-orb ld-orb-b" />
          <span className="ld-orb ld-orb-c" />
          <span className="ld-orb ld-orb-d" />
        </div>
        <section className="shell hero">
          <OrbitLogos />
          <span className="badge">{rows} real transfer applications analyzed · 2011–2026</span>
          <h1 className="ld-h1">
            <span className="ld-w">Where</span> <span className="ld-w">would</span>{" "}
            <span className="ld-w">you</span> <em className="ld-grad ld-w">actually</em>{" "}
            <span className="ld-w">get</span> <span className="ld-w">in?</span>
          </h1>
          <p className="dek">
            Harvard takes <b className="ld-coral">0.7%</b> of transfers. UNC takes{" "}
            <b className="ld-teal">37%</b>. Six UCs will <b className="ld-purple">guarantee</b> your
            spot. Your real odds at every top school — from {rows} real applications and official
            data, not forum guesses.
          </p>
          <HeroDemo />
          <OddsTicker />
          <div className="cta-row">
            <button type="button" className="btn ld-btn-xl" onClick={onStart}>Check my chances — free</button>
            <p className="aside">2 minutes · free account to see your report · nothing leaves your browser</p>
          </div>
          <div className="ld-authority">
            <span className="ld-authority-claim">Made by students who transferred into multiple Ivies</span>
            <span className="ld-lockups">
              {LOCKUPS.map((l) => (
                <img
                  key={l.n}
                  src={l.src}
                  alt={l.n}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              ))}
              <span className="ld-lockup-more">+ many more</span>
            </span>
            <span className="ld-authority-sub"><b>{rows}</b> real applications analyzed</span>
          </div>
        </section>
      </div>

      <section className="ld-wall" data-fx aria-label="Schools covered">
        <p className="strip-label">Measured against every T25</p>
        <div className="ld-marquee">
          <div className="ld-marquee-track">
            {[0, 1].map((dup) => (
              <div className="ld-wallgrid" key={dup} aria-hidden={dup === 1 || undefined}>
                {MODEL.schools.map((s) => (
                  <button
                    key={`${dup}-${s.id}`}
                    type="button"
                    className="ld-wall-btn"
                    tabIndex={dup === 1 ? -1 : undefined}
                    style={{ "--sc": markOf(s.name).color } as CSSProperties}
                    onClick={() => onOpenSchool(s.name)}
                  >
                    <Tile name={s.name} size={20} />
                    {markOf(s.name).word}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        <p className="ld-wall-hint">Pick a school to see its transfer data — admit rate, GPA range, feeders, trend.</p>
      </section>

      <SchoolIntel onOpenSchool={onOpenSchool} />

      <div className="shell"><FeatureStrip /></div>

      <section className="shell ld-field" data-fx data-fx-track aria-label="The dataset and official admit rates">
        <h2 className="ld-field-h">Every outcome we have, drawn</h2>
        <p className="sec-dek">
          {rows} recorded transfer decisions, one dot each. Then only the admits, dropped into the
          GPA distribution they actually landed in.
        </p>
        <CorpusField />
        <h2 className="ld-field-h ld-field-h2">The field, measured</h2>
        <p className="sec-dek">Official transfer admit rates across the T25 — the spread is enormous.</p>
        <RateLadder />
      </section>

      <Playbook />

      <Findings rows={rows} />

      <section className="numbers">
        <div className="shell factline">
          <span><b><CountUp value={Number(MODEL.meta.rows)} /></b> recorded outcomes</span>
          <span><b><CountUp value={Number(MODEL.meta.admits)} /></b> observed admits</span>
          <span><b><CountUp value={MODEL.schools.length} duration={900} /></b> top universities</span>
          <span><b><CountUp value={15} duration={900} /></b> application cycles</span>
        </div>
      </section>

      <section className="shell faq" data-fx>
        <h2>Questions people ask</h2>
        <details>
          <summary>Where does the data come from?</summary>
          <p>
            Two places. Baseline admit rates come from each university's official Common Data Set and the
            UC system's published admit data. The admitted-student profiles — GPAs, majors, feeder schools,
            essays that worked — come from {rows} self-reported transfer outcomes posted publicly between
            2011 and 2026, cleaned and cross-checked.
          </p>
        </details>
        <details>
          <summary>Are these my actual chances?</summary>
          <p>
            They're honest estimates, not decisions. Self-reported outcomes over-represent acceptances —
            people post wins, not rejections — so baselines stay anchored to official rates, ranges are
            shown instead of fake-precise numbers, and small samples are flagged. Lanes where the bias
            runs hottest get discounted hardest: CS transfer success stories are far more visible online
            than CS transfer seats actually exist, and the engine scores the scarcity, not the stories.
          </p>
        </details>
        <details>
          <summary>Is my transcript or essay stored anywhere?</summary>
          <p>
            No. Uploads and essays are parsed in your browser and never sent to a server. Your profile is
            saved only in your own browser's storage.
          </p>
        </details>
        <details>
          <summary>How much do extracurriculars count?</summary>
          <p>
            They matter — and pattern beats prestige. In 1,217 structured profiles, campus-anchored
            activities (leadership, tutoring, PTK, faculty research) recur throughout admit files, while
            trophy ECs alone don't rescue a GPA. The deep review grades your actual activity
            descriptions and shows you how admits frame theirs.
          </p>
        </details>
      </section>

      <section className="closing">
        <div className="shell reveal">
          <h2>Two minutes. Real numbers.</h2>
          <button type="button" className="btn" onClick={onStart}>Check my chances</button>
        </div>
      </section>

      <footer className="shell sitefoot">
        <p>
          Estimates for orientation, not admissions advice. Not affiliated with any university; school names
          are used only to identify the institutions the data describes.
        </p>
      </footer>
    </main>
  );
}
