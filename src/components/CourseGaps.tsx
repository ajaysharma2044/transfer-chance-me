import { useMemo } from "react";
import type { Profile } from "../engine";
import { analyzeCourses, MAJOR_LABEL } from "../lib/coursework";
import "./coursegaps.css";

// Major prep, checked. Their own course lines matched against the transfer
// spine for their major — what's covered, what's still open.

export default function CourseGaps({ profile, onEdit }: { profile: Profile; onEdit?: () => void }) {
  const g = useMemo(() => analyzeCourses(profile), [profile]);
  const pct = g.coreTotal ? Math.round((g.coreDone / g.coreTotal) * 100) : 0;

  if (profile.courses.length === 0) {
    return (
      <section className="cg cg-empty">
        <h3>Major prep</h3>
        <p>
          Add the classes you've taken and we'll check them against what {MAJOR_LABEL[profile.major]} transfers
          need — and tell you exactly which requirements are still open.
        </p>
        {onEdit && <button type="button" className="btn btn-sm" onClick={onEdit}>Add my courses</button>}
      </section>
    );
  }

  const groups = [...new Set(g.statuses.map((s) => s.group))];

  return (
    <section className="cg" aria-labelledby="cg-h">
      <div className="cg-head">
        <div>
          <h3 id="cg-h">Major prep for {MAJOR_LABEL[profile.major]}</h3>
          <p>
            <b>{g.coreDone} of {g.coreTotal}</b> required courses covered by what you've entered.
            {g.missingCore.length > 0 && <> Still open: {g.missingCore.map((m) => m.label).join(", ")}.</>}
          </p>
        </div>
        <div className="cg-ring" role="img" aria-label={`${pct}% of core major prep complete`}>
          <span className="num">{pct}%</span>
        </div>
      </div>

      <div className="cg-bar" aria-hidden="true">
        <span className="cg-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      {groups.map((grp) => {
        const rows = g.statuses.filter((s) => s.group === grp);
        return (
          <div className="cg-group" key={grp}>
            <h4>{grp}</h4>
            <ul>
              {rows.map((s) => (
                <li key={s.key} className={`${s.have ? "have" : "gap"} ${s.tier}`}>
                  <span className="cg-mark" aria-hidden="true">{s.have ? "✓" : "○"}</span>
                  <span className="cg-label">
                    {s.label}
                    {s.tier === "strong" && <i className="cg-opt">strengthens</i>}
                  </span>
                  <span className="cg-via">{s.via ?? (s.tier === "core" ? "not yet" : "—")}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {g.extras.length > 0 && (
        <p className="cg-extras">
          <b>Also on your record:</b> {g.extras.slice(0, 8).join(" · ")}
        </p>
      )}
      {g.unmatched.length > 0 && (
        <p className="cg-unmatched">
          {g.unmatched.length} course{g.unmatched.length === 1 ? "" : "s"} we didn't recognise by title — that's
          usually fine, it just means we can't map {g.unmatched.length === 1 ? "it" : "them"} to a standard
          requirement.
        </p>
      )}

      <p className="cg-foot">
        Matched against the standard lower-division transfer sequence, not any one college's catalog — your
        college's exact course numbers are the ones on your own transcript. Always confirm articulation on
        ASSIST.org (California) or your target's transfer-credit page.
      </p>
      {onEdit && <button type="button" className="btn-quiet cg-edit" onClick={onEdit}>Edit my courses →</button>}
    </section>
  );
}
