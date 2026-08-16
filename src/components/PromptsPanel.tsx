import { appLabel, promptsFor } from "../lib/prompts";
import "./prompts.css";

// What this school actually asks you to write, quoted from its own site.

export default function PromptsPanel({ school }: { school: string }) {
  const p = promptsFor(school);
  if (!p) return null;

  return (
    <section className="pr" aria-labelledby={`pr-h-${school}`}>
      <div className="pr-head">
        <h3 id={`pr-h-${school}`}>What {school} asks you to write</h3>
        <span className="pr-app">{appLabel(p)}</span>
      </div>

      {p.prompts.length > 0 ? (
        <ol className="pr-list">
          {p.prompts.map((q, i) => (
            <li key={i} className={q.required ? "req" : ""}>
              <div className="pr-meta">
                <span className={`pr-badge${q.required ? " req" : ""}`}>
                  {q.required ? "Required" : "Optional"}
                </span>
                <span className="pr-words">{q.words}</span>
              </div>
              <blockquote>{q.text}</blockquote>
            </li>
          ))}
        </ol>
      ) : (
        <p className="pr-none">
          No school-specific supplement — the Common App transfer essay is the whole writing
          requirement here, which raises the stakes on that single piece.
        </p>
      )}

      {p.notes && <p className="pr-notes">{p.notes}</p>}

      <footer className="pr-foot">
        <span>{p.cycle}</span>
        <span className="pr-links">
          {p.transferUrl && <a href={p.transferUrl} target="_blank" rel="noreferrer">Transfer page ↗</a>}
          {p.cdsUrl && <a href={p.cdsUrl} target="_blank" rel="noreferrer">Common Data Set ↗</a>}
        </span>
      </footer>
      <p className="pr-verify">Prompts change yearly — always confirm on the school's own page before you write.</p>
    </section>
  );
}
