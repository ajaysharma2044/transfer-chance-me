import { MODEL } from "../engine";
import { markOf } from "../lib/schools";
import { useReveal } from "../hooks/useReveal";
import GpaStrip from "./GpaStrip";
import Tile from "./Tile";

// Marketing page in the minimal-SaaS format: centered hero with a real data
// visual, school strip, alternating feature sections with product visuals,
// numbers band, FAQ, closing CTA. All visuals are ours, drawn from the dataset.

const CURVE_SCHOOLS: { name: string; color: string }[] = [
  { name: "UCLA", color: "#2478e5" },
  { name: "Cornell", color: "#6c4be0" },
  { name: "Michigan", color: "#14b8a0" },
  { name: "Stanford", color: "#ee6352" },
];

/** Smooth admitted-GPA density curves (real histogram data, 3.0–4.0). */
function DistCurves() {
  const W = 860, H = 200, PAD = 8;
  const paths = CURVE_SCHOOLS.map(({ name, color }) => {
    const s = MODEL.schools.find((x) => x.name === name)!;
    // moving-average smoothing so the curves read as densities, not bar noise
    const sm = s.hist.map((_, i, a) => {
      const win = a.slice(Math.max(0, i - 1), i + 2);
      return win.reduce((x, y) => x + y, 0) / win.length;
    });
    const peak = Math.max(...sm);
    const pts = sm.map((v, i) => [
      PAD + (i / (sm.length - 1)) * (W - 2 * PAD),
      H - 24 - (v / peak) * (H - 56),
    ]);
    // Catmull-Rom → cubic bezier for a smooth curve
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
    }
    return { d, color, name };
  });
  return (
    <figure className="curves">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Admitted-transfer GPA distributions at UCLA, Cornell, Michigan, and Stanford, from 3.0 to 4.0">
        <line x1={PAD} y1={H - 24} x2={W - PAD} y2={H - 24} stroke="var(--line-strong)" />
        {[3.0, 3.25, 3.5, 3.75, 4.0].map((g) => {
          const x = PAD + ((g - 3.0) / 1.0) * (W - 2 * PAD);
          return (
            <g key={g}>
              <line x1={x} y1={H - 24} x2={x} y2={H - 19} stroke="var(--line-strong)" />
              <text x={x} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{g.toFixed(2)}</text>
            </g>
          );
        })}
        {paths.map((p, i) => (
          <g key={p.name}>
            <path className="curve-fill" style={{ animationDelay: `${400 + i * 180}ms` }} d={`${p.d} L ${W - PAD} ${H - 24} L ${PAD} ${H - 24} Z`} fill={p.color} />
            <path className="curve-line" style={{ animationDelay: `${i * 180}ms` }} pathLength={1} d={p.d} fill="none" stroke={p.color} strokeWidth="2.5" strokeLinecap="round" />
          </g>
        ))}
      </svg>
      <figcaption>
        {CURVE_SCHOOLS.map(({ name, color }) => (
          <span key={name}><i style={{ background: color }} />{name}</span>
        ))}
        <span className="cap-note">Admitted-transfer GPA, from the dataset</span>
      </figcaption>
    </figure>
  );
}

function FeatureStrip() {
  const cornell = MODEL.schools.find((s) => s.name === "Cornell")!;
  return (
    <section className="features" id="how">
      <h2>Nothing here is a vibe</h2>
      <p className="sec-dek">Every number traces to a source you can check.</p>

      <div className="feature reveal">
        <div className="f-copy">
          <h3>Your GPA against real admits</h3>
          <p>
            Each school shows the actual GPA range of its observed admitted transfers — 25th percentile,
            median, 75th — with your mark on the same scale. No mystery score, no black box.
          </p>
        </div>
        <div className="f-visual">
          <div className="mock">
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

      <div className="feature reveal">
        <div className="f-copy">
          <h3>Upload your actual application</h3>
          <p>
            Drop in a transcript or Common App PDF and we read the GPA, credits, courses, and credentials
            straight from the document. Parsed on your device — your file never leaves the browser.
          </p>
        </div>
        <div className="f-visual">
          <div className="mock">
            <p className="mock-label">Found in transcript.pdf</p>
            <div className="chipset">
              {["GPA 3.87", "52 credits → junior", "California CC", "Phi Theta Kappa", "IGETC", "Major: computer science"].map((c) => (
                <span key={c} className="chip">{c}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="feature reveal">
        <div className="f-copy">
          <h3>An essay check with ground truth</h3>
          <p>
            Admits' essays name programs, professors, and courses; complaint-shaped essays fail. Paste your
            "why transfer" draft and see which of your targets it actually speaks to — checked against what
            {" "}{Number(MODEL.meta.rows).toLocaleString()} recorded outcomes say works.
          </p>
        </div>
        <div className="f-visual">
          <div className="mock">
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

export default function Landing({ onStart, onOpenSchool }: { onStart: () => void; onOpenSchool: (name: string) => void }) {
  const rows = Number(MODEL.meta.rows).toLocaleString();
  void onOpenSchool;
  useReveal();
  return (
    <main>
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
        <DistCurves />
      </section>

      <section className="shell schoolstrip reveal" aria-label="Schools covered">
        <p className="strip-label">Measured against every T25</p>
        <div className="wordwall">
          {MODEL.schools.map((s) => (
            <span key={s.id} className="wordwall-item" style={{ color: markOf(s.name).color }}>
              <Tile name={s.name} size={20} />
              {markOf(s.name).word}
            </span>
          ))}
        </div>
      </section>

      <div className="shell"><FeatureStrip /></div>

      <section className="numbers">
        <div className="shell factline">
          <span><b>{rows}</b> recorded outcomes</span>
          <span><b>{Number(MODEL.meta.admits).toLocaleString()}</b> observed admits</span>
          <span><b>{String(MODEL.meta.schools)}</b> top-25 universities</span>
          <span><b>15</b> application cycles</span>
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
