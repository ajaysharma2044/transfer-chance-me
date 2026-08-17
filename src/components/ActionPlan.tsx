import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Estimate, Profile } from "../engine";
import { fmtPct } from "../engine";
import { buildPlan, liftLabel } from "../lib/actionplan";
import type { MoveTag, Plan, PlannedMove } from "../lib/actionplan";
import Tile from "./Tile";
import "./actionplan.css";

// The plan: what to do, in the time actually left, with the true value of
// each move — computed by re-running the engine, never written by hand.

const TAG_COLOR: Record<MoveTag, string> = {
  Extracurricular: "var(--teal)",
  Credential: "var(--accent)",
  Coursework: "var(--blue)",
  Timeline: "var(--coral)",
  Essay: "var(--accent)",
};

const LANES: (MoveTag | "All")[] = ["All", "Extracurricular", "Credential", "Coursework", "Timeline", "Essay"];

function MoveCard({ m, rank }: { m: PlannedMove; rank: number }) {
  const [open, setOpen] = useState(rank < 2);
  const color = TAG_COLOR[m.tag];
  return (
    <article
      className={`ap-move${m.done ? " done" : ""}${open ? " open" : ""}`}
      style={{ "--mc": color } as CSSProperties}
    >
      <button type="button" className="ap-move-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ap-move-rank">{m.done ? "✓" : rank + 1}</span>
        <span className="ap-move-headtext">
          <span className="ap-move-tagline">
            <b>{m.tag}</b>
            <i>{m.minWeeks} weeks minimum · {m.effort}</i>
          </span>
          <h4>{m.title}</h4>
        </span>
        <span className={`ap-lift${m.liftPp >= 0.1 ? " real" : ""}`}>{liftLabel(m)}</span>
      </button>

      {open && (
        <div className="ap-move-body">
          <ol className="ap-steps">
            {m.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>

          <div className="ap-move-meta">
            <div>
              <h5>Why it counts</h5>
              <p>{m.why}</p>
            </div>
            <div>
              <h5>Is it realistic?</h5>
              <p>{m.realism}</p>
            </div>
          </div>

          <div className="ap-proof">
            <h5>What it looks like on your application</h5>
            <p>{m.proof}</p>
          </div>

          {m.movers.length > 0 && (
            <div className="ap-movers">
              <h5>Where this actually moves you</h5>
              {m.movers.map((mv) => (
                <div className="ap-mover" key={mv.name}>
                  <Tile name={mv.name} size={20} />
                  <span className="ap-mover-name">{mv.name}</span>
                  <span className="ap-mover-from">{fmtPct(mv.from)}%</span>
                  <span className="ap-mover-arrow" aria-hidden="true">→</span>
                  <span className="ap-mover-to">{fmtPct(mv.to)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function ActionPlan({
  profile, ests, plan: planProp, compact = false,
}: { profile: Profile; ests?: Estimate[]; plan?: Plan; compact?: boolean }) {
  // buildPlan() re-runs estimateAll() over all 208 schools once per playbook
  // move plus once for the stacked figure. A page that already built the plan
  // passes it down instead of paying for it twice; the hook still runs in the
  // same order either way, it just has nothing to do.
  const ownPlan = useMemo(
    () => (planProp ? null : buildPlan(profile, ests)),
    [profile, ests, planProp],
  );
  const plan = planProp ?? ownPlan!;
  const [lane, setLane] = useState<MoveTag | "All">("All");

  const shown = plan.moves.filter((m) => lane === "All" || m.tag === lane);
  const todo = shown.filter((m) => !m.done);
  const done = shown.filter((m) => m.done);
  const visible = compact ? todo.slice(0, 3) : todo;
  const urgent = plan.next;

  return (
    <section className="ap" aria-labelledby="ap-h">
      <header className="ap-head">
        <div>
          <h3 id="ap-h">Your action plan</h3>
          <p>
            {urgent ? (
              <>
                <b>{urgent.days} days</b> until {urgent.school} closes ({urgent.label}). Everything below
                fits in the time you have left.
              </>
            ) : (
              <>Ranked by what each move is actually worth on your list.</>
            )}
          </p>
        </div>
        {plan.stackedPp >= 0.1 && (
          <div className="ap-stacked">
            <b className="num">+{plan.stackedPp.toFixed(1)}</b>
            <span>points if you do all of it</span>
          </div>
        )}
      </header>

      {!compact && plan.windows.length > 0 && (
        <div className="ap-timeline" aria-label="Your deadlines">
          {plan.windows.slice(0, 6).map((w, i) => (
            <div className={`ap-tl${i === 0 ? " next" : ""}`} key={`${w.school}-${w.label}`}>
              <span className="ap-tl-days num">{w.days}</span>
              <span className="ap-tl-unit">days</span>
              <span className="ap-tl-school">{w.school}</span>
              <span className="ap-tl-date">{w.label}</span>
              {w.note && <span className="ap-tl-note">{w.note}</span>}
            </div>
          ))}
        </div>
      )}

      {!compact && (
        <div className="ap-lanes" role="tablist" aria-label="Filter moves">
          {LANES.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={lane === l}
              className={`ap-lane${lane === l ? " on" : ""}`}
              style={l === "All" ? undefined : ({ "--mc": TAG_COLOR[l] } as CSSProperties)}
              onClick={() => setLane(l)}
            >
              {l}
              <i>{l === "All" ? plan.moves.filter((m) => !m.done).length : plan.moves.filter((m) => m.tag === l && !m.done).length}</i>
            </button>
          ))}
        </div>
      )}

      <div className="ap-list">
        {visible.map((m, i) => <MoveCard key={m.id} m={m} rank={i} />)}
        {visible.length === 0 && (
          <p className="ap-empty">Nothing left in this lane — you've already done these.</p>
        )}
      </div>

      {!compact && done.length > 0 && (
        <details className="ap-done">
          <summary>{done.length} already in your file</summary>
          <div className="ap-list">
            {done.map((m, i) => <MoveCard key={m.id} m={m} rank={i} />)}
          </div>
        </details>
      )}

      <p className="ap-foot">
        Each lift is measured, not asserted: we re-score your whole list with that one change applied and
        report the real difference. Moves that sharpen your file without changing a scored input say so.
        Nothing here rescues a below-median GPA at the single-digit schools.
      </p>
    </section>
  );
}
