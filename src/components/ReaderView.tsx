import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Estimate, Profile } from "../engine";
import { HIGH_SCHOOL_FACT, readerSheet } from "../lib/reader";
import Tile from "./Tile";
import "./reader.css";

// How your file reads on the other side of the desk.

const SIGNAL_LABEL = { strong: "Strong", solid: "Solid", thin: "Thin", gap: "Blank" } as const;

export default function ReaderView({ profile, ests }: { profile: Profile; ests: Estimate[] }) {
  const targets = useMemo(() => ests.slice(0, 6), [ests]);
  const [pick, setPick] = useState(0);
  const e = targets[pick] ?? ests[0];
  const sheet = useMemo(() => readerSheet(profile, e), [profile, e]);

  if (!e) return null;

  return (
    <section className="rd" aria-labelledby="rd-h">
      <header className="rd-head">
        <div>
          <h3 id="rd-h">How your file reads on their desk</h3>
          <p>
            A reader clears the academic gate in about ten seconds, then spends the rest of the time in the
            boxes below. This is that sheet — for one school at a time, because it reads differently at each.
          </p>
        </div>
      </header>

      <div className="rd-picker" role="tablist" aria-label="Read as which school">
        {targets.map((t, i) => (
          <button
            key={t.school.id}
            type="button"
            role="tab"
            aria-selected={i === pick}
            className={`rd-pick${i === pick ? " on" : ""}`}
            onClick={() => setPick(i)}
          >
            <Tile name={t.school.name} size={20} />
            <span>{t.school.name}</span>
          </button>
        ))}
      </div>

      <div className="rd-sheet" key={e.school.id}>
        <div className={`rd-gate${sheet.gateCleared ? " ok" : " under"}`}>
          <span className="rd-gate-tag">Academic gate</span>
          <span className="rd-gate-state">{sheet.gateNote}</span>
        </div>

        <p className="rd-headline">{sheet.headline}</p>

        <ol className="rd-dims">
          {sheet.dimensions.map((d, i) => (
            <li
              key={d.id}
              className={`rd-dim rd-${d.signal}${d.id === sheet.pivot.id ? " pivot" : ""}`}
              style={{ "--dc": d.color, "--i": i } as CSSProperties}
            >
              <div className="rd-dim-top">
                <span className="rd-dim-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="rd-dim-label">
                  {d.label}
                  {d.id === sheet.pivot.id && <i className="rd-pivot-tag">reader stops here</i>}
                </span>
                <span className="rd-dim-sig">{SIGNAL_LABEL[d.signal]}</span>
              </div>
              <p className="rd-lens">{d.lens}</p>
              <div className="rd-meter" aria-hidden="true">
                <span className="rd-meter-fill" style={{ width: `${Math.round(d.score * 100)}%` }} />
              </div>
              <p className="rd-note">{d.note}</p>
              {d.lift && <p className="rd-lift">{d.lift}</p>}
            </li>
          ))}
        </ol>

        <div className="rd-hs">
          <span className="rd-hs-num num">{HIGH_SCHOOL_FACT.corr}</span>
          <div>
            <h4>Your high school is not on this sheet</h4>
            <p>{HIGH_SCHOOL_FACT.line}</p>
          </div>
        </div>
      </div>

      <p className="rd-foot">
        These are readings, not probabilities — a model of how a file gets weighed, built from what
        {" "}{Number(4243).toLocaleString()} admitted files in the study have in common. Real committees vary,
        and no one outside the room sees the rubric.
      </p>
    </section>
  );
}
