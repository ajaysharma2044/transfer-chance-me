import { useMemo, useState } from "react";
import { estimateAll, fmtPct, MODEL } from "../engine";
import type { Estimate, Profile, Tier } from "../engine";
import GpaStrip from "./GpaStrip";

const TIER_CLASS: Record<Tier, string> = {
  Likely: "tier-likely",
  "Strong target": "tier-strong",
  Target: "tier-target",
  Reach: "tier-reach",
  "High reach": "tier-high",
  "Long shot": "tier-long",
};

function reading(profile: Profile, ests: Estimate[]): React.ReactNode {
  const best = ests[0];
  const targets = ests.filter((e) => e.p >= 0.12);
  const lever =
    profile.essay === "draft"
      ? "Your biggest open lever is the essay you haven't written — a school-specific 'why transfer' is the factor admits credit most."
      : profile.essay === "general"
      ? "Your biggest open lever: make the essay school-specific. Naming programs and professors is the differentiator admits credit most."
      : "Your file already plays the strongest card in the data — a school-specific case.";
  return (
    <>
      Your strongest position is <strong>{best.school.name}</strong> at{" "}
      <strong>{fmtPct(best.lo)}–{fmtPct(best.hi)}%</strong>.{" "}
      {targets.length > 0
        ? <>You have target odds or better at <strong>{targets.length} of {ests.length}</strong> schools.</>
        : <>Every school on the list reads as a reach or longer from here — the breakdown below shows which doors move first.</>}{" "}
      {lever}
    </>
  );
}

export default function Results({ profile, onRevise }: { profile: Profile; onRevise: () => void }) {
  const ests = useMemo(() => estimateAll(profile), [profile]);
  const [open, setOpen] = useState<string | null>(null);

  const tally = useMemo(() => {
    const m = new Map<Tier, number>();
    for (const e of ests) m.set(e.tier, (m.get(e.tier) ?? 0) + 1);
    return ([...m.entries()] as [Tier, number][]);
  }, [ests]);

  return (
    <div className="shell results">
      <header className="verdict">
        <h2>Your chances, school by school</h2>
        <p className="reading">{reading(profile, ests)}</p>
        <div className="tier-tally">
          {tally.map(([t, n]) => (
            <span key={t}><b>{n}</b>{t.toLowerCase()}</span>
          ))}
        </div>
        <div className="results-actions">
          <button type="button" className="btn-quiet" onClick={onRevise}>← Edit my profile</button>
        </div>
      </header>

      <div className="ledger-head" aria-hidden="true">
        <span>School</span>
        <span className="r">Admit rate</span>
        <span>Admitted GPA range · your mark</span>
        <span className="r">Your chances</span>
      </div>

      <ol style={{ listStyle: "none" }}>
        {ests.map((e) => (
          <li className="row" key={e.school.id}>
            <button
              type="button"
              className="row-main"
              aria-expanded={open === e.school.id}
              onClick={() => setOpen(open === e.school.id ? null : e.school.id)}
            >
              <span className="school">
                <span className="nm">{e.school.name}</span>
                <div className="meta">
                  {e.school.nAdmits} observed admits{e.thin ? " · small GPA sample" : ""}
                </div>
              </span>
              <span className="base">
                {e.school.rate.toFixed(1)}%
                <span className="cap">{e.school.applicants ? `${e.school.applicants.toLocaleString()} applied` : "official"}</span>
              </span>
              <GpaStrip school={e.school} gpa={profile.gpa} />
              <span className="odds">
                <span className="band">{fmtPct(e.lo)}–{fmtPct(e.hi)}%</span>
                <span className={`tier ${TIER_CLASS[e.tier]}`}>{e.tier}</span>
              </span>
            </button>

            {open === e.school.id && (
              <div className="row-detail">
                <div>
                  {e.school.counsel && (
                    <>
                      <h4>Who actually gets in</h4>
                      <p className="typical">{e.school.counsel.typical}</p>
                      <h4>What moves your file</h4>
                      <ul>
                        {e.school.counsel.levers.map((l) => <li key={l}>{l}</li>)}
                        {e.school.counsel.watchouts.map((w) => <li className="warn" key={w}>{w}</li>)}
                      </ul>
                    </>
                  )}
                </div>
                <div>
                  <h4>How we scored you</h4>
                  <div className="drivers">
                    {e.drivers.map((d) => (
                      <div className="driver" key={d.text}>
                        <span className={`dir ${d.dir === "up" ? "up" : d.dir === "down" ? "down" : "flat"}`}>
                          {d.dir === "up" ? "+" : d.dir === "down" ? "−" : "·"}
                        </span>
                        <span>{d.text}</span>
                      </div>
                    ))}
                  </div>
                  <h4>On the record</h4>
                  <p className="facts">
                    Official: <b>{e.school.admitted?.toLocaleString() ?? "—"} of {e.school.applicants?.toLocaleString() ?? "—"}</b> admitted ({e.school.cycle || "latest CDS"})<br />
                    Admitted GPA: <b>{e.school.gpa.p25?.toFixed(2)} – {e.school.gpa.p50?.toFixed(2)} – {e.school.gpa.p75?.toFixed(2)}</b> (p25 · median · p75, n={e.school.nGpa})<br />
                    {e.school.majors.length > 0 && <>Common admit majors: <b>{e.school.majors.join(" · ").replace(/\(\d+\)/g, "").trim()}</b><br /></>}
                    {e.school.counsel?.feeders && <>Feeders: <b>{e.school.counsel.feeders}</b><br /></>}
                    {e.school.counsel?.programs?.length ? <>Named pathways: <b>{e.school.counsel.programs.join(" · ")}</b><br /></> : null}
                    {e.school.coadmit.length > 0 && <>Cross-admits share: <b>{e.school.coadmit.join(" · ").replace(/\(\d+\)/g, "").trim()}</b></>}
                  </p>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>

      <footer className="method">
        <h3>How these numbers are made</h3>
        <p>
          Each baseline is the school's official transfer admit rate from its Common Data Set (Section D) or UC
          admit data — not self-reported forum rates. Your range adjusts that baseline by where your GPA falls in
          the school's observed admitted-GPA distribution ({Number(MODEL.meta.rows).toLocaleString()} outcomes,
          {" "}{String(MODEL.meta.yearSpan)}), and by the factors those records show actually differentiate admits:
          feeder fit, standing, major, a school-specific essay, and veteran/comeback pipelines. Extracurricular
          strength is deliberately weighted near zero — across 1,217 structured profiles it shows no admit
          advantage once GPA is held constant.
        </p>
        <p>
          These are estimates for orientation, not decisions. Self-reported outcomes over-represent acceptances,
          which is why baselines stay anchored to official rates; small samples are flagged.
        </p>
      </footer>
    </div>
  );
}
