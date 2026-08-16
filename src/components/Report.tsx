import { fmtPct, MODEL } from "../engine";
import type { Estimate, Profile } from "../engine";
import { analyzeEssay } from "../lib/essay";

// Print-only report: hidden on screen, becomes the whole document when the
// user hits "Download report" (window.print → save as PDF).

const KIND_LABEL = { cc: "Community college", public4: "4-year public", private4: "4-year private" };

export default function Report({ profile, ests, date }: { profile: Profile; ests: Estimate[]; date: string }) {
  const essay = profile.essayText ? analyzeEssay(profile.essayText) : null;
  const top = ests.slice(0, 8);
  return (
    <div className="report" aria-hidden="true">
      <header className="r-head">
        <div>
          <b>Transfer Chance Me</b> — application analysis
          <div className="r-sub">Generated {date} · {Number(MODEL.meta.rows).toLocaleString()} recorded outcomes · official CDS baselines</div>
        </div>
      </header>

      <section>
        <h2>Profile</h2>
        <table className="r-kv">
          <tbody>
            <tr><td>College GPA</td><td>{profile.gpa.toFixed(2)}{profile.gpaTrend !== "flat" ? ` (${profile.gpaTrend})` : ""}</td></tr>
            <tr><td>Current school</td><td>{profile.schoolName ?? KIND_LABEL[profile.institution]}{profile.caResident ? " (California)" : ""}</td></tr>
            <tr><td>Entering as</td><td>{profile.standing}</td></tr>
            <tr><td>Intended major</td><td>{profile.majorDetail || profile.major}</td></tr>
            {profile.transferReason && <tr><td>Transfer reason</td><td>{profile.transferReason}</td></tr>}
            {profile.courses.length > 0 && <tr><td>Coursework</td><td>{profile.courses.slice(0, 24).join(", ")}{profile.courses.length > 24 ? "…" : ""}</td></tr>}
            {profile.activitiesText && <tr><td>Activities</td><td>{profile.activitiesText.split(/\n+/).slice(0, 6).join(" · ")}</td></tr>}
            {profile.awardsText && <tr><td>Awards & honors</td><td>{profile.awardsText.split(/\n+/).join(" · ")}</td></tr>}
            {profile.sat != null && <tr><td>SAT</td><td>{profile.sat}</td></tr>}
            <tr><td>Credentials</td><td>{[profile.ptk && "Phi Theta Kappa", profile.honors && "Honors program", profile.igetc && "IGETC"].filter(Boolean).join(", ") || "—"}</td></tr>
            <tr><td>Path</td><td>{profile.hook}</td></tr>
            {profile.docs.length > 0 && <tr><td>Documents analyzed</td><td>{profile.docs.join(", ")}{profile.courses.length ? ` (${profile.courses.length} courses read)` : ""}</td></tr>}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Chances at every school</h2>
        <table className="r-table">
          <thead>
            <tr><th>School</th><th>Official rate</th><th>Admit GPA (p25–median–p75)</th><th>Your range</th><th>Read</th></tr>
          </thead>
          <tbody>
            {ests.map((e) => (
              <tr key={e.school.id}>
                <td>{e.school.name}</td>
                <td>{e.school.rate.toFixed(1)}%</td>
                <td>{e.school.gpa.p25?.toFixed(2)} – {e.school.gpa.p50?.toFixed(2)} – {e.school.gpa.p75?.toFixed(2)}</td>
                <td>{fmtPct(e.lo)}–{fmtPct(e.hi)}%</td>
                <td>{e.tier}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {essay && (
        <section>
          <h2>Essay analysis</h2>
          <p>
            {essay.words} words · {essay.namedSchools.length > 0 ? `school-specific for ${essay.namedSchools.join(", ")}` : "not school-specific yet"}
            {essay.professorMentions > 0 ? ` · ${essay.professorMentions} professor(s) named` : " · no professors named"}
            {essay.verdict === "complaint" ? " · reads complaint-shaped — reframe around what each target offers" : ""}
          </p>
          {essay.notes.length > 0 && <ul>{essay.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </section>
      )}

      <section>
        <h2>What moves your file — top targets</h2>
        {top.map((e) => (
          <div key={e.school.id} className="r-school">
            <h3>{e.school.name} · {fmtPct(e.lo)}–{fmtPct(e.hi)}% · {e.tier}</h3>
            {e.school.counsel && (
              <>
                <p className="r-typ">{e.school.counsel.typical}</p>
                <ul>
                  {e.school.counsel.levers.slice(0, 3).map((l) => <li key={l}>{l}</li>)}
                  {e.school.counsel.watchouts.slice(0, 1).map((w) => <li key={w}>⚠ {w}</li>)}
                </ul>
              </>
            )}
          </div>
        ))}
      </section>

      <footer className="r-foot">
        Estimates for orientation, not admissions decisions. Baselines are official Common Data Set / UC
        admit-data transfer rates; profile adjustments derive from {Number(MODEL.meta.rows).toLocaleString()}{" "}
        self-reported outcomes (2011–2026), which over-represent acceptances. Not affiliated with any university.
      </footer>
    </div>
  );
}
