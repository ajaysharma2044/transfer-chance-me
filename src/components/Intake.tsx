import { useState } from "react";
import type { Profile } from "../engine";
import ImportPanel from "./ImportPanel";
import EssayPanel from "./EssayPanel";
import SchoolSearch from "./SchoolSearch";
import CoursesEditor from "./CoursesEditor";

const STEPS = ["Academics", "Direction", "Your story"];

interface Props {
  profile: Profile;
  onChange: (p: Profile) => void;
  onDone: () => void;
}

function Choices<T extends string>({
  value, options, onPick, label,
}: {
  value: T;
  options: { v: T; l: string; sub?: string }[];
  onPick: (v: T) => void;
  label: string;
}) {
  return (
    <div className="choices" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" className="choice" aria-pressed={value === o.v} onClick={() => onPick(o.v)}>
          {o.l}
          {o.sub && <span className="sub">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, l, sub, onPick }: { on: boolean; l: string; sub?: string; onPick: () => void }) {
  return (
    <button type="button" className="choice" aria-pressed={on} onClick={onPick}>
      {l}
      {sub && <span className="sub">{sub}</span>}
    </button>
  );
}

export default function Intake({ profile, onChange, onDone }: Props) {
  const [step, setStep] = useState(0);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => onChange({ ...profile, [k]: v });

  return (
    <div className="intake">
      <div className="progress" aria-hidden="true">
        {STEPS.map((s, i) => <span key={s} className={i <= step ? "on" : ""} />)}
      </div>

      {step === 0 && (
        <section className="step" aria-label="Academics">
          <p className="stepline">Step 1 of 3</p>
          <h2>Academics</h2>
          <p className="step-dek">
            Transfer admission is GPA-dominated. In 8,910 recorded outcomes, college GPA is the
            variable that decides the file.
          </p>

          <ImportPanel profile={profile} onChange={onChange} />

          <div className="field">
            <span className="flabel">Your current school</span>
            <SchoolSearch profile={profile} onChange={onChange} />
            <p className="hint">Every US degree-granting college and community college is in here.</p>
          </div>

          <div className="field">
            <label htmlFor="gpa">Cumulative college GPA</label>
            <div className="gpa-row">
              <span className="gpa-big">{profile.gpa.toFixed(2)}</span>
              <input
                id="gpa" type="range" min="2.5" max="4" step="0.01"
                value={profile.gpa}
                onChange={(e) => set("gpa", parseFloat(e.target.value))}
              />
            </div>
            <p className="hint">
              Admitted transfers at the T25 cluster between 3.82 (big UCs) and 3.95–4.0 (elite privates).
            </p>
          </div>

          <div className="field">
            <span className="flabel">How has it moved?</span>
            <Choices
              label="GPA trend"
              value={profile.gpaTrend}
              onPick={(v) => set("gpaTrend", v)}
              options={[
                { v: "upward", l: "Climbing", sub: "each term stronger" },
                { v: "flat", l: "Steady" },
                { v: "downward", l: "Slipping", sub: "recent terms weaker" },
              ]}
            />
            <p className="hint">Readers weight the trajectory — 16% of elite admits are comeback stories.</p>
          </div>

          <CoursesEditor profile={profile} onChange={onChange} />

          {!profile.schoolName && (
            <div className="field">
              <span className="flabel">Or just pick the type</span>
              <Choices
                label="Current institution"
                value={profile.institution}
                onPick={(v) => set("institution", v)}
                options={[
                  { v: "cc", l: "Community college" },
                  { v: "public4", l: "4-year public", sub: "flagship, SUNY, UC…" },
                  { v: "private4", l: "4-year private", sub: "NYU, Emory, LACs…" },
                ]}
              />
            </div>
          )}

          {profile.institution === "cc" && (!profile.schoolName || profile.caResident) && (
            <div className="field">
              <span className="flabel">California pathway</span>
              <div className="choices">
                {!profile.schoolName && (
                  <Toggle on={profile.caResident} l="California CC" sub="in-state applicant" onPick={() => set("caResident", !profile.caResident)} />
                )}
                {profile.caResident && (
                  <Toggle on={profile.igetc} l="IGETC on track" sub="full GE certification" onPick={() => set("igetc", !profile.igetc)} />
                )}
              </div>
              <p className="hint">
                92% of UCLA's admitted transfers come from California community colleges.
              </p>
            </div>
          )}

          <div className="field">
            <span className="flabel">Applying to enter as</span>
            <Choices
              label="Standing"
              value={profile.standing}
              onPick={(v) => set("standing", v)}
              options={[
                { v: "sophomore", l: "Sophomore", sub: "one year completed" },
                { v: "junior", l: "Junior", sub: "two years completed" },
              ]}
            />
            <p className="hint">UCs admit at junior standing; most elite privates prefer sophomore entry.</p>
          </div>

          <div className="step-nav">
            <button type="button" className="btn" onClick={() => setStep(1)}>Continue</button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="step" aria-label="Direction">
          <p className="stepline">Step 2 of 3</p>
          <h2>Direction</h2>
          <p className="step-dek">
            The door you aim at matters as much as the file. CS and direct-to-business are the
            hardest gates; less-impacted majors flip real odds.
          </p>

          <div className="field">
            <span className="flabel">Intended major</span>
            <Choices
              label="Intended major"
              value={profile.major}
              onPick={(v) => set("major", v)}
              options={[
                { v: "cs", l: "Computer science" },
                { v: "engineering", l: "Engineering" },
                { v: "business", l: "Business" },
                { v: "econ", l: "Economics" },
                { v: "stem", l: "Other STEM" },
                { v: "social", l: "Social science" },
                { v: "humanities", l: "Humanities" },
                { v: "undecided", l: "Undecided" },
              ]}
            />
          </div>

          <div className="field">
            <label htmlFor="majordetail">The specific program, in your words <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>(optional)</span></label>
            <input
              id="majordetail" type="text" style={{ width: "100%", maxWidth: 420 }}
              placeholder='e.g. "Applied Economics at Dyson" or "Cognitive Science"'
              value={profile.majorDetail}
              onChange={(e) => set("majorDetail", e.target.value)}
            />
            <p className="hint">Naming the exact program sharpens both your chances read and the deep review.</p>
          </div>

          <div className="field">
            <label htmlFor="reason">Why are you transferring?</label>
            <textarea
              id="reason" rows={3}
              placeholder="One or two honest sentences — the real reason, not the polished one. We'll help you shape the polished one."
              value={profile.transferReason}
              onChange={(e) => set("transferReason", e.target.value)}
            />
            <p className="hint">
              The framing decides essays: fit-and-resources reasons win; escape reasons lose. We'll tell you which yours is.
            </p>
          </div>

          <div className="field">
            <label htmlFor="sat">SAT, if you have one worth sending</label>
            <input
              id="sat" type="number" inputMode="numeric" min={400} max={1600} step={10}
              placeholder="Optional"
              value={profile.sat ?? ""}
              onChange={(e) => set("sat", e.target.value ? Math.min(1600, Math.max(400, +e.target.value)) : null)}
            />
            <p className="hint">
              Scores still matter at MIT, Georgetown, and several Cornell colleges. Elsewhere they're a footnote.
            </p>
          </div>

          <div className="step-nav">
            <button type="button" className="btn" onClick={() => setStep(2)}>Continue</button>
            <button type="button" className="btn-quiet" onClick={() => setStep(0)}>Back</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="step" aria-label="Your story">
          <p className="stepline">Step 3 of 3</p>
          <h2>Your story</h2>
          <p className="step-dek">
            Beyond the transcript, admits credit one thing most: a school-specific reason to
            transfer. Résumé polish, notably, is not a lever.
          </p>

          <div className="field">
            <span className="flabel">Credentials</span>
            <div className="choices">
              <Toggle on={profile.ptk} l="Phi Theta Kappa" sub="CC honor society" onPick={() => set("ptk", !profile.ptk)} />
              <Toggle on={profile.honors} l="Honors program" sub="at current school" onPick={() => set("honors", !profile.honors)} />
            </div>
            <p className="hint">
              Phi Theta Kappa is the most-cited credential among community-college admits.
            </p>
          </div>

          <div className="field">
            <span className="flabel">Your path so far</span>
            <Choices
              label="Path"
              value={profile.hook}
              onPick={(v) => set("hook", v)}
              options={[
                { v: "none", l: "Traditional", sub: "straight-through student" },
                { v: "nontraditional", l: "Nontraditional", sub: "gap years, work, comeback" },
                { v: "veteran", l: "Veteran", sub: "military service" },
              ]}
            />
            <p className="hint">
              Princeton, Yale, and Columbia run dedicated veteran and comeback pipelines.
            </p>
          </div>

          <div className="field">
            <span className="flabel">Context that belongs in your file</span>
            <div className="choices">
              <Toggle on={profile.firstGen} l="First-generation" sub="first in family to finish college" onPick={() => set("firstGen", !profile.firstGen)} />
            </div>
            <div style={{ marginTop: 14 }}>
              <label htmlFor="workhours" style={{ display: "block", fontSize: 13.5, fontWeight: 550, marginBottom: 8 }}>
                Hours you work per week <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>(optional)</span>
              </label>
              <input
                id="workhours" type="number" inputMode="numeric" min={0} max={80}
                placeholder="0"
                value={profile.workHours ?? ""}
                onChange={(e) => set("workHours", e.target.value ? Math.min(80, Math.max(0, +e.target.value)) : null)}
              />
            </div>
            <p className="hint">
              Work while enrolled is context readers respect — a 3.8 on 25 hours a week reads differently than a 3.8 on zero.
            </p>
          </div>

          <EssayPanel profile={profile} onChange={onChange} />

          {!profile.essayText && (
            <div className="field">
              <span className="flabel">Or just tell us where it stands</span>
              <Choices
                label="Essay"
                value={profile.essay}
                onPick={(v) => set("essay", v)}
                options={[
                  { v: "named", l: "Names programs & professors", sub: "school-specific case" },
                  { v: "general", l: "General fit story" },
                  { v: "draft", l: "Not written yet" },
                ]}
              />
            </div>
          )}

          <div className="field">
            <span className="flabel">Extracurriculars</span>
            <Choices
              label="Extracurriculars"
              value={profile.ecLevel}
              onPick={(v) => set("ecLevel", v)}
              options={[
                { v: "minimal", l: "Thin", sub: "school + work" },
                { v: "campus", l: "Campus involvement", sub: "clubs, TA, research" },
                { v: "national", l: "National-level", sub: "awards, startups" },
              ]}
            />
            <p className="hint">
              Honest note: across 1,217 profiles, EC strength shows no admit advantage once GPA is
              held constant. We weigh it accordingly.
            </p>
          </div>

          <div className="field">
            <label htmlFor="acts">Your activities, in your own words</label>
            <textarea
              id="acts" rows={5}
              placeholder={"One per line, as you'd write them in the application:\nTreasurer, Economics Club — ran a $3k budget, organized 6 speaker events\nMath tutor, campus learning center — 8 hrs/week"}
              value={profile.activitiesText}
              onChange={(e) => set("activitiesText", e.target.value)}
            />
            <p className="hint">
              The deep review grades these descriptions and rewrites the weak ones.
            </p>
          </div>

          <div className="field">
            <label htmlFor="awards">Awards & honors <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>(optional)</span></label>
            <textarea
              id="awards" rows={3}
              placeholder={"Dean's List (3 semesters)\nPhi Theta Kappa\nHackathon finalist, 2025"}
              value={profile.awardsText}
              onChange={(e) => set("awardsText", e.target.value)}
            />
            <p className="hint">
              Institutional honors — Dean's List, PTK, honors societies — recur in admits' files far more than flashy external prizes.
            </p>
          </div>

          <div className="step-nav">
            <button type="button" className="btn" onClick={onDone}>See my chances</button>
            <button type="button" className="btn-quiet" onClick={() => setStep(1)}>Back</button>
          </div>
        </section>
      )}
    </div>
  );
}
