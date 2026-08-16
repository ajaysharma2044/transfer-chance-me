import { majorsFor, STATUS_BLURB, STATUS_LABEL } from "../lib/majors";
import "./majors.css";

// Where the real gate is. The campus rate hides a spread this wide.

export default function MajorsPanel({ school }: { school: string }) {
  const m = majorsFor(school);
  if (!m) return null;

  return (
    <section className="mj" aria-labelledby={`mj-h-${school}`}>
      <div className="mj-head">
        <h3 id={`mj-h-${school}`}>The real gate: {school} by major</h3>
        {m.byMajor && <span className="mj-flag">Admission decided by major</span>}
      </div>
      <p className="mj-note">{m.note}</p>

      <ul className="mj-list">
        {m.majors.map((x) => (
          <li key={x.name} className={`mj-${x.status}`}>
            <div className="mj-row">
              <span className="mj-name">{x.name}</span>
              {x.rate != null && <span className="mj-rate num">{x.rate.toFixed(1)}%</span>}
              <span className={`mj-badge mj-b-${x.status}`} title={STATUS_BLURB[x.status]}>
                {STATUS_LABEL[x.status]}
              </span>
            </div>
            <p className="mj-mnote">{x.note}</p>
            {x.prereqs.length > 0 && (
              <ul className="mj-prereqs">
                {x.prereqs.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <footer className="mj-foot">
        {m.source && <a href={m.source} target="_blank" rel="noreferrer">Source ↗</a>}
        <span>Requirements change — confirm on the school's own page before you plan around them.</span>
      </footer>
    </section>
  );
}
