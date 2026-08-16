import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { MODEL } from "../engine";
import { markOf } from "../lib/schools";
import { useReveal } from "../hooks/useReveal";
import { countdown } from "../lib/deadlines";
import GpaStrip from "./GpaStrip";
import Tile from "./Tile";
import "./landing.css";

// Marketing page in the minimal-SaaS format: centered hero with a real data
// visual, authority strip, clickable school wall, alternating feature sections
// with product visuals, findings from the study, numbers band, FAQ, closing
// CTA. All visuals are ours, drawn from the dataset.

const LADDER = [
  "UNC", "Michigan", "Vanderbilt", "Notre Dame", "UC Berkeley", "UCLA",
  "Northwestern", "Cornell", "Columbia", "UPenn", "Stanford", "Yale", "Harvard",
];

/** Hero visual: a layered composite of the product itself — chances rows,
 *  an essay-review note, and a live deadline countdown. */
function HeroStage() {
  const uc = countdown("UC Berkeley");
  const rows = [
    { name: "Michigan", band: "26–50%", tier: "Strong target", cls: "ok" },
    { name: "Cornell", band: "11–21%", tier: "Target", cls: "mid" },
    { name: "Stanford", band: "2.6–5%", tier: "High reach", cls: "low" },
  ];
  return (
    <div className="ld-stage" aria-hidden="true">
      <div className="ld-stage-card ld-stage-chances">
        <p className="mock-label">Your chances</p>
        {rows.map((r) => (
          <div className="ld-stage-row" key={r.name}>
            <Tile name={r.name} size={22} />
            <span className="ld-stage-name">{r.name}</span>
            <span className={`ld-stage-band ld-${r.cls} num`}>{r.band}</span>
            <span className="ld-stage-tier">{r.tier}</span>
          </div>
        ))}
      </div>
      <div className="ld-stage-card ld-stage-essay">
        <p className="mock-label">Essay review</p>
        <p className="ld-stage-quote">"I've always dreamed of attending a school with more opportunities…"</p>
        <p className="ld-stage-issue">Reads as escape, not fit — admits name the program.</p>
        <p className="ld-stage-fix">Fix: name Dyson's food-economics track and the professor whose lab you'd join.</p>
      </div>
      {uc && (
        <div className="ld-stage-card ld-stage-clock">
          <p className="mock-label">Deadline</p>
          <p className="ld-stage-days num">{uc.days}</p>
          <p className="ld-stage-clock-sub">days until the UC window closes ({uc.label})</p>
        </div>
      )}
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
                style={{ width: `${(s.rate / max) * 100}%`, animationDelay: `${250 + i * 70}ms` }}
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

const AUTHORITY_SCHOOLS = ["Cornell", "Duke", "Chicago", "Stanford"];

function FeatureStrip() {
  const cornell = MODEL.schools.find((s) => s.name === "Cornell")!;
  return (
    <section className="features" id="how">
      <h2>Nothing here is a vibe</h2>
      <p className="sec-dek">Every number traces to a source you can check.</p>

      <div className="feature ld-feature reveal">
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

      <div className="feature ld-feature reveal">
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

      <div className="feature ld-feature reveal">
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
    figure: "±0",
    unit: "edge",
    color: "var(--accent)",
    title: "Extracurriculars don't move the needle",
    body: "Across 1,217 structured applicant profiles, extracurricular strength showed no admit advantage once college GPA is held constant.",
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
    <section className="shell ld-findings" aria-labelledby="ld-findings-h">
      <h2 id="ld-findings-h">What the data says</h2>
      <p className="ld-sec-dek">Findings from {rows} recorded outcomes — some of them surprising.</p>
      <div className="ld-findgrid">
        {FINDINGS.map((f, i) => (
          <div key={f.title} className="reveal" style={{ transitionDelay: `${i * 90}ms` }}>
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
  return (
    <main>
      <div className="ld-herowrap">
        <div className="ld-orbs" aria-hidden="true">
          <span className="ld-orb ld-orb-a" />
          <span className="ld-orb ld-orb-b" />
          <span className="ld-orb ld-orb-c" />
          <span className="ld-orb ld-orb-d" />
        </div>
        <section className="shell hero">
          <span className="badge">Built on {rows} real transfer outcomes · 2011–2026</span>
          <h1>Your real chances of transferring into the T25</h1>
          <p className="dek">
            We weigh your GPA, school, and story against official admit rates and the admitted-student
            data behind every top-25 university — not forum guesses.
          </p>
          <div className="cta-row">
            <button type="button" className="btn" onClick={onStart}>Check my chances</button>
            <p className="aside">Free · takes 2 minutes · nothing leaves your browser</p>
          </div>
          <div className="ld-authority">
            <span className="ld-authority-tiles" aria-hidden="true">
              {AUTHORITY_SCHOOLS.map((n) => <Tile key={n} name={n} size={22} />)}
            </span>
            <span>Built by transfer students at Ivy League schools, Duke, UChicago &amp; Stanford</span>
            <span className="ld-authority-sep" aria-hidden="true">·</span>
            <span><b>{rows}</b> real applications analyzed</span>
          </div>
          <HeroStage />
        </section>
      </div>

      <section className="ld-wall reveal" aria-label="Schools covered">
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

      <div className="shell"><FeatureStrip /></div>

      <section className="shell ld-field reveal" aria-label="Official admit rates">
        <h2 className="ld-field-h">The field, measured</h2>
        <p className="sec-dek">Official transfer admit rates across the T25 — the spread is enormous.</p>
        <RateLadder />
      </section>

      <Findings rows={rows} />

      <section className="numbers">
        <div className="shell factline">
          <span><b><CountUp value={Number(MODEL.meta.rows)} /></b> recorded outcomes</span>
          <span><b><CountUp value={Number(MODEL.meta.admits)} /></b> observed admits</span>
          <span><b><CountUp value={Number(MODEL.meta.schools)} duration={900} /></b> top-25 universities</span>
          <span><b><CountUp value={15} duration={900} /></b> application cycles</span>
        </div>
      </section>

      <section className="shell faq">
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
            They're honest estimates, not decisions. Self-reported outcomes over-represent acceptances, so
            baselines stay anchored to official rates, ranges are shown instead of fake-precise numbers, and
            small samples are flagged where they're small.
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
          <summary>Why do extracurriculars barely move my number?</summary>
          <p>
            Because the data says so: across 1,217 structured applicant profiles, extracurricular strength
            shows no admit advantage once GPA is held constant. Transfer admission is GPA-dominated — we'd
            rather tell you the truth than flatter your résumé.
          </p>
        </details>
      </section>

      <section className="closing">
        <div className="shell">
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
