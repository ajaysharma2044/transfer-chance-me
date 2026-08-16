import { MODEL } from "../engine";
import type { School } from "../engine";
import { useReveal } from "../hooks/useReveal";
import { countdown } from "../lib/deadlines";
import { markOf } from "../lib/schools";
import Tile from "./Tile";
import CampusPhoto from "./CampusPhoto";
import PromptsPanel from "./PromptsPanel";
import "./schoolpage.css";
import "./college.css";

// Per-college profile page: official numbers, the observed admitted-GPA
// distribution, the admit-rate trend, and the school's counsel playbook.
// Everything shown comes from MODEL (CDS/UC official rates + dataset).

interface Props {
  name: string;
  onBack: () => void;
  onStart: () => void;
  onOpenSchool: (name: string) => void;
}

/** "Northwestern (36)" → "Northwestern"; "Economics(7)" → "Economics" */
const stripCount = (s: string) => s.replace(/\s*\(\d+\)\s*$/, "").trim();

/** Admitted-GPA histogram (20 bins, 3.0→4.0) with p25/median/p75 markers. */
function GpaHistogram({ s }: { s: School }) {
  const W = 560, H = 230, PAD = 12, TOP = 40, BASE = H - 28;
  const bins = s.hist.length;
  const binW = (W - 2 * PAD) / bins;
  const gx = (g: number) => PAD + (Math.min(4, Math.max(3, g)) - 3) * (W - 2 * PAD);

  // Merge percentile markers that land on (nearly) the same GPA so labels
  // don't overprint — common at the top schools where p50 = p75 = 4.0.
  const raw: { label: string; g: number }[] = [];
  if (s.gpa.p25 != null) raw.push({ label: "p25", g: s.gpa.p25 });
  if (s.gpa.p50 != null) raw.push({ label: "median", g: s.gpa.p50 });
  if (s.gpa.p75 != null) raw.push({ label: "p75", g: s.gpa.p75 });
  raw.sort((a, b) => a.g - b.g);
  const markers: { labels: string[]; g: number }[] = [];
  for (const m of raw) {
    const last = markers[markers.length - 1];
    if (last && Math.abs(m.g - last.g) < 0.03) last.labels.push(m.label);
    else markers.push({ labels: [m.label], g: m.g });
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Admitted-transfer GPA distribution at ${s.name}, from 3.0 to 4.0, with 25th percentile, median, and 75th percentile marked`}
    >
      {s.hist.map((v, i) => {
        const h = v * (BASE - TOP);
        return (
          <rect
            key={i}
            x={PAD + i * binW + 1.5}
            y={BASE - h}
            width={binW - 3}
            height={h}
            rx={2}
            fill="var(--accent)"
            opacity={0.28 + 0.62 * v}
          />
        );
      })}
      <line x1={PAD} y1={BASE} x2={W - PAD} y2={BASE} stroke="var(--line-strong)" />
      {[3.0, 3.25, 3.5, 3.75, 4.0].map((g) => (
        <g key={g}>
          <line x1={gx(g)} y1={BASE} x2={gx(g)} y2={BASE + 5} stroke="var(--line-strong)" />
          <text x={gx(g)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)">
            {g.toFixed(2)}
          </text>
        </g>
      ))}
      {markers.map((m) => {
        const x = gx(m.g);
        const anchor = x > W - 90 ? "end" : x < 90 ? "start" : "middle";
        return (
          <g key={m.labels.join()}>
            <line x1={x} y1={TOP - 12} x2={x} y2={BASE} stroke="var(--ink)" strokeWidth="1" strokeDasharray="3 3" opacity={0.55} />
            <text x={x} y={TOP - 20} textAnchor={anchor} fontSize="11" fontWeight={600} fill="var(--ink-2)">
              {m.labels.join(" · ")} {m.g.toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Official transfer admit rate over time (line chart). */
function TrendChart({ s }: { s: School }) {
  const data = s.trend;
  const W = 560, H = 230, L = 42, R = 14, TOP = 18, BASE = H - 30;
  const rates = data.map(([, r]) => r);
  const maxRate = Math.max(...rates);
  const step = maxRate <= 8 ? 2 : maxRate <= 20 ? 5 : 10;
  const yMax = Math.max(step, Math.ceil(maxRate / step) * step);
  const px = (i: number) => L + (i / (data.length - 1)) * (W - L - R);
  const py = (r: number) => BASE - (r / yMax) * (BASE - TOP);
  const path = data.map(([, r], i) => `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(r).toFixed(1)}`).join(" ");
  const grid: number[] = [];
  for (let v = 0; v <= yMax; v += step) grid.push(v);
  const labelEvery = data.length > 8 ? 2 : 1;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Official transfer admit rate at ${s.name} by year, from ${data[0][0]} to ${data[data.length - 1][0]}`}
    >
      {grid.map((v) => (
        <g key={v}>
          <line x1={L} y1={py(v)} x2={W - R} y2={py(v)} stroke={v === 0 ? "var(--line-strong)" : "var(--line)"} />
          <text x={L - 8} y={py(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
            {v}%
          </text>
        </g>
      ))}
      {data.map(([year], i) =>
        i % labelEvery === 0 || i === data.length - 1 ? (
          <text key={year} x={px(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)">
            {year}
          </text>
        ) : null,
      )}
      <path d={path} fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {data.map(([year, r], i) => (
        <circle key={year} cx={px(i)} cy={py(r)} r={i === data.length - 1 ? 4 : 2.5} fill="var(--blue)" />
      ))}
    </svg>
  );
}

export default function SchoolPage({ name, onBack, onStart, onOpenSchool }: Props) {
  useReveal([name]);
  const s = MODEL.schools.find((x) => x.name === name);
  if (!s) {
    return (
      <div className="shell sp">
        <p>School not found.</p>
        <button type="button" className="btn-quiet" onClick={onBack}>← Back</button>
      </div>
    );
  }

  const c = s.counsel;
  const cd = countdown(s.name);
  // Only link co-admits that have a page of their own in the model.
  const coadmits = s.coadmit
    .map(stripCount)
    .filter((n) => MODEL.schools.some((x) => x.name === n));
  const majors = s.majors.map(stripCount);
  const hasTrend = s.trend.length >= 3;
  const thin = s.nGpa < 15;

  return (
    <div className="shell sp">
      <div className="sp-back">
        <button type="button" className="btn-quiet" onClick={onBack}>← All schools</button>
      </div>

      <div className="sp-banner">
        <CampusPhoto name={s.name} color={markOf(s.name).color} height={230} />
      </div>

      <header className="sp-head">
        <Tile name={s.name} size={56} />
        <div>
          <h1>{s.name} transfer profile</h1>
          <p className="sp-sum">
            <b>{s.rate.toFixed(1)}%</b> official transfer admit rate
            {s.n > 0 ? (
              <> · built from <b>{s.n.toLocaleString()}</b> recorded applicant outcomes in our dataset</>
            ) : (
              <> · official UC admit data, {s.cycle.replace(" (UC admit data)", "")}</>
            )}
          </p>
        </div>
      </header>

      <div className="sp-stats">
        <div className="sp-stat">
          <b>{s.rate.toFixed(1)}%</b>
          <span className="sp-cap">official transfer admit rate</span>
        </div>
        <div className="sp-stat">
          <b>
            {s.applicants != null ? s.applicants.toLocaleString() : "—"} → {s.admitted != null ? s.admitted.toLocaleString() : "—"}
          </b>
          <span className="sp-cap">applied → admitted ({s.cycle || "latest CDS"})</span>
        </div>
        {s.nAdmits > 0 ? (
          <div className="sp-stat">
            <b>{s.nAdmits.toLocaleString()}</b>
            <span className="sp-cap">observed admits in the dataset</span>
          </div>
        ) : (
          <div className="sp-stat">
            <b style={{ color: "var(--teal)" }}>CA CC</b>
            <span className="sp-cap">{c?.feeders ?? "dominant transfer pathway"}</span>
          </div>
        )}
        {s.gpa.p50 != null && (
          <div className="sp-stat">
            <b>{s.gpa.p50.toFixed(2)}</b>
            <span className="sp-cap">admitted-GPA median (n={s.nGpa})</span>
          </div>
        )}
        {cd && (
          <div className="sp-stat">
            <b style={{ color: cd.days <= 45 ? "var(--coral)" : "var(--accent)" }}>{cd.days} days</b>
            <span className="sp-cap">until the typical deadline ({cd.label}{cd.note ? ` — ${cd.note}` : ""}) · verify on the school's site</span>
          </div>
        )}
      </div>

      {thin && s.nGpa > 0 && (
        <p className="sp-note">
          Small sample: only {s.nGpa} admitted GPAs observed here — treat the GPA distribution as
          directional, not definitive.
        </p>
      )}

      {(s.nGpa > 0 || hasTrend) && (
        <div className={`sp-charts reveal${s.nGpa > 0 && hasTrend ? "" : " sp-one"}`}>
          {s.nGpa > 0 && (
            <figure className="sp-card">
              <h2>Admitted GPA distribution</h2>
              <p className="sp-dek">
                Observed admitted transfers, 3.0–4.0 scale (n={s.nGpa})
              </p>
              <GpaHistogram s={s} />
            </figure>
          )}
          {hasTrend && (
            <figure className="sp-card">
              <h2>Transfer admit rate over time</h2>
              <p className="sp-dek">
                Official rate by cycle, {s.trend[0][0]}–{s.trend[s.trend.length - 1][0]}
              </p>
              <TrendChart s={s} />
            </figure>
          )}
        </div>
      )}

      {c && (
        <section className="sp-play reveal">
          <h2 className="sp-sec">The {s.name} playbook</h2>
          <div className="sp-play-grid">
            <div>
              <h3>Who actually gets in</h3>
              <p className="sp-typical">{c.typical}</p>
              {c.floor != null && (
                <p className="sp-floor">
                  Realistic GPA floor in observed admits: <b>{c.floor.toFixed(2)}</b>
                </p>
              )}
              <h3>What moves your file</h3>
              <ul>
                {c.levers.map((l) => <li key={l}>{l}</li>)}
                {c.watchouts.map((w) => <li className="sp-warn" key={w}>{w}</li>)}
              </ul>
            </div>
            <div>
              {c.feeders && (
                <>
                  <h3>Feeder schools</h3>
                  <p className="sp-feeders">{c.feeders}</p>
                </>
              )}
              {c.programs.length > 0 && (
                <>
                  <h3>Named pathways &amp; programs</h3>
                  <div className="chipset">
                    {c.programs.map((p) => <span key={p} className="chip">{p}</span>)}
                  </div>
                </>
              )}
              {majors.length > 0 && (
                <>
                  <h3>Common admit majors</h3>
                  <div className="chipset">
                    {majors.map((m) => <span key={m} className="chip">{m}</span>)}
                  </div>
                </>
              )}
              {coadmits.length > 0 && (
                <>
                  <h3>Applicants here also got into</h3>
                  <div className="chipset">
                    {coadmits.map((n) => (
                      <button key={n} type="button" className="sp-colink" onClick={() => onOpenSchool(n)}>
                        <Tile name={n} size={20} />
                        {n}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="reveal"><PromptsPanel school={s.name} /></div>

      <section className="sp-cta reveal">
        <h2>See where you stand at {s.name}</h2>
        <button type="button" className="btn" onClick={onStart}>Check my chances at {s.name}</button>
        <p className="sp-cta-note">
          Estimates anchor on {s.name}'s official Common Data Set / UC admit numbers, adjusted by
          where your GPA and profile sit among the {s.nAdmits.toLocaleString()} observed admits in
          our dataset. Orientation, not admissions advice.
        </p>
      </section>
    </div>
  );
}
