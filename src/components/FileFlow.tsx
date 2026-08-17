import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { estimateAll, fmtPct, MODEL } from "../engine";
import type { ActivityEntry, Estimate, Major, Profile, Standing, Tier } from "../engine";
import { analyzeCourses, MAJOR_LABEL } from "../lib/coursework";
import { analyzeEssay } from "../lib/essay";
import { buildPlan, liftLabel } from "../lib/actionplan";
import { admitSignatures, CORPUS_META, countEligible, findSimilar, MATCH_WINDOW } from "../lib/similar";
import { hsPrompt, hsRules, hsStillHeavy, UNITS_HS_STILL_COUNTS } from "../lib/highschool";
import { HIGH_SCHOOL_FACT } from "../lib/reader";
import { markOf } from "../lib/schools";
import { useScrollFx } from "../hooks/useScrollFx";
import ImportPanel from "./ImportPanel";
import CampusPhoto from "./CampusPhoto";
import Tile from "./Tile";
import "./fileflow.css";

// The signed-in file flow — the real version of the hero demo.
//
// Five screens, same spine as HeroDemo: your profile → your record → the
// high-school question → your activities → what the file actually says. The
// difference is that nothing here is scripted. Every figure on the feedback
// screen is computed on this device, at this moment, from the student's own
// profile: estimateAll() for the odds, findSimilar()/admitSignatures() for
// the matched files, analyzeCourses() for the prep gaps, analyzeEssay() for
// the essay read, buildPlan() for the moves and their true lift.
//
// No model is called from this component. The AI review is a separate,
// deliberate step the student takes at the end — go("review").

const STEPS = [
  { id: "upload", label: "Upload", blurb: "Transcript in, fields out" },
  { id: "record", label: "Your record", blurb: "Everything the document missed" },
  { id: "highschool", label: "High school", blurb: "Who actually reads it" },
  { id: "activities", label: "Activities", blurb: "One entry each" },
  { id: "feedback", label: "Feedback", blurb: "What your file says" },
] as const;

const MAJORS: Major[] = [
  "cs", "engineering", "business", "econ", "stem", "social", "humanities", "undecided",
];

const INSTITUTION_LABEL: Record<Profile["institution"], string> = {
  cc: "Community college",
  public4: "Four-year public",
  private4: "Four-year private",
};

const STANDING_LABEL: Record<Standing, string> = {
  sophomore: "Sophomore entry",
  junior: "Junior standing",
};

const TIER_CLASS: Record<Tier, string> = {
  "TAG guarantee": "ff-t-tag",
  Likely: "ff-t-likely",
  "Strong target": "ff-t-strong",
  Target: "ff-t-target",
  Reach: "ff-t-reach",
  "High reach": "ff-t-far",
  "Long shot": "ff-t-far",
};

/** How the high-school rule reads to a student, per lib/highschool.ts weight. */
const HS_WEIGHT_LABEL = {
  scored: "Scored",
  fades: "Fades with units",
  required: "Required",
  ignored: "Not scored",
} as const;

/** The profile keys a document can actually fill in (see lib/extract.ts).
 *  Used to tell "the transcript said this" from "you typed this" honestly —
 *  a value only gets the green chip when an import genuinely changed it. */
const EXTRACTABLE: (keyof Profile)[] = [
  "gpa", "sat", "standing", "institution", "caResident", "major",
  "ptk", "honors", "igetc", "hook", "courses", "schoolName",
];

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

/**
 * One line per activity, in the shape the AI prompt already reads.
 * `activitiesText` stays the source of truth for src/lib/review.ts, so every
 * edit to a structured row rewrites it in the same commit.
 */
function joinActivities(rows: ActivityEntry[]): string {
  return rows
    .map((a) => {
      const head = [a.title.trim(), a.detail.trim()].filter(Boolean).join(" — ");
      if (!head) return "";
      const bits: string[] = [];
      if (a.hours != null) bits.push(`${a.hours} hrs/wk`);
      if (a.years != null) bits.push(`${a.years} ${a.years === 1 ? "year" : "years"}`);
      return bits.length ? `${head} (${bits.join(", ")})` : head;
    })
    .filter(Boolean)
    .join("\n");
}

/** Split a pasted activities blob into one row per line, nothing invented. */
function seedActivities(text: string): ActivityEntry[] {
  return text
    .split(/\r?\n|;/)
    .map((l) => l.replace(/^\s*[-•*·]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((title) => ({ title, detail: "", hours: null, years: null }));
}

/* ────────────────────────────────────────────────────────────────────────
   Inputs
   ──────────────────────────────────────────────────────────────────────── */

/** A number field that survives being emptied mid-edit. The draft string is
 *  local so "3." is a legal thing to be typing; the profile only sees a value
 *  once it parses. */
function NumField({
  id, label, value, onCommit, min, max, step = 1, unit, placeholder, allowEmpty = true, hint,
}: {
  id: string;
  label: string;
  value: number | null;
  onCommit: (n: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  hint?: string;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));

  // Adopt a value that arrived from somewhere else (a transcript import, a
  // synced profile) without stomping on what is being typed right now.
  useEffect(() => {
    const cur = draft.trim() === "" ? null : Number(draft);
    if (cur !== value && !(Number.isNaN(cur as number) && value == null)) {
      setDraft(value == null ? "" : String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="ff-f">
      <label className="ff-flabel" htmlFor={id}>{label}</label>
      <div className="ff-inputwrap">
        <input
          id={id}
          type="number"
          className="ff-input num"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            if (v.trim() === "") { if (allowEmpty) onCommit(null); return; }
            const n = Number(v);
            if (Number.isNaN(n)) return;
            if (min != null && n < min) return;
            if (max != null && n > max) return;
            onCommit(n);
          }}
        />
        {unit && <span className="ff-unit">{unit}</span>}
      </div>
      {hint && <p className="ff-fhint">{hint}</p>}
    </div>
  );
}

function CheckRow({
  id, label, note, checked, onChange,
}: { id: string; label: string; note: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <div className="ff-check">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>
        <span className="ff-check-label">{label}</span>
        <span className="ff-check-note">{note}</span>
      </label>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   The flow
   ──────────────────────────────────────────────────────────────────────── */

export default function FileFlow({
  profile, onChange, go,
}: { profile: Profile; onChange: (p: Profile) => void; go: (route: string) => void }) {
  const [step, setStep] = useState(0);
  /** Keys an upload genuinely filled in this session — the green chip's proof. */
  const [fromDoc, setFromDoc] = useState<string[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);

  // The app runs the scroll choreography once per route; a step swap is a new
  // set of [data-fx] nodes on the same route, so re-run it here or they stay
  // at opacity 0 forever.
  useScrollFx([step]);

  const set = useCallback(
    (patch: Partial<Profile>) => onChange({ ...profile, ...patch }),
    [onChange, profile],
  );

  /** Wraps ImportPanel so we can record what the document actually changed. */
  const handleImport = useCallback(
    (next: Profile) => {
      const hit = EXTRACTABLE.filter((k) => !sameValue(profile[k], next[k])).map(String);
      if (hit.length) setFromDoc((prev) => [...new Set([...prev, ...hit])]);
      onChange(next);
    },
    [onChange, profile],
  );

  // The list the high-school question is answered against. We have no explicit
  // shortlist in this flow, so it is their strongest-scoring targets right now
  // — and the copy says exactly that rather than implying the student picked
  // them. Only computed on the step that reads it, so a keystroke anywhere
  // else does not re-score the whole model.
  const targets = useMemo(
    () => (step === 2 ? estimateAll(profile).slice(0, 10).map((e) => e.school.name) : []),
    [profile, step],
  );

  const activities = profile.activities;
  /**
   * Structured rows are the student's view; `activitiesText` is what the AI
   * prompt reads (src/lib/review.ts), so both move together.
   *
   * The guard matters: a student who pasted a block of activities and then
   * clicked "add" once had rows=[{blank}], which joins to "" — and that would
   * have silently deleted everything they had written. Blank rows can only
   * clear the text when the text was generated from rows in the first place.
   */
  const writeActivities = useCallback(
    (rows: ActivityEntry[]) => {
      const text = joinActivities(rows);
      const derived = profile.activities.length > 0;
      set({ activities: rows, activitiesText: text || (derived ? "" : profile.activitiesText) });
    },
    [set, profile.activities.length, profile.activitiesText],
  );

  // Land at the top of the new step, after it has rendered — never on mount,
  // which would yank a reader who arrived mid-page.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    stageRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [step]);

  const goStep = (i: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, i)));

  return (
    <section className="ff" aria-labelledby="ff-title">
      <header className="ff-head" data-fx>
        <p className="ff-eyebrow">Your file</p>
        <h1 id="ff-title">Everything a transfer reader will see, in one place</h1>
        <p className="ff-lede">
          Upload what you have, fill the gaps, and the app reads your file back to you against{" "}
          <span className="num">{Number(MODEL.meta.rows).toLocaleString()}</span> recorded outcomes.
          Parsing and scoring both run on this device.
        </p>
      </header>

      {/* ── Stepper rail ── */}
      <nav className="ff-rail" aria-label="File steps">
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.id} className={i === step ? "on" : i < step ? "done" : ""}>
              <button
                type="button"
                onClick={() => goStep(i)}
                aria-current={i === step ? "step" : undefined}
              >
                <span className="ff-rail-n num">{String(i + 1).padStart(2, "0")}</span>
                <span className="ff-rail-t">
                  <span className="ff-rail-label">{s.label}</span>
                  <span className="ff-rail-blurb">{s.blurb}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="ff-rail-track" aria-hidden="true">
          <i style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
        </div>
      </nav>

      <div className="ff-stage" ref={stageRef}>
        {step === 0 && <StepUpload profile={profile} onImport={handleImport} fromDoc={fromDoc} />}
        {step === 1 && <StepRecord profile={profile} set={set} />}
        {step === 2 && <StepHighSchool profile={profile} set={set} targets={targets} />}
        {step === 3 && (
          <StepActivities
            profile={profile}
            activities={activities}
            write={writeActivities}
          />
        )}
        {step === 4 && <StepFeedback profile={profile} go={go} />}
      </div>

      <div className="ff-nav">
        <button
          type="button"
          className="ff-back"
          onClick={() => goStep(step - 1)}
          disabled={step === 0}
        >
          Back
        </button>
        <span className="ff-nav-pos num">
          {String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
        </span>
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn" onClick={() => goStep(step + 1)}>
            Continue to {STEPS[step + 1].label.toLowerCase()}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => go("review")}>
            Send it for the deep review
          </button>
        )}
      </div>
    </section>
  );
}

/* ── 01 · Upload ───────────────────────────────────────────────────────── */

interface ReadRow {
  key: string;
  label: string;
  value: string | null;
  /** Which profile key would carry the document's fingerprint. */
  src: string;
}

function StepUpload({
  profile, onImport, fromDoc,
}: { profile: Profile; onImport: (p: Profile) => void; fromDoc: string[] }) {
  const creds = [
    profile.ptk ? "Phi Theta Kappa" : null,
    profile.honors ? "Honors program" : null,
    profile.igetc ? "IGETC" : null,
  ].filter(Boolean) as string[];

  const scores = [
    profile.sat != null ? `${profile.sat} SAT` : null,
    profile.act != null ? `${profile.act} ACT` : null,
  ].filter(Boolean) as string[];

  const rows: ReadRow[] = [
    { key: "gpa", label: "College GPA", value: profile.gpa.toFixed(2), src: "gpa" },
    { key: "scores", label: "Test scores", value: scores.length ? scores.join(" · ") : null, src: "sat" },
    {
      key: "standing",
      label: "Standing",
      value: profile.credits != null
        ? `${STANDING_LABEL[profile.standing]} · ${profile.credits} credits`
        : STANDING_LABEL[profile.standing],
      src: "standing",
    },
    {
      key: "inst",
      label: "Currently at",
      value: profile.schoolName ?? INSTITUTION_LABEL[profile.institution],
      src: profile.schoolName ? "schoolName" : "institution",
    },
    {
      key: "major",
      label: "Intended major",
      value: profile.majorDetail.trim()
        ? `${MAJOR_LABEL[profile.major]} · ${profile.majorDetail.trim()}`
        : MAJOR_LABEL[profile.major],
      src: "major",
    },
    { key: "creds", label: "Credentials", value: creds.length ? creds.join(" · ") : null, src: "ptk" },
    {
      key: "courses",
      label: "Courses read",
      value: profile.courses.length ? `${profile.courses.length} on your transcript` : null,
      src: "courses",
    },
    {
      key: "docs",
      label: "Documents on file",
      value: profile.docs.length ? profile.docs.join(", ") : null,
      src: "docs",
    },
  ];

  return (
    <div className="ff-panel" data-fx>
      <div className="ff-panel-head">
        <h2>Start with the transcript</h2>
        <p>
          PDF or text, several at once. We read GPA, credits, courses, institution and credentials
          off it, then you correct anything we got wrong. Signed in, your file syncs to your account
          so it survives this device.
        </p>
      </div>

      <div className="ff-drop">
        <ImportPanel profile={profile} onChange={onImport} />
      </div>

      <p className="ff-sublabel">What the app has on you right now</p>
      <div className="ff-readgrid" data-fx data-fx-stagger>
        {rows.map((r) => (
          <div className={`ff-read${r.value == null ? " empty" : ""}`} key={r.key}>
            <span className="ff-read-label">{r.label}</span>
            <span className="ff-read-value num">
              {r.value ?? <span className="ff-em num" aria-label="unknown">—</span>}
            </span>
            {r.value == null ? (
              <span className="ff-read-note">Not read yet — add it on the next step</span>
            ) : fromDoc.includes(r.src) ? (
              <span className="ff-chip ff-chip-doc">Read from your document</span>
            ) : (
              <span className="ff-read-note">You can edit this on the next step</span>
            )}
          </div>
        ))}
      </div>

      <p className="ff-foot">
        An em dash means we genuinely do not know it. We would rather show you a blank than a
        number nobody measured.
      </p>
    </div>
  );
}

/* ── 02 · Your record ──────────────────────────────────────────────────── */

function StepRecord({ profile, set }: { profile: Profile; set: (p: Partial<Profile>) => void }) {
  return (
    <div className="ff-panel" data-fx>
      <div className="ff-panel-head">
        <h2>The parts a transcript never says</h2>
        <p>
          A PDF gives us grades and course codes. Everything below changes how your file is read
          and has to come from you.
        </p>
      </div>

      <div className="ff-grid">
        <NumField
          id="ff-gpa"
          label="College GPA"
          value={profile.gpa}
          onCommit={(n) => { if (n != null) set({ gpa: n }); }}
          min={0}
          max={4}
          step={0.01}
          allowEmpty={false}
          hint="Cumulative, on a 4.0 scale."
        />
        <NumField
          id="ff-credits"
          label="Transferable credits"
          value={profile.credits}
          onCommit={(credits) => set({ credits })}
          min={0}
          max={200}
          unit="units"
          placeholder="—"
          hint={`Under ${UNITS_HS_STILL_COUNTS} units, several schools still read your high-school record.`}
        />
        <NumField
          id="ff-sat"
          label="SAT total"
          value={profile.sat}
          onCommit={(sat) => set({ sat })}
          min={400}
          max={1600}
          step={10}
          placeholder="—"
          hint="Leave blank if you are not sending one."
        />
        <NumField
          id="ff-act"
          label="ACT composite"
          value={profile.act}
          onCommit={(act) => set({ act })}
          min={1}
          max={36}
          placeholder="—"
          hint="Stored as-is — a converted score is not the score a school receives."
        />
        <NumField
          id="ff-work"
          label="Paid work while enrolled"
          value={profile.workHours}
          onCommit={(workHours) => set({ workHours })}
          min={0}
          max={80}
          unit="hrs/wk"
          placeholder="—"
          hint="Context for the review — a GPA earned while working reads differently."
        />
        <div className="ff-f">
          <label className="ff-flabel" htmlFor="ff-major">Major lane</label>
          <select
            id="ff-major"
            className="ff-select"
            value={profile.major}
            onChange={(e) => set({ major: e.target.value as Major })}
          >
            {MAJORS.map((m) => (
              <option key={m} value={m}>{MAJOR_LABEL[m]}</option>
            ))}
          </select>
          <p className="ff-fhint">This picks the lane the engine scores you in.</p>
        </div>
        <div className="ff-f ff-f-wide">
          <label className="ff-flabel" htmlFor="ff-majordetail">The program in your own words</label>
          <input
            id="ff-majordetail"
            type="text"
            className="ff-input ff-input-wide"
            value={profile.majorDetail}
            placeholder="Applied Economics (Dyson)"
            onChange={(e) => set({ majorDetail: e.target.value })}
          />
          <p className="ff-fhint">
            Named programs matter more than the bucket — the deep review reads this line.
          </p>
        </div>
      </div>

      <fieldset className="ff-set">
        <legend>Standing</legend>
        <div className="ff-choices">
          {(["sophomore", "junior"] as Standing[]).map((s) => (
            <button
              key={s}
              type="button"
              className="ff-choice"
              aria-pressed={profile.standing === s}
              onClick={() => set({ standing: s })}
            >
              {STANDING_LABEL[s]}
            </button>
          ))}
        </div>
        <p className="ff-fhint">
          The UCs admit transfers at junior standing; a sophomore-entry application is largely
          ineligible there.
        </p>
      </fieldset>

      <fieldset className="ff-set">
        <legend>Context and credentials</legend>
        <div className="ff-checks">
          <CheckRow
            id="ff-firstgen"
            label="First-generation college student"
            note="Neither parent completed a four-year degree"
            checked={profile.firstGen}
            onChange={(firstGen) => set({ firstGen })}
          />
          <CheckRow
            id="ff-ca"
            label="California resident"
            note="Gates TAG and the UC transfer-priority lane"
            checked={profile.caResident}
            onChange={(caResident) => set({ caResident })}
          />
          <CheckRow
            id="ff-igetc"
            label="IGETC complete or in progress"
            note="The standard admitted pathway into the UCs"
            checked={profile.igetc}
            onChange={(igetc) => set({ igetc })}
          />
          <CheckRow
            id="ff-ptk"
            label="Phi Theta Kappa"
            note="The single most-cited credential among community-college admits"
            checked={profile.ptk}
            onChange={(ptk) => set({ ptk })}
          />
          <CheckRow
            id="ff-honors"
            label="Honors program"
            note="Recurs in the institutional stack of admitted files"
            checked={profile.honors}
            onChange={(honors) => set({ honors })}
          />
        </div>
      </fieldset>
    </div>
  );
}

/* ── 03 · High school ──────────────────────────────────────────────────── */

function StepHighSchool({
  profile, set, targets,
}: { profile: Profile; set: (p: Partial<Profile>) => void; targets: string[] }) {
  const prompt = useMemo(() => hsPrompt(targets), [targets]);
  const rules = useMemo(() => hsRules(targets), [targets]);
  const heavy = hsStillHeavy(profile);
  const reads = rules.filter((r) => r.weight !== "ignored");

  return (
    <div className="ff-panel" data-fx>
      <div className="ff-panel-head">
        <h2>Your high school</h2>
        <p>
          Collected because specific schools require it — never because it moves your odds. The
          number below is why.
        </p>
      </div>

      {/* The honest counterweight, first, before we ask for the field. */}
      <div className="ff-fact">
        <span className="ff-fact-n num g-text">{HIGH_SCHOOL_FACT.corr}</span>
        <div>
          <p className="ff-fact-label">Correlation with your college GPA</p>
          <p className="ff-fact-line">{HIGH_SCHOOL_FACT.line}</p>
        </div>
      </div>

      <div className="ff-grid">
        <div className="ff-f ff-f-wide">
          <label className="ff-flabel" htmlFor="ff-hs">High school</label>
          <input
            id="ff-hs"
            type="text"
            className="ff-input ff-input-wide"
            value={profile.highSchool}
            placeholder="Lincoln High School, Portland OR"
            onChange={(e) => set({ highSchool: e.target.value })}
          />
        </div>
        <NumField
          id="ff-hsyear"
          label="Graduation year"
          value={profile.hsGradYear}
          onCommit={(hsGradYear) => set({ hsGradYear })}
          min={1950}
          max={2035}
          placeholder="—"
        />
      </div>

      <p className="ff-sublabel">Who actually reads it</p>

      {prompt ? (
        <p className="ff-callout">{prompt}</p>
      ) : (
        <p className="ff-callout ff-callout-quiet">
          None of your strongest targets right now read your high-school record. Fill it in anyway
          if you like — it stays on your file and costs you nothing — but no school on this list
          will score it.
        </p>
      )}

      {rules.length > 0 && (
        <div className="ff-hslist" data-fx data-fx-stagger>
          {rules.map((r) => (
            <div className={`ff-hsrow ff-hs-${r.weight}`} key={r.school}>
              <Tile name={r.school} size={26} />
              <div className="ff-hsrow-body">
                <span className="ff-hsrow-school">{r.school}</span>
                <p className="ff-hsrow-note">{r.note}</p>
              </div>
              <span className={`ff-pill ff-pill-${r.weight}`}>{HS_WEIGHT_LABEL[r.weight]}</span>
            </div>
          ))}
        </div>
      )}

      {rules.length === 0 && (
        <p className="ff-foot">
          None of your current targets publish a position on the high-school record, so we have
          nothing sourced to show you here. We will not guess one.
        </p>
      )}

      {heavy && reads.length > 0 && (
        <p className="ff-warn">
          Your transcript shows fewer than{" "}
          <span className="num">{UNITS_HS_STILL_COUNTS}</span> transferable units so far. In that
          window the schools marked "fades with units" still rest the decision in large part on
          your high-school record — finishing another term of college work is what moves it.
        </p>
      )}

      <p className="ff-foot">
        Rules are transcribed per school, not keyword-matched: "transcript required" and "the
        transcript is scored" are different obligations and we will not collapse them.
      </p>
    </div>
  );
}

/* ── 04 · Activities ───────────────────────────────────────────────────── */

function StepActivities({
  profile, activities, write,
}: { profile: Profile; activities: ActivityEntry[]; write: (rows: ActivityEntry[]) => void }) {
  const pastedOnly = activities.length === 0 && profile.activitiesText.trim().length > 0;

  const update = (i: number, patch: Partial<ActivityEntry>) =>
    write(activities.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const blank = (): ActivityEntry => ({ title: "", detail: "", hours: null, years: null });
  // Adding a row while a pasted block is still the only record would leave
  // that block orphaned, so the block becomes rows first and the new one goes
  // on the end. Nothing the student wrote is dropped.
  const add = () =>
    write(pastedOnly ? [...seedActivities(profile.activitiesText), blank()] : [...activities, blank()]);
  const remove = (i: number) => write(activities.filter((_, j) => j !== i));

  return (
    <div className="ff-panel" data-fx>
      <div className="ff-panel-head">
        <h2>Your activities, one entry each</h2>
        <p>
          Pattern beats prestige. Campus-anchored involvement with real hours behind it is the
          shape that recurs in admitted files — so an entry with a role, a span and a number reads
          as substance where the same activity, unlabelled, reads as nothing.
        </p>
      </div>

      {pastedOnly && (
        <div className="ff-seed">
          <div>
            <p className="ff-seed-h">You already have an activities block on file</p>
            <p className="ff-seed-b">
              Split it into rows and each activity gets graded on its own instead of the whole
              block getting one verdict. Your text is kept — the rows are built from its lines.
            </p>
            <pre className="ff-seed-pre">{profile.activitiesText}</pre>
          </div>
          <button
            type="button"
            className="ff-choice"
            onClick={() => write(seedActivities(profile.activitiesText))}
          >
            Split into rows
          </button>
        </div>
      )}

      {activities.length === 0 && !pastedOnly && (
        <p className="ff-callout ff-callout-quiet">
          Nothing here yet. Add the job, the club, the tutoring, the caretaking — paid work is a
          real entry, not a gap.
        </p>
      )}

      <div className="ff-acts">
        {activities.map((a, i) => (
          <div className="ff-act" key={i} style={{ "--i": i } as CSSProperties}>
            <div className="ff-act-top">
              <span className="ff-act-n num">{String(i + 1).padStart(2, "0")}</span>
              <div className="ff-f ff-act-title">
                <label className="ff-flabel" htmlFor={`ff-act-t-${i}`}>What it is</label>
                <input
                  id={`ff-act-t-${i}`}
                  type="text"
                  className="ff-input ff-input-wide"
                  value={a.title}
                  placeholder="Shift lead, campus coffee bar"
                  onChange={(e) => update(i, { title: e.target.value })}
                />
              </div>
              <button
                type="button"
                className="ff-remove"
                onClick={() => remove(i)}
                aria-label={`Remove activity ${i + 1}${a.title.trim() ? `: ${a.title.trim()}` : ""}`}
              >
                Remove
              </button>
            </div>

            <div className="ff-f">
              <label className="ff-flabel" htmlFor={`ff-act-d-${i}`}>What you actually did</label>
              <textarea
                id={`ff-act-d-${i}`}
                className="ff-textarea"
                rows={2}
                value={a.detail}
                placeholder="Trained four new hires, closed nightly registers, covered every finals week."
                onChange={(e) => update(i, { detail: e.target.value })}
              />
            </div>

            <div className="ff-act-nums">
              <NumField
                id={`ff-act-h-${i}`}
                label="Hours a week"
                value={a.hours}
                onCommit={(hours) => update(i, { hours })}
                min={0}
                max={80}
                unit="hrs"
                placeholder="—"
              />
              <NumField
                id={`ff-act-y-${i}`}
                label="Years involved"
                value={a.years}
                onCommit={(years) => update(i, { years })}
                min={0}
                max={12}
                step={0.5}
                unit="yrs"
                placeholder="—"
              />
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="ff-add" onClick={add}>+ Add an activity</button>

      {activities.length > 0 && (
        <>
          <p className="ff-sublabel">What the review will read</p>
          <pre className="ff-preview">{profile.activitiesText || "—"}</pre>
        </>
      )}

      <p className="ff-foot">
        Hours and years are optional and stay blank when you do not know them. A blank is honest;
        a guessed number is the thing a reader catches.
      </p>
    </div>
  );
}

/* ── 05 · Feedback ─────────────────────────────────────────────────────── */

function StepFeedback({ profile, go }: { profile: Profile; go: (route: string) => void }) {
  const ests = useMemo(() => estimateAll(profile), [profile]);
  const top = useMemo(() => ests.slice(0, 6), [ests]);
  const names = useMemo(() => top.map((e) => e.school.name), [top]);
  const matches = useMemo(() => findSimilar(profile, names, 3), [profile, names]);
  const sigs = useMemo(() => admitSignatures(names, 2), [names]);
  const eligible = useMemo(() => countEligible(profile), [profile]);
  const gaps = useMemo(() => analyzeCourses(profile), [profile]);
  const plan = useMemo(() => buildPlan(profile, ests), [profile, ests]);
  const hasEssay = profile.essayText.trim().length > 0;
  const essay = useMemo(() => analyzeEssay(profile.essayText), [profile.essayText]);

  const best = top[0];
  const maxP = best ? best.p : 1;
  const thin = names.filter((n) => !sigs.some((s) => s.school === n)).map((n) => markOf(n).word);
  const moves = plan.moves.filter((m) => !m.done).slice(0, 3);
  const corePct = gaps.coreTotal > 0 ? Math.round((gaps.coreDone / gaps.coreTotal) * 100) : 0;

  return (
    <div className="ff-panel ff-panel-wide" data-fx>
      <div className="ff-panel-head">
        <h2>What your file says</h2>
        <p>
          Computed on this device from your profile — no model was called. Every figure below traces
          to the study, your transcript, or your own entries.
        </p>
      </div>

      {/* ── Chances ── */}
      {best && (
        <section className="ff-block" data-fx>
          <div className="ff-block-head">
            <h3>Your chances</h3>
            <p>
              Anchored on each school's official transfer admit rate, then moved by where you sit in
              its observed admitted-GPA distribution. Shown as a band, because a point estimate you
              cannot see the width of is a lie.
            </p>
          </div>

          <div className="ff-hero">
            <span className="ff-hero-label">Strongest position</span>
            <span className="ff-hero-n num g-text">
              {fmtPct(best.lo)}–{fmtPct(best.hi)}%
            </span>
            <span className="ff-hero-sub">
              <Tile name={best.school.name} size={22} /> {best.school.name} · {best.tier}
            </span>
          </div>

          <div className="ff-odds" data-fx data-fx-stagger>
            {top.map((e) => (
              <OddsRow key={e.school.id} e={e} maxP={maxP} />
            ))}
          </div>
          <p className="ff-foot">
            Scored against{" "}
            <span className="num">{MODEL.schools.length}</span> measured schools. Bands widen where
            the observed sample is thin, and a thin row says so.
          </p>
        </section>
      )}

      {/* ── Files like yours ── */}
      <section className="ff-block" data-fx>
        <div className="ff-block-head">
          <h3>Files like yours</h3>
          <p>
            Real recorded applicants — pseudonymous authors from the outcome corpus, carrying the
            schools that took them and the ones that did not. Nothing is generated.
          </p>
        </div>

        <div className="ff-funnel num">
          <span><b>{CORPUS_META.people.toLocaleString()}</b> files scanned</span>
          <i aria-hidden="true">▸</i>
          <span><b>{eligible}</b> inside the window</span>
          <i aria-hidden="true">▸</i>
          <span><b>{matches.length}</b> nearest returned</span>
          <span className="ff-funnel-note num">
            GPA {profile.gpa.toFixed(2)} ±{MATCH_WINDOW.toFixed(2)} · {CORPUS_META.records.toLocaleString()} recorded decisions
          </span>
        </div>

        <div className="ff-matches" data-fx data-fx-stagger>
          {matches.map((m, i) => {
            const d = m.gpa - profile.gpa;
            return (
              <div className="ff-match" key={`${m.gpa}-${m.major}-${m.year}-${i}`}>
                <div className="ff-match-top">
                  <span className="ff-match-i num">{String(i + 1).padStart(2, "0")}</span>
                  <b className="ff-match-gpa num">{m.gpa.toFixed(2)}</b>
                  <span className="ff-match-meta">
                    {m.major}
                    {m.institutionLabel ? ` · ${m.institutionLabel}` : ""} · {m.year}
                  </span>
                  <span className={`ff-match-d num${d > 0 ? " behind" : ""}`}>
                    {d > 0 ? "+" : d < 0 ? "−" : "±"}{Math.abs(d).toFixed(2)}
                  </span>
                </div>
                <div className="ff-ledger">
                  <span className="ff-tag ff-tag-in">IN</span>
                  <span className="ff-ledger-schools">
                    {m.admits.length === 0
                      ? <span className="ff-em num">—</span>
                      : m.admits.map((s) => (
                          <span className="ff-ls" key={s}><Tile name={s} size={16} /> {markOf(s).word}</span>
                        ))}
                  </span>
                </div>
                {m.denies.length > 0 && (
                  <div className="ff-ledger">
                    <span className="ff-tag ff-tag-out">OUT</span>
                    <span className="ff-ledger-schools ff-denied">
                      {m.denies.map((s) => (
                        <span className="ff-ls" key={s}><Tile name={s} size={16} /> {markOf(s).word}</span>
                      ))}
                    </span>
                  </div>
                )}
                {m.sharedTargets.length > 0 && (
                  <p className="ff-match-why">
                    Also applied to {m.sharedTargets.map((s) => markOf(s).word).join(", ")} — same
                    doors as you.
                  </p>
                )}
              </div>
            );
          })}
          {matches.length === 0 && (
            <p className="ff-callout ff-callout-quiet">
              No recorded file sits close enough to yours to call a match. You get the official
              rates and nothing invented.
            </p>
          )}
        </div>

        {sigs.length > 0 && (
          <>
            <p className="ff-sublabel">What admitted files hold at your targets</p>
            <div className="ff-sigs" data-fx data-fx-stagger>
              {sigs.map((s) => {
                const pos = (g: number) => `${Math.min(100, Math.max(0, ((g - 3.2) / 0.8) * 100))}%`;
                return (
                  <div className="ff-sig" key={s.school}>
                    <div className="ff-shot">
                      <CampusPhoto name={s.school} color={markOf(s.school).color} height={104} />
                    </div>
                    <div className="ff-sig-body">
                      <div className="ff-sig-top">
                        <Tile name={s.school} size={24} />
                        <b>{s.school}</b>
                        <span className="ff-sig-n num">n={s.n} observed admits</span>
                      </div>
                      <div className="ff-band" aria-hidden="true">
                        <span
                          className="ff-band-range"
                          style={{ left: pos(s.gpaP25), width: `calc(${pos(s.gpaP75)} - ${pos(s.gpaP25)})` }}
                        />
                        <span className="ff-band-med" style={{ left: pos(s.gpaMedian) }} />
                        <span className="ff-band-you" style={{ left: pos(profile.gpa) }} />
                      </div>
                      <p className="ff-band-axis num" aria-hidden="true">
                        <i>3.20</i><i>3.60</i><i>4.00</i>
                      </p>
                      <p className="ff-sig-line">
                        <span className="num">{s.gpaP25.toFixed(2)}</span>–
                        <span className="num">{s.gpaP75.toFixed(2)}</span>, median{" "}
                        <b className="num">{s.gpaMedian.toFixed(2)}</b> · you{" "}
                        <b className="num ff-mine">{profile.gpa.toFixed(2)}</b>
                      </p>
                      <p className="ff-sig-line">
                        Most-listed majors: <b>{s.topMajors.slice(0, 2).join(", ")}</b>
                      </p>
                      {s.ccShare != null && (
                        <p className="ff-sig-line">
                          <b className="num">{Math.round(s.ccShare * 100)}%</b> from a community
                          college, of the <span className="num">{s.ccKnown}</span> whose school was
                          recorded
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {thin.length > 0 && (
          <p className="ff-foot">
            {thin.join(", ")}: too few observed admits to characterize. You get the official rate
            there, not a number we made up.
          </p>
        )}
      </section>

      {/* ── Coursework ── */}
      <section className="ff-block" data-fx>
        <div className="ff-block-head">
          <h3>Major prep</h3>
          <p>
            Your own course lines matched against the transfer spine for{" "}
            {MAJOR_LABEL[gaps.major]}. We do not ship a catalog per college — course codes differ
            everywhere and a wrong code sends you into the wrong class.
          </p>
        </div>

        {profile.courses.length === 0 ? (
          <p className="ff-callout ff-callout-quiet">
            No courses on file yet. Upload a transcript on step one and this fills itself in.
          </p>
        ) : (
          <>
            <div className="ff-kpi">
              <span className="ff-kpi-label">Core requirements covered</span>
              <span className="ff-kpi-n num g-text">{gaps.coreDone}/{gaps.coreTotal}</span>
              <div className="g-meter ff-kpi-meter" aria-hidden="true">
                <i style={{ width: `${corePct}%` }} />
              </div>
            </div>
            {gaps.missingCore.length > 0 ? (
              <div className="ff-gaps" data-fx data-fx-stagger>
                {gaps.missingCore.map((c) => (
                  <div className="ff-gap" key={c.key}>
                    <span className="ff-gap-label">{c.group}</span>
                    <span className="ff-gap-course">{c.label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="ff-callout">
                Every core requirement on the spine is covered by a course you have listed.
              </p>
            )}
            {gaps.unmatched.length > 0 && (
              <p className="ff-foot">
                <span className="num">{gaps.unmatched.length}</span> course lines we could not
                classify. Usually just unfamiliar titles — not a problem with your record.
              </p>
            )}
          </>
        )}
      </section>

      {/* ── Essay ── */}
      <section className="ff-block" data-fx>
        <div className="ff-block-head">
          <h3>Your "why transfer" essay</h3>
          <p>
            Read for the two things the outcome data shows separate admits: naming real programs,
            and framing the move as fit-and-resources rather than escape.
          </p>
        </div>
        {!hasEssay ? (
          <p className="ff-callout ff-callout-quiet">
            No essay on file. Nothing to read yet — and no verdict, because we will not grade a
            blank. Paste it into the deep review and it gets read line by line.
          </p>
        ) : (
          <>
            <div className="ff-essay">
              <div className="ff-kpi">
                <span className="ff-kpi-label">Length</span>
                <span className="ff-kpi-n num">{essay.words}</span>
                <span className="ff-kpi-unit">words</span>
              </div>
              <div className="ff-kpi">
                <span className="ff-kpi-label">Reads as</span>
                <span className={`ff-verdict ff-v-${essay.verdict}`}>{essay.verdict}</span>
              </div>
              <div className="ff-kpi">
                <span className="ff-kpi-label">Schools named</span>
                <span className="ff-kpi-n num">{essay.namedSchools.length}</span>
                <span className="ff-kpi-unit">
                  {essay.namedSchools.length > 0 ? essay.namedSchools.join(", ") : "none yet"}
                </span>
              </div>
              <div className="ff-kpi">
                <span className="ff-kpi-label">Professors named</span>
                <span className="ff-kpi-n num">{essay.professorMentions}</span>
              </div>
            </div>
            {essay.notes.length > 0 && (
              <ul className="ff-notes">
                {essay.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            )}
          </>
        )}
      </section>

      {/* ── Plan ── */}
      <section className="ff-block" data-fx>
        <div className="ff-block-head">
          <h3>What to do next</h3>
          <p>
            Each lift below is measured, not written: we clone your profile, apply the change, re-run
            the same engine, and report the true difference across your list.
          </p>
        </div>

        {plan.next ? (
          <div className="ff-deadline">
            <span className="ff-deadline-label">Next hard date</span>
            <span className="ff-deadline-n num">{plan.next.days} days</span>
            <span className="ff-deadline-sub">
              {plan.next.school} · {plan.next.label}
              {plan.next.note ? ` — ${plan.next.note}` : ""}
            </span>
          </div>
        ) : (
          <p className="ff-callout ff-callout-quiet">
            No dated deadline on your current list — so we are not going to invent urgency.
          </p>
        )}

        <div className="ff-moves" data-fx data-fx-stagger>
          {moves.map((m) => (
            <div className={`ff-move${m.feasible ? "" : " tight"}`} key={m.id}>
              <div className="ff-move-top">
                <span className="ff-pill ff-pill-tag">{m.tag}</span>
                <span className="ff-move-lift num">{liftLabel(m)}</span>
              </div>
              <p className="ff-move-title">{m.title}</p>
              <p className="ff-move-why">{m.why}</p>
              {m.movers.length > 0 && (
                <div className="ff-movers">
                  {m.movers.map((s) => (
                    <span className="ff-mover" key={s.name}>
                      <Tile name={s.name} size={18} />
                      <span className="num">
                        {fmtPct(s.from)}% → <b>{fmtPct(s.to)}%</b>
                      </span>
                    </span>
                  ))}
                </div>
              )}
              <p className="ff-move-when num">
                {m.feasible
                  ? `Needs ${m.minWeeks} weeks · ${m.weeksLeft} left before ${m.deadlineLabel}`
                  : `Needs ${m.minWeeks} weeks and only ${m.weeksLeft} remain before ${m.deadlineLabel} — this one is for the next cycle`}
              </p>
            </div>
          ))}
        </div>

        {plan.stackedPp >= 0.1 && (
          <p className="ff-stack">
            Every feasible move above, done together, is worth{" "}
            <b className="num">+{plan.stackedPp.toFixed(1)} points</b> across your list. Multipliers
            compound, so that is not the sum of the parts.
          </p>
        )}
      </section>

      {/* ── CTA ── */}
      <section className="ff-cta" data-fx>
        <h3>That is everything this device can work out on its own</h3>
        <p>
          The deep review is the other half: your essay, your activities and your record read line
          by line against the study, with the rewrite next to the original. It is the only part of
          this product that sends anything anywhere.
        </p>
        <div className="ff-cta-row">
          <button type="button" className="btn" onClick={() => go("review")}>
            Open the deep review
          </button>
          <button type="button" className="ff-quiet" onClick={() => go("results")}>
            See the full chances table
          </button>
        </div>
      </section>
    </div>
  );
}

function OddsRow({ e, maxP }: { e: Estimate; maxP: number }) {
  return (
    <div className="ff-odd">
      <span className="ff-odd-school">
        <Tile name={e.school.name} size={26} />
        <span>{e.school.name}</span>
      </span>
      <span className="ff-odd-meterwrap" aria-hidden="true">
        <span className="ff-odd-meter" style={{ width: `${Math.max(2, (e.p / maxP) * 100)}%` }} />
      </span>
      <span className="ff-odd-band num">{fmtPct(e.lo)}–{fmtPct(e.hi)}%</span>
      <span className={`ff-pill ${TIER_CLASS[e.tier]}`}>{e.tier}</span>
      {e.thin && <span className="ff-odd-thin">thin sample</span>}
    </div>
  );
}
