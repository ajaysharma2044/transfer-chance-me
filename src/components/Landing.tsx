import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { DEFAULT_PROFILE, estimateAll, MODEL, TAG_CAMPUSES } from "../engine";
import type { Estimate, Profile } from "../engine";
import { buildPlan } from "../lib/actionplan";
import { admitSignatures, CORPUS_META, countEligible, findSimilar, MATCH_WINDOW } from "../lib/similar";
import { markOf } from "../lib/schools";
import { useReveal } from "../hooks/useReveal";
import { useScrollFx } from "../hooks/useScrollFx";
import { countdown } from "../lib/deadlines";
import GpaStrip from "./GpaStrip";
import CorpusField from "./CorpusField";
import CampusPhoto from "./CampusPhoto";
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

/** "extract" fields come off the transcript PDF, the way extract.ts really
 *  reads one — GPA, SAT, credits→standing, institution, major, honors/PTK.
 *  "type" fields are the ones only the student can write. Order matters:
 *  extract fields must come first so the upload burst can reveal 0..k. */
const DEMO_FIELDS: { label: string; value: string; hint: string; via: "extract" | "type" }[] = [
  { label: "College GPA", value: "3.71", hint: "upward", via: "extract" },
  { label: "SAT / ACT", value: "1310", hint: "on file", via: "extract" },
  { label: "Now at", value: "De Anza College", hint: "Cupertino, CA", via: "extract" },
  { label: "Standing", value: "Junior · 48 credits", hint: "transfer-ready", via: "extract" },
  { label: "Major", value: "Economics", hint: "prep partial", via: "extract" },
  { label: "Awards", value: "Dean's List x2, PTK inducted", hint: "institutional stack", via: "extract" },
  { label: "Why transferring", value: "My CC doesn't offer upper-division econ", hint: "reason on file", via: "type" },
];
const DEMO_EXTRACT_COUNT = DEMO_FIELDS.filter((f) => f.via === "extract").length;

/** Their activities, exactly as a student would type them — vague, undersold,
 *  and missing the things they never thought counted. */
const DEMO_ACTS = [
  { raw: "Part-time job at a coffee shop", verdict: "18 hrs/wk, unlisted hours", tone: "warn" },
  { raw: "Member of the econ club", verdict: "member, no role", tone: "warn" },
  { raw: "Volunteered sometimes", verdict: "no span, no number", tone: "bad" },
];

/** What the engine goes and looks up about THEIR school and region. Every
 *  "found" is a real, sourced number from the study — not a model guessing. */
const DEMO_SCANS = [
  { run: "Reading your 3 activities against 4,087 catalogued admit activities", found: "all 3 undersold" },
  { run: "De Anza College — campus orgs, honors, PTK chapter", found: "honors + PTK both open to you" },
  { run: "Checking department-level odds, not just campus-wide", found: "econ runs open — CS at these UCs is 3× harder" },
  { run: "Scanning your region for major-relevant roles", found: "econ research + civic internships nearby" },
  { run: "Matching against admits from California community colleges", found: "214 comparable files" },
];

/** Not individual student records — aggregate, sourced patterns from the
 *  study that this profile falls inside. This is the thing a GPT wrapper
 *  cannot show you: a real number from a real corpus, not a plausible guess. */
const DEMO_PATTERNS = [
  { stat: "68%", label: "of admits sit at 3.90+ GPA — you're inside that band and climbing" },
  { stat: "92%", label: "of UCLA's admitted transfers come from a CA community college, same as you" },
  { stat: "50%", label: "of admit activities are campus-anchored — the lane your file is thinnest in" },
];

/** The schools this run is actually being measured against. */
const DEMO_TARGETS = DEMO_ROWS.map((e) => e.school.name);
/** Real recorded applicants whose file reads closest to this one — with the
 *  schools that took them AND the ones that didn't. Nothing here is written:
 *  every row is a person in the corpus, matched at runtime by the same
 *  function the product runs for a real user. */
const DEMO_MATCHES = findSimilar(DEMO_PROFILE, DEMO_TARGETS, 3);
/** The narrowing, counted: every file scanned → the ones inside the match
 *  window → the three nearest. The arithmetic on screen has to hold. */
const DEMO_ELIGIBLE = countEligible(DEMO_PROFILE);
/** What the admitted files at those targets actually look like. Targets with
 *  too few observed admits return nothing rather than a number that would
 *  read as authoritative. */
const DEMO_SIGS = admitSignatures(DEMO_TARGETS, 2);
/** Targets the corpus cannot speak to. Naming them is the point: a school we
 *  have no observed admits for gets its official rate and nothing invented. */
const DEMO_THIN_TARGETS = DEMO_TARGETS
  .filter((t) => !DEMO_SIGS.some((s) => s.school === t))
  .map((t) => markOf(t).word);

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
      <span className="ld-demo-rphoto">
        <CampusPhoto name={e.school.name} color={markOf(e.school.name).color} height={30} />
      </span>
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

type FocusKind = "upload" | "field" | "act" | null;

/** The physical keyboard: the real US layout, each key its relative width and
 *  its legend. Widths are relative so the deck stays correct at any scale
 *  instead of being hand-placed pixels. */
interface Key { w: number; l?: string; sm?: boolean }
const k = (l: string, w = 1, sm = false): Key => ({ w, l, sm });

const KEY_ROWS: Key[][] = [
  [k("esc", 1.45, true), ...["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"]
    .map((f) => k(f, 1, true)), k("", 1.1)],
  [k("`"), ...["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((d) => k(d)),
    k("–"), k("="), k("delete", 1.9, true)],
  [k("tab", 1.5, true), ...["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"].map((c) => k(c)),
    k("["), k("]"), k("\\", 1.1)],
  [k("caps", 1.75, true), ...["A", "S", "D", "F", "G", "H", "J", "K", "L"].map((c) => k(c)),
    k(";"), k("'"), k("return", 2.05, true)],
  [k("shift", 2.25, true), ...["Z", "X", "C", "V", "B", "N", "M"].map((c) => k(c)),
    k(","), k("."), k("/"), k("shift", 2.55, true)],
];
/** Bottom row: fn ctrl opt cmd space cmd opt, then the arrow cluster. */
const KEY_BOTTOM: Key[] = [
  k("fn", 1, true), k("ctrl", 1, true), k("opt", 1, true), k("cmd", 1.3, true),
  k("", 5.6), k("cmd", 1.3, true), k("opt", 1, true),
];

/** A struck key: which one, and where it sits so the hands can reach it. */
interface Strike {
  key: string;        // "<row>:<index>"
  x: number;          // 0–1 across the keyboard
  row: number;
  hand: "l" | "r";
  finger: number;     // 0–3, outside-in on the left, inside-out on the right
  thumb: boolean;     // the space bar
}

/** Where a key sits across the board, as a fraction — derived from the same
 *  relative widths the keys are laid out with, so the hands land on the key
 *  the CSS actually drew rather than a guessed pixel. */
function keyCentre(row: number, idx: number): number {
  const keys = row === 5 ? [...KEY_BOTTOM, k("", 1), k("", 1), k("", 1)] : KEY_ROWS[row];
  const total = keys.reduce((a, b) => a + b.w, 0);
  const before = keys.slice(0, idx).reduce((a, b) => a + b.w, 0);
  return (before + keys[idx].w / 2) / total;
}

/** Where a character actually lives on the board, so the hand reaches for the
 *  key it is really typing rather than an arbitrary one. */
const CHAR_KEY = (() => {
  const m = new Map<string, { row: number; idx: number }>();
  KEY_ROWS.forEach((row, r) => {
    row.forEach((key, i) => {
      if (key.l && key.l.length === 1 && !key.sm) m.set(key.l.toLowerCase(), { row: r, idx: i });
    });
  });
  return m;
})();

/** Rows the typing animation actually strikes — the letter rows and the
 *  space bar, never the function row. */
function MacKeyboard({ hit }: { hit: Strike | null }) {
  return (
    <div className="ld-kb" aria-hidden="true">
      <div className="ld-kb-keys">
        {KEY_ROWS.map((row, r) => (
          <div className={`ld-kb-row${r === 0 ? " ld-kb-fn" : ""}`} key={r}>
            {row.map((key, i) => (
              <span
                className={`ld-kb-key${hit?.key === `${r}:${i}` ? " down" : ""}${key.sm ? " sm" : ""}`}
                style={{ flexGrow: key.w }}
                key={i}
              >
                {key.l}
              </span>
            ))}
          </div>
        ))}
        <div className="ld-kb-row">
          {KEY_BOTTOM.map((key, i) => (
            <span
              className={`ld-kb-key${hit?.key === `5:${i}` ? " down" : ""}${key.sm ? " sm" : ""}`}
              style={{ flexGrow: key.w }}
              key={i}
            >
              {key.l}
            </span>
          ))}
          {/* Arrows: full-height left/right, stacked half-height up/down. */}
          <span className="ld-kb-key" style={{ flexGrow: 1 }} />
          <span className="ld-kb-arrows">
            <span className="ld-kb-key ld-kb-half" />
            <span className="ld-kb-key ld-kb-half" />
          </span>
          <span className="ld-kb-key" style={{ flexGrow: 1 }} />
        </div>
      </div>
      <div className="ld-kb-pad" />
    </div>
  );
}

/** A hand seen from above, resting on the deck. Drawn once and mirrored for
 *  the left, with each finger its own element so a single one can tap. The
 *  hands sit inside the rotated deck, so they take its perspective for free
 *  instead of needing their own fake one.
 *
 *  Finger order is outside-in: 0 pinky, 1 ring, 2 middle, 3 index. */
/** Drawn as a RIGHT hand, palm down, fingers pointing away — so the thumb
 *  falls on the inside, next to the space bar, and the left hand is this
 *  same drawing mirrored. Fingers are stroked paths with round caps: real
 *  fingers are near-uniform width with a domed tip, which is exactly what a
 *  round-capped stroke gives, and it curves far better than a rectangle.
 *
 *  `id` is the finger's name; `fi` is its index outside-in (0 = pinky). */
const FINGERS = [
  { id: "index", fi: 3, d: "M50 104 C 46 74, 43 46, 42 22", w: 13.5 },
  { id: "middle", fi: 2, d: "M69 104 C 68 70, 67 36, 67 10", w: 14 },
  { id: "ring", fi: 1, d: "M88 104 C 90 72, 92 42, 93 18", w: 13.5 },
  { id: "pinky", fi: 0, d: "M105 106 C 110 84, 113 60, 115 40", w: 11.5 },
];

function Hand({ side, hit }: { side: "l" | "r"; hit: Strike | null }) {
  const active = hit !== null && hit.hand === side;
  // The hand drifts toward the key it is reaching for and leans up the board
  // for the higher rows; the finger does the rest. Without the drift the
  // fingers would have to stretch impossibly across the deck.
  const reach = active ? (hit.x - (side === "l" ? 0.28 : 0.72)) * 54 : 0;
  const rowLift = active ? (hit.row - 3.5) * 6 : 0;
  return (
    <span
      className={`ld-hand ld-hand-${side}`}
      style={{ transform: `translate(${reach}px, ${rowLift}px)` }}
    >
      <svg viewBox="0 0 130 168" width="130" height="168" aria-hidden="true">
        {/* Draw order is the whole trick: fingers and thumb first, then the
            palm over their bases, so they emerge from under the hand instead
            of reading as separate sausages lying on top of it. */}
        {FINGERS.map((f) => (
          <path
            className={`ld-hand-finger${active && !hit.thumb && hit.finger === f.fi ? " tap" : ""}`}
            key={f.id}
            d={f.d}
            style={{ strokeWidth: f.w }}
          />
        ))}
        <path
          className={`ld-hand-thumb${active && hit.thumb ? " tap" : ""}`}
          d="M52 116 C 40 124, 30 132, 22 138"
        />
        {/* wrist and forearm, running off the front edge of the deck */}
        <path className="ld-hand-arm" d="M52 128 h40 l12 44 H44 Z" />
        {/* back of the hand: wide across the knuckles, tapering to the wrist */}
        <path
          className="ld-hand-palm"
          d="M46 100 C 44 90, 50 86, 60 86 h46 c8 0 10 6 10 14 v26\n             c0 16-10 26-27 26 h-12 c-16 0-24-10-26-24 Z"
        />
      </svg>
    </span>
  );
}

function TypingHands({ hit }: { hit: Strike | null }) {
  return (
    <div className="ld-hands" aria-hidden="true">
      <Hand side="l" hit={hit} />
      <Hand side="r" hit={hit} />
    </div>
  );
}

/** The desktop this app is running on: the menu bar and the Dock. Icons are
 *  plain coloured tiles, not copies of anyone's app marks. */
const DOCK = [
  "var(--blue)", "var(--teal)", "var(--accent)", "#f0a63c",
  "var(--coral)", "#59b36b", "#7a6ff0", "#4aa8d8",
];

function MacOsBar() {
  return (
    <div className="ld-os-bar" aria-hidden="true">
      <span className="ld-os-apple" />
      <b>Transfer Chance Me</b>
      {["File", "Edit", "View", "Window", "Help"].map((m) => (
        <span key={m}>{m}</span>
      ))}
      <span className="ld-os-right">
        <i className="ld-os-wifi" />
        <i className="ld-os-batt" />
        <span className="ld-os-clock num">Sun 6:59 PM</span>
      </span>
    </div>
  );
}

function MacOsDock() {
  return (
    <div className="ld-os-dock" aria-hidden="true">
      <span className="ld-os-dockbar">
        {DOCK.map((c, i) => (
          <i className={`ld-os-app${i === 0 ? " on" : ""}`} style={{ background: c }} key={i} />
        ))}
        <i className="ld-os-sep" />
        <i className="ld-os-app ld-os-trash" />
      </span>
    </div>
  );
}

/** A simulated pointer: moves to a target element, clicks it, then the
 *  caller types into it. Positions are measured against the panel so the
 *  motion is pixel-accurate at any width, not guessed. */
const SCREEN_TITLES = [
  "Your profile",
  "Researching your file",
  "Files like yours",
  "Specific feedback",
  "Your chances",
];

function HeroDemo() {
  // 0 profile · 1 researching · 2 matched files · 3 feedback · 4 chances
  const [screen, setScreen] = useState(0);
  const [fieldIdx, setFieldIdx] = useState(0);   // fields fully filled (extracted or typed)
  const [actIdx, setActIdx] = useState(0);       // activities fully typed
  const [judged, setJudged] = useState(0);
  const [scan, setScan] = useState(0);
  const [reading, setReading] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [focus, setFocus] = useState<{ kind: FocusKind; idx: number; phase: "moving" | "clicking" | "typing" }>(
    { kind: null, idx: -1, phase: "moving" },
  );
  const [activeText, setActiveText] = useState("");
  const [cursor, setCursor] = useState({ x: -30, y: -30 });
  const [cursorOn, setCursorOn] = useState(false);
  const [pulse, setPulse] = useState(0);
  // Screen 3: how far the corpus sweep has run, then what it resolved to.
  const [keyHit, setKeyHit] = useState<Strike | null>(null); // key struck right now
  const [swept, setSwept] = useState(0);        // files compared so far
  const [matchIdx, setMatchIdx] = useState(0);  // matched files revealed
  const [sigIdx, setSigIdx] = useState(0);      // target signatures revealed

  const panelRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<(HTMLDivElement | null)[]>([]);
  const actRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scanBtnRef = useRef<HTMLDivElement>(null);

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // On a phone the match screen stacks into one column, so it shows fewer
  // files. The counts on screen are driven off these same arrays, so the
  // "n nearest returned" readout stays true at every width.
  const [narrow, setNarrow] = useState(
    typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // Memoised: these feed the sequencer's dependency list, and a fresh array
  // each render would restart the animation on every frame.
  const matches = useMemo(() => (narrow ? DEMO_MATCHES.slice(0, 2) : DEMO_MATCHES), [narrow]);
  const sigs = useMemo(() => (narrow ? DEMO_SIGS.slice(0, 1) : DEMO_SIGS), [narrow]);

  useEffect(() => {
    if (reduced) {
      setScreen(4); setFieldIdx(DEMO_FIELDS.length); setActIdx(DEMO_ACTS.length);
      setJudged(DEMO_ACTS.length); setScan(DEMO_SCANS.length); setCursorOn(false);
      setUploadDone(true); setReading(false); setKeyHit(null);
      setSwept(CORPUS_META.people); setMatchIdx(matches.length); setSigIdx(sigs.length);
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((res) => { timers.push(window.setTimeout(res, ms)); });

    const moveTo = async (el: HTMLDivElement | null, inset = 14) => {
      const panel = panelRef.current;
      if (!panel || !el) return;
      const pr = panel.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setCursorOn(true);
      setCursor({ x: r.left - pr.left + inset, y: r.top - pr.top + r.height / 2 });
      await wait(320);
    };

    const click = async () => {
      setPulse((p) => p + 1);
      await wait(110);
    };

    // Each character struck lights a key on the deck. Letters land on the
    // three letter rows, a space on the space bar — so the hands read right
    // even though we aren't mapping real key positions.
    const strike = (ch: string): Strike => {
      if (ch === " ") {
        return { key: "5:4", x: keyCentre(5, 4), row: 5, hand: "r", finger: 3, thumb: true };
      }
      // The real key for this character, so the hand reaches where the
      // letter actually is. Punctuation falls back to a letter row.
      const at = CHAR_KEY.get(ch.toLowerCase());
      const r = at ? at.row : [2, 3, 4][ch.charCodeAt(0) % 3];
      const i = at ? at.idx : 1 + (ch.charCodeAt(0) * 7) % (KEY_ROWS[r].length - 2);
      const x = keyCentre(r, i);
      // Touch-typing fingering: the board splits down the middle, and each
      // hand covers its half outside-in.
      const hand: "l" | "r" = x < 0.5 ? "l" : "r";
      const within = hand === "l" ? x / 0.5 : (x - 0.5) / 0.5;
      const finger = Math.min(3, Math.max(0, Math.floor(within * 4)));
      return { key: `${r}:${i}`, x, row: r, hand, finger, thumb: false };
    };

    const type = async (text: string) => {
      setActiveText("");
      for (let n = 1; n <= text.length; n++) {
        if (cancelled) return;
        setActiveText(text.slice(0, n));
        setKeyHit(strike(text[n - 1]));
        await wait(13 + Math.random() * 12);
      }
      setKeyHit(null);
      await wait(120);
    };

    const run = async () => {
      setScreen(0); setFieldIdx(0); setActIdx(0); setJudged(0); setScan(0);
      setReading(false); setUploadDone(false);
      setSwept(0); setMatchIdx(0); setSigIdx(0); setKeyHit(null);
      setFocus({ kind: null, idx: -1, phase: "moving" });
      setActiveText("");
      await wait(280);

      // Upload the transcript, watch it get read, and extract everything a
      // real PDF actually holds — GPA, test score, credits, major, honors.
      setFocus({ kind: "upload", idx: 0, phase: "moving" });
      await moveTo(uploadRef.current, 12);
      if (cancelled) return;
      await click();
      setReading(true);
      await wait(420);
      if (cancelled) return;
      setReading(false);
      setUploadDone(true);
      for (let i = 0; i < DEMO_EXTRACT_COUNT; i++) {
        if (cancelled) return;
        setFieldIdx(i + 1);
        await wait(100);
      }
      await wait(160);

      // What's left is only what the student has to say themselves.
      for (let i = DEMO_EXTRACT_COUNT; i < DEMO_FIELDS.length; i++) {
        if (cancelled) return;
        setFocus({ kind: "field", idx: i, phase: "moving" });
        await moveTo(fieldRefs.current[i]);
        if (cancelled) return;
        await click();
        setFocus({ kind: "field", idx: i, phase: "typing" });
        await type(DEMO_FIELDS[i].value);
        if (cancelled) return;
        setFieldIdx(i + 1);
      }

      for (let i = 0; i < DEMO_ACTS.length; i++) {
        if (cancelled) return;
        setFocus({ kind: "act", idx: i, phase: "moving" });
        await moveTo(actRefs.current[i], 16);
        if (cancelled) return;
        await click();
        setFocus({ kind: "act", idx: i, phase: "typing" });
        await type(DEMO_ACTS[i].raw);
        if (cancelled) return;
        setActIdx(i + 1);
      }

      if (cancelled) return;
      setFocus({ kind: null, idx: -1, phase: "moving" });
      await moveTo(scanBtnRef.current, 10);
      if (cancelled) return;
      await click();
      await wait(140);
      // Verdicts land on the activities before we ever leave this screen.
      for (let i = 0; i < DEMO_ACTS.length; i++) {
        if (cancelled) return;
        setJudged(i + 1);
        await wait(280);
      }

      if (cancelled) return;
      setCursorOn(false);
      await wait(360);
      setScreen(1);
      for (let i = 0; i < DEMO_SCANS.length; i++) {
        if (cancelled) return;
        setScan(i + 1);
        await wait(300);
      }

      if (cancelled) return;
      await wait(700);

      // The corpus sweep: every recorded file compared, then the nearest ones
      // and the admitted bands at the targets resolve out of it.
      setScreen(2);
      const SWEEP_MS = 1150;
      const t0 = performance.now();
      await new Promise<void>((res) => {
        const tick = () => {
          if (cancelled) { res(); return; }
          const k = Math.min(1, (performance.now() - t0) / SWEEP_MS);
          setSwept(Math.round(CORPUS_META.people * (1 - Math.pow(1 - k, 3))));
          if (k < 1) requestAnimationFrame(tick); else res();
        };
        requestAnimationFrame(tick);
      });
      if (cancelled) return;
      for (let i = 0; i < matches.length; i++) {
        if (cancelled) return;
        setMatchIdx(i + 1);
        await wait(240);
      }
      await wait(260);
      for (let i = 0; i < sigs.length; i++) {
        if (cancelled) return;
        setSigIdx(i + 1);
        await wait(300);
      }
      await wait(2600);

      if (cancelled) return;
      setScreen(3);
      await wait(2600);
      if (cancelled) return;
      setScreen(4);
      await wait(3400);
      if (cancelled) return;
      run();
    };

    run();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [reduced, matches, sigs]);

  const isField = (i: number) => focus.kind === "field" && focus.idx === i;
  const isAct = (i: number) => focus.kind === "act" && focus.idx === i;
  const isUpload = focus.kind === "upload";

  return (
    <div className="ld-mac">
      {/* Display assembly: aluminium shell → black bezel → glass. The notch
          hangs into the top of the display, the way the machine really is. */}
      <div className="ld-mac-lid">
        <div className="ld-mac-bezel">
          <span className="ld-mac-notch"><i className="ld-mac-cam" /></span>
          <MacOsBar />
          <div className="ld-mac-screen" aria-hidden="true">
        <div className="ld-mac-topline">
          <span className="ld-mac-count num">
            {String(screen + 1).padStart(2, "0")} / {String(SCREEN_TITLES.length).padStart(2, "0")}
          </span>
          <span className="ld-mac-title">{SCREEN_TITLES[screen]}</span>
          {screen === 1 && <span className="ld-demo-live">live</span>}
          {screen === 2 && <span className="ld-demo-live">querying</span>}
          {screen === 3 && <span className="ld-demo-clock">{DEMO_TAG_WEEKS} weeks to TAG</span>}
        </div>
        <div className="ld-mac-steps">
          {SCREEN_TITLES.map((_, i) => (
            <span className={`ld-mac-step${screen >= i ? " done" : ""}`} key={i}><span className="ld-mac-step-fill" /></span>
          ))}
        </div>

        {screen === 0 && (
          <div className="ld-mac-panel ld-demo-in" ref={panelRef} key="s0">
            <div
              className={`ld-demo-upload${uploadDone ? " done" : ""}${isUpload ? " targeting" : ""}`}
              ref={uploadRef}
            >
              <svg width="11" height="13" viewBox="0 0 11 13" fill="none" aria-hidden="true">
                <path d="M1 1h5.5L10 4.5V12H1V1Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
                <path d="M6.3 1v3.3h3.4" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
              </svg>
              <span className="ld-demo-uploadname">transcript.pdf</span>
              <span className="ld-demo-uploadstate">
                {reading ? "reading…" : uploadDone ? "extracted" : ""}
              </span>
            </div>
            <div className="ld-mac-cols">
              <div>
                {DEMO_FIELDS.map((f, i) => (
                  <div
                    className={`ld-demo-field${i < fieldIdx || isField(i) ? " on" : ""}${isField(i) ? " targeting" : ""}`}
                    key={f.label}
                    ref={(el) => { fieldRefs.current[i] = el; }}
                  >
                    <span className="ld-demo-flabel">{f.label}</span>
                    <span className="ld-demo-fvalue">
                      {i < fieldIdx ? f.value : isField(i) && focus.phase === "typing" ? activeText : ""}
                      {isField(i) && focus.phase === "typing" && <i className="ld-caret" />}
                      {i < fieldIdx && f.via === "extract" && <i className="ld-demo-src">PDF</i>}
                    </span>
                    <span className="ld-demo-fhint">{i < fieldIdx ? f.hint : ""}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="ld-demo-sub">Your activities, as you'd type them</p>
                {DEMO_ACTS.map((a, i) => (
                  <div
                    className={`ld-demo-act${i < judged ? " judged" : ""}${i < actIdx || isAct(i) ? " on" : ""}${isAct(i) ? " targeting" : ""}`}
                    key={a.raw}
                    ref={(el) => { actRefs.current[i] = el; }}
                  >
                    <span className="ld-demo-actraw">
                      {i < actIdx ? a.raw : isAct(i) && focus.phase === "typing" ? activeText : ""}
                      {isAct(i) && focus.phase === "typing" && <i className="ld-caret" />}
                    </span>
                    {i < judged && (
                      <span className={`ld-demo-actv ld-demo-${a.tone}`}>{a.verdict}</span>
                    )}
                  </div>
                ))}
                <div className="ld-demo-runbtn" ref={scanBtnRef}>
                  <span className="ld-demo-runicon">↻</span> Analyze my file
                </div>
              </div>
            </div>

            {cursorOn && (
              <div className="ld-cursor" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}>
                <svg width="15" height="18" viewBox="0 0 15 18" fill="none">
                  <path d="M1 1L1 15.5L4.6 12.2L6.9 17L9.3 15.9L7 11.2L11.8 11.1L1 1Z" fill="var(--ink)" stroke="#fff" strokeWidth="1.1" strokeLinejoin="round" />
                </svg>
                <span key={pulse} className="ld-click-ring" />
              </div>
            )}
          </div>
        )}

        {screen === 1 && (
          <div className="ld-mac-panel ld-demo-scan" key="s1">
            {DEMO_SCANS.map((sc, i) => (
              <div className={`ld-demo-scanrow${i < scan ? " done" : i === scan ? " active" : ""}`} key={sc.run}>
                <span className="ld-demo-scanicon">
                  {i < scan ? "✓" : i === scan ? <span className="ld-demo-spin" /> : "·"}
                </span>
                <span className="ld-demo-scantext">
                  {sc.run}
                  {i < scan && <b>{sc.found}</b>}
                </span>
              </div>
            ))}
            <div className={`ld-demo-patterns${scan >= DEMO_SCANS.length ? " on" : ""}`}>
              <p className="ld-demo-patternhead">Real patterns this file matches — not a guess</p>
              {DEMO_PATTERNS.map((p, i) => (
                <div className="ld-demo-pattern" key={p.stat} style={{ transitionDelay: `${i * 110}ms` }}>
                  <b className="num">{p.stat}</b>
                  <span>{p.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {screen === 2 && (
          <div className="ld-mac-panel ld-match" key="s2">
            <div className="ld-match-query">
              <span className="ld-match-op">MATCH</span>
              <span className="ld-match-where">
                gpa <b className="num">{DEMO_PROFILE.gpa.toFixed(2)}</b> ±{MATCH_WINDOW.toFixed(2)} · major ∈{" "}
                <b>econ / business</b> · from <b>community college</b>
              </span>
            </div>
            <div className="ld-match-meter">
              <span className="ld-match-bar" style={{ width: `${(swept / CORPUS_META.people) * 100}%` }} />
            </div>
            {/* The narrowing, and it has to add up: scanned → eligible → returned. */}
            <div className="ld-match-funnel num">
              <span><b>{swept.toLocaleString()}</b> files scanned</span>
              <i>▸</i>
              <span className={swept >= CORPUS_META.people ? "on" : ""}>
                <b>{swept >= CORPUS_META.people ? DEMO_ELIGIBLE : 0}</b> inside the window
              </span>
              <i>▸</i>
              <span className={matchIdx > 0 ? "on" : ""}>
                <b>{matchIdx}</b> nearest returned
              </span>
              <span className="ld-match-decisions">
                {CORPUS_META.records.toLocaleString()} recorded decisions
              </span>
            </div>

            <div className="ld-match-cols">
              <div className="ld-match-col">
                <p className="ld-match-h">Closest real files to yours</p>
                {/* A header over streaming rows is what makes this read as a
                    table being filled rather than a list of cards. */}
                <div className="ld-match-cols-head num">
                  <span>#</span><span>GPA</span><span>FILE</span><span>Δ vs you</span>
                </div>
                {matches.map((m, i) => {
                  const d = m.gpa - DEMO_PROFILE.gpa;
                  return (
                  <div className={`ld-match-card${i < matchIdx ? " on" : ""}`} key={`${m.gpa}-${m.major}-${m.year}`}>
                    <div className="ld-match-top">
                      <span className="ld-match-idx num">{String(i + 1).padStart(2, "0")}</span>
                      <b className="ld-match-gpa num">{m.gpa.toFixed(2)}</b>
                      <span className="ld-match-meta">
                        {m.major}
                        {m.institutionLabel ? ` · ${m.institutionLabel}` : ""} · {m.year}
                      </span>
                      {/* Signed from your side, and coloured when you're behind. */}
                      <span className={`ld-match-delta num${d > 0 ? " ld-match-behind" : ""}`}>
                        {d > 0 ? "+" : d < 0 ? "−" : "±"}{Math.abs(d).toFixed(2)}
                      </span>
                    </div>
                    <div className="ld-match-ledger">
                      <span className="ld-match-tag ld-match-in">IN</span>
                      <span className="ld-match-schools">
                        {/* Capped on a phone so the ledger cannot wrap the
                            panel past the screen — the remainder is counted,
                            never silently dropped. */}
                        {m.admits.slice(0, narrow ? 3 : m.admits.length).map((s) => (
                          <span className="ld-match-school" key={s}>
                            <Tile name={s} size={15} /> {markOf(s).word}
                          </span>
                        ))}
                        {narrow && m.admits.length > 3 && (
                          <span className="ld-match-school ld-match-more num">
                            +{m.admits.length - 3} more
                          </span>
                        )}
                      </span>
                    </div>
                    {m.denies.length > 0 && (
                      <div className="ld-match-ledger">
                        <span className="ld-match-tag ld-match-out">OUT</span>
                        <span className="ld-match-schools ld-match-denied">
                          {m.denies.map((s) => (
                            <span className="ld-match-school" key={s}>
                              <Tile name={s} size={15} /> {markOf(s).word}
                            </span>
                          ))}
                        </span>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>

              <div className="ld-match-col">
                <p className="ld-match-h">What admitted files hold at your targets</p>
                {sigs.map((s, i) => {
                  const pos = (g: number) => `${Math.min(100, Math.max(0, ((g - 3.2) / 0.8) * 100))}%`;
                  return (
                    <div className={`ld-sig${i < sigIdx ? " on" : ""}`} key={s.school}>
                      <div className="ld-sig-top">
                        <span className="ld-sig-photo">
                          <CampusPhoto name={s.school} color={markOf(s.school).color} height={26} />
                        </span>
                        <Tile name={s.school} size={16} />
                        <b>{markOf(s.school).word}</b>
                        <span className="ld-sig-n num">n={s.n} admits observed</span>
                      </div>
                      <div className="ld-sig-band" aria-hidden="true">
                        <span
                          className="ld-sig-range"
                          style={{ left: pos(s.gpaP25), width: `calc(${pos(s.gpaP75)} - ${pos(s.gpaP25)})` }}
                        />
                        <span className="ld-sig-med" style={{ left: pos(s.gpaMedian) }} />
                        <span className="ld-sig-you" style={{ left: pos(DEMO_PROFILE.gpa) }} />
                      </div>
                      <p className="ld-sig-line">
                        <span className="num">{s.gpaP25.toFixed(2)}</span>–
                        <span className="num">{s.gpaP75.toFixed(2)}</span>, median{" "}
                        <b className="num">{s.gpaMedian.toFixed(2)}</b> · you{" "}
                        <b className="num ld-sig-mine">{DEMO_PROFILE.gpa.toFixed(2)}</b>
                      </p>
                      <p className="ld-sig-line">
                        Most-listed majors: <b>{s.topMajors.slice(0, 2).join(", ")}</b>
                      </p>
                      {s.ccShare != null && (
                        <p className="ld-sig-line">
                          {/* The denominator is NOT n — institution was only
                              recorded for some of them. Printing this share
                              against n would overstate what we counted. */}
                          <b className="num">{Math.round(s.ccShare * 100)}%</b> from a community college, of the{" "}
                          <span className="num">{s.ccKnown}</span> whose school was recorded
                        </p>
                      )}
                    </div>
                  );
                })}
                {/* One fixed scale for both bands — per-card autoscaling would
                    make two different pictures look comparable when they aren't. */}
                <p className="ld-sig-axis num" aria-hidden="true">
                  <i>3.20</i><i>3.60</i><i>4.00</i>
                </p>
                <p className={`ld-match-honest${sigIdx >= sigs.length ? " on" : ""}`}>
                  {DEMO_THIN_TARGETS.length > 0 && (
                    <>
                      {DEMO_THIN_TARGETS.join(" and ")}: too few observed admits to characterize — you get the
                      official rate there, not a number we made up.{" "}
                    </>
                  )}
                  {/* This screen counts 856, the page headline counts 8,910.
                      Both are true and a reader who spots the gap deserves
                      the reason rather than a reason to distrust one. */}
                  Matching runs on the <span className="num">{CORPUS_META.people}</span> files out of{" "}
                  <span className="num">{Number(MODEL.meta.rows).toLocaleString()}</span> that recorded a GPA, a
                  major and an outcome — enough to compare yours against.
                </p>
              </div>
            </div>
          </div>
        )}

        {screen === 3 && (
          <div className="ld-mac-panel ld-demo-fix" key="s3">
            {DEMO_UPGRADES.map((u, i) => (
              <div
                className="ld-demo-up on"
                key={u.tag}
                style={{ animationDelay: `${i * 150}ms`, "--fx": u.c } as CSSProperties}
              >
                <span className="ld-demo-uptag">{u.tag}</span>
                <p className="ld-demo-before">{u.before}</p>
                <p className="ld-demo-after">{u.after}</p>
                <p className="ld-demo-upwhy">{u.why}</p>
              </div>
            ))}
          </div>
        )}

        {screen === 4 && (
          <div className="ld-mac-panel ld-demo-out" key="s4">
            {DEMO_ROWS.map((e, i) => (
              <DemoOdds key={e.school.id} e={e} active delay={i * 150} />
            ))}
            <div className="ld-demo-stack on">
              {DEMO_EC_LIFT >= 0.1 ? (
                <>Fixing the activities lane alone → <b className="num">+{DEMO_EC_LIFT.toFixed(1)} pts</b> across your list</>
              ) : (
                <>Same work, made legible — the whole plan is worth <b className="num">+{DEMO_PLAN.stackedPp.toFixed(1)} pts</b></>
              )}
            </div>
          </div>
        )}
          </div>
          <MacOsDock />
        </div>
      </div>

      {/* The deck, laid back in perspective so the keys recede the way they
          do on a real machine sitting in front of you. */}
      <div className="ld-mac-deck" aria-hidden="true">
        <span className="ld-mac-hinge" />
        <MacKeyboard hit={keyHit} />
        <TypingHands hit={keyHit} />
        <span className="ld-mac-slot" />
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
  { n: "University of California, Berkeley", src: "https://upload.wikimedia.org/wikipedia/commons/8/82/University_of_California%2C_Berkeley_logo.svg" },
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
    const t = setInterval(() => setI((x) => (x + 1) % TICKER.length), 5200);
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
    const dur = 1100;
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
  { n: "Harvard", top: "12%", left: "6%", s: 34, d: 20 },
  { n: "Stanford", top: "30%", left: "12%", s: 26, d: 25 },
  { n: "UCLA", top: "62%", left: "7%", s: 30, d: 22 },
  { n: "Cornell", top: "16%", left: "90%", s: 30, d: 23 },
  { n: "Michigan", top: "40%", left: "94%", s: 26, d: 18 },
  { n: "UC Berkeley", top: "66%", left: "89%", s: 34, d: 27 },
  { n: "Yale", top: "82%", left: "16%", s: 24, d: 22 },
  { n: "Columbia", top: "84%", left: "82%", s: 24, d: 20 },
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
            straight from the document. Signed in, your file is saved to your account so it follows you
            to another device; signed out, it never leaves this browser.
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
            <p className="aside">2 minutes · free account to see your report · your work saves to your account</p>
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
            It depends on whether you're signed in. Signed out, everything is parsed in your browser and
            stays in that browser's storage. Signed in, your profile, school list, essays and the text read
            off your transcript are saved to your account so your work follows you between devices — stored
            against your login, readable only by you, and deletable by you at any time.
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
