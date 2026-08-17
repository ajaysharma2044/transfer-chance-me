import { useEffect, useMemo, useRef, useState } from "react";
import { estimateAll, fmtPct, MODEL, TAG_CAMPUSES, tagFloor } from "../engine";
import type { Estimate, Profile } from "../engine";
import type { Session } from "../lib/auth";
import { analyzeEssay } from "../lib/essay";
import { analyzeCourses, MAJOR_LABEL as MAJOR_TEXT } from "../lib/coursework";
import { cloudEnabled } from "../lib/supabase";
import { pushDoc } from "../lib/sync";
import ucData from "../data/uc_data.json";
import playbook from "../data/playbook.json";
import Tile from "./Tile";
import Report from "./Report";
import ActionPlan from "./ActionPlan";
import ReaderView from "./ReaderView";
import CourseGaps from "./CourseGaps";
import { buildPlan } from "../lib/actionplan";
import { countdown } from "../lib/deadlines";
import "./portal.css";

// The signed-in home: your file, your chances, the UC block (the single
// biggest destination in this dataset, and the one with its own rules), your
// written material, and a working school list with statuses and notes.

type Status = "planning" | "applied" | "waitlisted" | "accepted" | "rejected";

interface ListEntry {
  school: string;
  status: Status;
  note: string;
}

const LIST_KEY = "tcm.list.v1";
const PROFILE_KEY = "tcm.profile.v1";
/** Shared with Review.tsx — the personal statement lives here. */
const DOCS_KEY = "tcm.appdocs.v1";

const MAJOR_LABEL: Record<string, string> = {
  cs: "Computer science", engineering: "Engineering", business: "Business",
  econ: "Economics", stem: "STEM", social: "Social science",
  humanities: "Humanities", undecided: "Undecided",
};

const STATUS_LABEL: Record<Status, string> = {
  planning: "Planning",
  applied: "Applied",
  waitlisted: "Waitlisted",
  accepted: "Accepted",
  rejected: "Rejected",
};

function loadList(): ListEntry[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ListEntry[]) : [];
  } catch {
    return [];
  }
}

/* ── UC data ──────────────────────────────────────────────────────────────
   Everything below reads src/data/uc_data.json (official UC transfer-admit
   data) and the engine's own output. No UC figure on this page is written by
   hand: rates, applicant/admit counts, cycles, CC shares and TAG floors all
   come out of that file or out of model.json via MODEL/estimateAll.        */

interface UcCampusData {
  rate: number;
  applicants: number;
  admitted: number;
  gpaP25: number | null;
  gpaP75: number | null;
  cycle: string;
  ccNote: string;
}

const UC_JSON = ucData as unknown as {
  campuses: Record<string, UcCampusData>;
  tag: {
    campuses: string[];
    minGpa: Record<string, number>;
    minGpaNotes: Record<string, string>;
  };
};

/** The UC campuses this app actually measures. Berkeley and UCLA come from
 *  model.json (their own CDS/UC admit data); the rest from uc_data.json. */
const UC_NAMES: string[] = ["UC Berkeley", "UCLA", ...Object.keys(UC_JSON.campuses)]
  .filter((n, i, all) => all.indexOf(n) === i)
  .filter((n) => MODEL.schools.some((s) => s.name === n));

/** The CC share UC publishes for a campus, read off its own note. */
function ccShare(note: string | undefined): number | null {
  const m = note?.match(/(\d+(?:\.\d+)?)%/);
  return m ? Number(m[1]) : null;
}

const CC_SHARES: number[] = Object.values(UC_JSON.campuses)
  .map((c) => ccShare(c.ccNote))
  .filter((n): n is number => n != null);
const CC_MIN = CC_SHARES.length ? Math.min(...CC_SHARES) : null;
const CC_MAX = CC_SHARES.length ? Math.max(...CC_SHARES) : null;

interface PlaybookItem { id: string; title: string; steps: string[]; why: string }
const PLAYBOOK = playbook as unknown as PlaybookItem[];
const pbTitle = (id: string): string | null => PLAYBOOK.find((p) => p.id === id)?.title ?? null;

/** "a, b and c" — for reading a list of criteria out in a sentence. */
function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Days until the next occurrence of a fixed calendar date — the same
 *  next-occurrence rule countdown() uses for school deadlines. */
function daysUntil(month: number, day: number, from = new Date()): number {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let next = new Date(today.getFullYear(), month - 1, day);
  if (next < today) next = new Date(today.getFullYear() + 1, month - 1, day);
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

interface UcRow { name: string; est: Estimate; uc: UcCampusData | null }

function UcSection({
  profile, ests, go,
}: { profile: Profile; ests: Estimate[]; go: (route: string) => void }) {
  const rows = useMemo<UcRow[]>(() => {
    const byName = new Map(ests.map((e) => [e.school.name, e]));
    const out: UcRow[] = [];
    for (const name of UC_NAMES) {
      const est = byName.get(name);
      if (!est) continue;
      out.push({ name, est, uc: UC_JSON.campuses[name] ?? null });
    }
    return out.sort((a, b) => b.est.p - a.est.p);
  }, [ests]);

  const gaps = useMemo(() => analyzeCourses(profile), [profile]);
  const essay = useMemo(
    () => (profile.essayText.trim() ? analyzeEssay(profile.essayText) : null),
    [profile.essayText],
  );

  if (rows.length === 0) return null;

  // ── TAG: the engine's own three structural gates, shown one by one ──
  const gates = [
    { ok: profile.institution === "cc", label: "Enrolled at a community college", miss: "community college enrollment" },
    { ok: profile.caResident, label: "California resident", miss: "California residency" },
    { ok: profile.standing === "junior", label: "Entering at junior standing", miss: "junior-standing entry" },
  ];
  const gatesOk = gates.every((g) => g.ok);
  // Floors for THIS applicant's major, not the campus-wide minimum — see
  // tagFloor() in engine.ts. Showing the campus figure here contradicted the
  // odds the engine printed on the same screen.
  const floors = Object.keys(TAG_CAMPUSES)
    .map((c) => [c, tagFloor(c, profile.major) ?? 9] as [string, number])
    .sort((a, b) => a[1] - b[1]);
  const cleared = floors.filter(([, min]) => profile.gpa >= min);
  const lowest = floors[0] ?? null;

  const tagDays = daysUntil(9, 30);
  const wall = countdown(rows[0].name);
  const ucNamed = essay ? essay.namedSchools.filter((n) => UC_NAMES.includes(n)) : [];

  const tagStep = pbTitle("file-uc-tag-by-sep-30");
  const assistStep = pbTitle("close-major-prep-gaps-on-assist");
  const piqStep = pbTitle("draft-uc-piqs-before-nov-30");

  return (
    <section className="po-uc" aria-labelledby="po-uc-h">
      <header className="po-uc-head">
        <div className="po-uc-headtext">
          <span className="po-uc-eyebrow">The biggest transfer destination in this dataset</span>
          <h2 id="po-uc-h">The University of California</h2>
          <p>
            {rows.length} campuses on one application, one November 30 wall, and the only contractual
            admission guarantee anywhere in this data.
            {CC_MIN != null && CC_MAX != null && (
              <> Across the {CC_SHARES.length} campuses UC publishes a feeder breakdown for,{" "}
                <b className="num">{CC_MIN}%–{CC_MAX}%</b> of admitted transfers came from California
                community colleges.</>
            )}
          </p>
        </div>
        <div className="po-uc-clocks">
          <div className={`po-uc-clock${tagDays <= 45 ? " soon" : ""}`}>
            <b className="num">{tagDays}</b>
            <span>days to TAG · Sep 30</span>
          </div>
          {wall && (
            <div className={`po-uc-clock${wall.days <= 45 ? " soon" : ""}`}>
              <b className="num">{wall.days}</b>
              <span>days to the UC application · {wall.label}</span>
            </div>
          )}
        </div>
      </header>

      <div className="po-uc-cols" aria-hidden="true">
        <span>Campus</span>
        <span>Official transfer rate</span>
        <span>From CA CCs</span>
        <span>TAG floor</span>
        <span>Your odds</span>
      </div>

      <ul className="po-uc-list">
        {rows.map(({ name, est, uc }) => {
          const min = tagFloor(name, profile.major);
          const share = uc ? ccShare(uc.ccNote) : null;
          const met = min != null && gatesOk && profile.gpa >= min;
          return (
            <li key={name} className={est.tier === "TAG guarantee" ? "tagged" : ""}>
              <button
                type="button"
                className="po-uc-row"
                onClick={() => go(`schools/${est.school.id}`)}
              >
                <span className="po-uc-campus">
                  <Tile name={name} size={26} />
                  <span>
                    <b>{name}</b>
                    <i>{est.school.cycle}</i>
                  </span>
                </span>
                <span className="po-uc-rate">
                  <b className="num">{est.school.rate.toFixed(1)}%</b>
                  {est.school.admitted != null && est.school.applicants != null && (
                    <i className="num">
                      {est.school.admitted.toLocaleString()} of {est.school.applicants.toLocaleString()} admitted
                    </i>
                  )}
                </span>
                <span className="po-uc-cc num">
                  {share != null
                    ? <>{share}%<i> of admits from CA community colleges</i></>
                    : "—"}
                </span>
                <span className={`po-uc-tagcell${met ? " met" : ""}`}>
                  {min != null ? (
                    <>
                      <em aria-hidden="true">{met ? "✓" : "·"}</em>
                      <span className="num">{min.toFixed(1)}</span>
                    </>
                  ) : (
                    <i>no TAG</i>
                  )}
                </span>
                <span className="po-uc-odds">
                  <b className="num">{fmtPct(est.lo)}–{fmtPct(est.hi)}%</b>
                  <i>{est.tier}</i>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="po-uc-panels">
        <article className="po-uc-panel">
          <h3>Transfer Admission Guarantee</h3>
          {gatesOk && cleared.length > 0 ? (
            <p className="po-uc-lead">
              Your <b className="num">{profile.gpa.toFixed(2)}</b> clears the published floor at{" "}
              <b>{cleared.length} of {floors.length}</b> TAG campuses. You may file exactly one, by
              September 30 — and it voids unless the regular UC application follows by November 30.
            </p>
          ) : gatesOk ? (
            <p className="po-uc-lead">
              Your <b className="num">{profile.gpa.toFixed(2)}</b> is below every published TAG floor
              {lowest && <> — the lowest is {lowest[0]} at <b className="num">{lowest[1].toFixed(1)}</b></>}.
              Without the guarantee these campuses read your file competitively, like the rest.
            </p>
          ) : (
            <p className="po-uc-lead">
              TAG is a California community college program for junior-entry transfers. Your file is
              missing {joinList(gates.filter((g) => !g.ok).map((g) => g.miss))}, so the guarantee
              isn't on the table and the TAG campuses read your application competitively, like the rest.
            </p>
          )}

          <ul className="po-uc-gates">
            {gates.map((g) => (
              <li key={g.label} className={g.ok ? "ok" : "no"}>
                <span aria-hidden="true">{g.ok ? "✓" : "○"}</span>
                {g.label}
              </li>
            ))}
          </ul>

          <ul className="po-uc-floors">
            {floors.map(([campus, min]) => {
              const clear = gatesOk && profile.gpa >= min;
              return (
                <li key={campus} className={clear ? "clear" : ""}>
                  <span className="po-uc-floor-name">{campus}</span>
                  <span className="po-uc-floor-min num">{min.toFixed(1)}</span>
                  {clear && UC_JSON.tag.minGpaNotes[campus] && (
                    <i>{UC_JSON.tag.minGpaNotes[campus]}</i>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="po-uc-fine">{UC_JSON.tag.minGpaNotes.source}</p>
          {tagStep && <p className="po-uc-step">In your plan below: <b>{tagStep}</b></p>}
        </article>

        <article className="po-uc-panel">
          <h3>Major prep, the way ASSIST checks it</h3>
          {profile.courses.length === 0 ? (
            <>
              <p className="po-uc-lead">
                No courses on your file yet, so there is nothing to check against your major's
                articulation.
              </p>
              <button type="button" className="btn btn-sm" onClick={() => go("check")}>
                Add my courses
              </button>
            </>
          ) : (
            <>
              <p className="po-uc-lead">
                <b className="num">{gaps.coreDone} of {gaps.coreTotal}</b> lower-division requirements
                for {MAJOR_TEXT[profile.major]} are covered by the courses on your file.
              </p>
              {gaps.missingCore.length > 0 ? (
                <ul className="po-uc-gaps">
                  {gaps.missingCore.slice(0, 6).map((m) => <li key={m.key}>{m.label}</li>)}
                </ul>
              ) : (
                <p className="po-uc-ok">Nothing open in the core sequence.</p>
              )}
            </>
          )}
          <p className="po-uc-igetc">
            IGETC: <b>{profile.igetc ? "complete on your file" : "not marked complete"}</b>
          </p>
          <p className="po-uc-fine">
            Matched against the standard lower-division transfer spine, not any one campus's catalog.
            ASSIST.org is the authority: set your college as sending and each UC as receiving, open
            your exact major's agreement, and check it line by line.
          </p>
          {assistStep && <p className="po-uc-step">In your plan below: <b>{assistStep}</b></p>}
        </article>

        <article className="po-uc-panel">
          <h3>Personal insight questions</h3>
          {essay ? (
            <p className="po-uc-lead">
              Your "why transfer" draft runs <b className="num">{essay.words}</b> words and{" "}
              {ucNamed.length > 0
                ? <>names <b>{ucNamed.join(", ")}</b></>
                : <>names no UC campus specifically</>}.
            </p>
          ) : (
            <p className="po-uc-lead">
              No "why transfer" draft on file yet — it goes in Your writing, below.
            </p>
          )}
          {essay?.verdict === "complaint" && (
            <p className="po-uc-warn">
              It reads complaint-shaped ({essay.complaintScore} complaint signals against{" "}
              {essay.fitScore} fit signals). Cut every sentence that criticises your current college.
            </p>
          )}
          <p className="po-uc-body">
            UC reads no per-campus essay. The same four PIQs go to every campus, so the school-specific
            paragraph that earns credit at the privates has nowhere to live here — the course evidence
            goes into the transfer prompt instead.
          </p>
          {wall?.note && <p className="po-uc-fine">{wall.note}. No late round.</p>}
          {piqStep && <p className="po-uc-step">In your plan below: <b>{piqStep}</b></p>}
        </article>
      </div>
    </section>
  );
}

/* ── The written material ─────────────────────────────────────────────── */

interface Writing {
  essay: string;
  statement: string;
  activities: string;
  awards: string;
}

function loadStatement(): string {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { statement?: unknown };
    return typeof parsed?.statement === "string" ? parsed.statement : "";
  } catch {
    return "";
  }
}

/** Write the statement back without disturbing the rest of that record —
 *  Review.tsx owns this key too. */
function saveStatement(statement: string): void {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(DOCS_KEY, JSON.stringify({ ...parsed, statement }));
  } catch { /* a blocked or full store is not worth breaking the page over */ }
}

/** The written fields as they sit in storage. The app shell writes this key on
 *  every profile change and so does a save here, so on a remount within one
 *  session it can be fresher than the profile prop (it is identical to it on a
 *  fresh load). Missing or unreadable fields fall back to the prop. */
function storedWriting(): Partial<Omit<Writing, "statement">> {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Partial<Profile>;
    return {
      ...(typeof p.essayText === "string" ? { essay: p.essayText } : {}),
      ...(typeof p.activitiesText === "string" ? { activities: p.activitiesText } : {}),
      ...(typeof p.awardsText === "string" ? { awards: p.awardsText } : {}),
    };
  } catch {
    return {};
  }
}

/** Merge written material into the stored profile. Only used when no onChange
 *  handler is wired in — with one, the app shell owns the write. */
function mergeStoredProfile(patch: Partial<Profile>): void {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...stored, ...patch }));
  } catch { /* same */ }
}

function lineCount(s: string): number {
  return s.split("\n").filter((l) => l.trim()).length;
}

function WritingSection({
  profile, onChange, go,
}: { profile: Profile; onChange?: (p: Profile) => void; go: (route: string) => void }) {
  const initialWriting = (): Writing => {
    const stored = storedWriting();
    return {
      essay: stored.essay ?? profile.essayText,
      statement: loadStatement(),
      activities: stored.activities ?? profile.activitiesText,
      awards: stored.awards ?? profile.awardsText,
    };
  };
  const [draft, setDraft] = useState<Writing>(initialWriting);
  const [base, setBase] = useState<Writing>(draft);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    draft.essay !== base.essay ||
    draft.statement !== base.statement ||
    draft.activities !== base.activities ||
    draft.awards !== base.awards;

  // The account copy can land after this page has rendered (the shell pulls it
  // on sign-in). Adopt it when it *changes* — comparing against the last props
  // we saw, not against our own draft: with no onChange wired the prop stays on
  // the pre-edit text after a save, and comparing to the draft would revert the
  // box to the older version. Unsaved edits are never overwritten either way.
  const lastSeen = useRef<Omit<Writing, "statement">>({
    essay: profile.essayText,
    activities: profile.activitiesText,
    awards: profile.awardsText,
  });
  useEffect(() => {
    const incoming = {
      essay: profile.essayText,
      activities: profile.activitiesText,
      awards: profile.awardsText,
    };
    const prev = lastSeen.current;
    if (
      prev.essay === incoming.essay &&
      prev.activities === incoming.activities &&
      prev.awards === incoming.awards
    ) return;
    lastSeen.current = incoming;
    if (dirty) return;
    setBase((b) => ({ ...b, ...incoming }));
    setDraft((d) => ({ ...d, ...incoming }));
  }, [profile.essayText, profile.activitiesText, profile.awardsText, dirty]);

  const essay = useMemo(
    () => (draft.essay.trim() ? analyzeEssay(draft.essay) : null),
    [draft.essay],
  );
  const statement = useMemo(
    () => (draft.statement.trim() ? analyzeEssay(draft.statement) : null),
    [draft.statement],
  );

  const set = (k: keyof Writing, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    const snapshot = draft;

    // 1. This device. Re-derive the essay analysis so the engine scores the
    //    edit exactly the way the intake would have.
    const a = snapshot.essay.trim() ? analyzeEssay(snapshot.essay) : null;
    const patch: Partial<Profile> = {
      essayText: snapshot.essay,
      essayNamed: a ? a.namedSchools : [],
      essayVerdict: a ? a.verdict : null,
      activitiesText: snapshot.activities,
      awardsText: snapshot.awards,
    };
    if (onChange) onChange({ ...profile, ...patch });
    else mergeStoredProfile(patch);
    saveStatement(snapshot.statement);

    // 2. Their account. pushDoc no-ops when signed out or with no backend
    //    configured, and drops empty content rather than storing blanks.
    const jobs: Promise<void>[] = [];
    if (snapshot.essay !== base.essay) jobs.push(pushDoc("essay", snapshot.essay));
    if (snapshot.statement !== base.statement) jobs.push(pushDoc("statement", snapshot.statement));
    if (snapshot.activities !== base.activities) jobs.push(pushDoc("activities", snapshot.activities));
    if (snapshot.awards !== base.awards) jobs.push(pushDoc("awards", snapshot.awards));

    try {
      await Promise.all(jobs);
      setBase(snapshot);
      setSavedAt(Date.now());
    } catch (e) {
      // The device copy is already written; say so rather than implying loss.
      setError(e instanceof Error ? e.message : "Couldn't reach your account.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="po-write" id="po-write" aria-labelledby="po-write-h">
      <div className="po-card-head">
        <h2 id="po-write-h">Your writing</h2>
        <button type="button" className="btn-quiet" onClick={() => go("review")}>
          Send to deep review →
        </button>
      </div>
      <p className="po-write-dek">
        The essay, statement and lists your application is actually made of. Edit them here — the same
        check that scores your essay runs as you type, and Save writes the result back to your file.
      </p>

      <div className="po-doc">
        <label htmlFor="po-essay">Why transfer</label>
        <textarea
          id="po-essay"
          rows={10}
          placeholder="Paste your 'why transfer' essay. We check it for the things admits' essays actually do — naming programs, courses and faculty, and framing the move as fit rather than escape."
          value={draft.essay}
          onChange={(e) => set("essay", e.target.value)}
        />
        {essay ? (
          <div className="essay-report">
            <p className="essay-line">
              <b className="num">{essay.words}</b> words
              {" · "}
              {essay.namedSchools.length > 0
                ? <>school-specific for <b>{essay.namedSchools.join(", ")}</b></>
                : <>no school named specifically yet</>}
              {essay.professorMentions > 0 && (
                <> · {essay.professorMentions} professor{essay.professorMentions > 1 ? "s" : ""} named</>
              )}
              {" · verdict: "}<b>{essay.verdict}</b>
            </p>
            {essay.verdict === "complaint" && (
              <p className="essay-note warn">
                Reads complaint-shaped ({essay.complaintScore} complaint signals vs {essay.fitScore} fit
                signals). Admits frame the move around what the target offers, not what your school lacks.
              </p>
            )}
            {essay.notes.filter((n) => !n.startsWith("Reads complaint")).map((n) => (
              <p key={n} className="essay-note">{n}</p>
            ))}
            {essay.namedSchools.length > 0 && essay.verdict !== "complaint" && (
              <p className="essay-note ok">
                Schools you name get the specificity credit in your chances; the rest read this essay as general.
              </p>
            )}
          </div>
        ) : (
          <p className="po-write-hint">
            Nothing here yet. This is the single biggest lever still on the table in your estimate.
          </p>
        )}
      </div>

      <div className="po-doc">
        <label htmlFor="po-statement">Personal statement</label>
        <textarea
          id="po-statement"
          rows={8}
          placeholder="Paste your personal statement if your targets require one. Several schools ask for this instead of, or alongside, the 'why transfer' essay."
          value={draft.statement}
          onChange={(e) => set("statement", e.target.value)}
        />
        {statement && (
          <div className="essay-report">
            <p className="essay-line">
              <b className="num">{statement.words}</b> words
              {" · "}
              {statement.namedSchools.length > 0
                ? <>names <b>{statement.namedSchools.join(", ")}</b></>
                : <>names no school specifically</>}
            </p>
            {statement.verdict === "complaint" && (
              <p className="essay-note warn">
                Reads complaint-shaped — the same check that runs on your essay, run on this.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="po-doc-pair">
        <div className="po-doc">
          <label htmlFor="po-activities">Activities</label>
          <textarea
            id="po-activities"
            rows={6}
            placeholder={"Tutor, campus learning center — 6 hrs/week\nPresident, CS club — ran 4 workshops\nJob: 20 hrs/week while enrolled"}
            value={draft.activities}
            onChange={(e) => set("activities", e.target.value)}
          />
          <p className="po-write-hint">
            {lineCount(draft.activities)} {lineCount(draft.activities) === 1 ? "entry" : "entries"} — pattern
            beats prestige; campus-anchored involvement is what recurs in admit files.
          </p>
        </div>
        <div className="po-doc">
          <label htmlFor="po-awards">Awards &amp; honors</label>
          <textarea
            id="po-awards"
            rows={6}
            placeholder={"Dean's List (3 semesters)\nPhi Theta Kappa\nHackathon finalist, 2025"}
            value={draft.awards}
            onChange={(e) => set("awards", e.target.value)}
          />
          <p className="po-write-hint">
            {lineCount(draft.awards)} {lineCount(draft.awards) === 1 ? "entry" : "entries"} on file.
          </p>
        </div>
      </div>

      <div className="po-write-foot">
        <button type="button" className="btn btn-sm" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        <span className={`po-write-state${error ? " bad" : ""}`}>
          {error
            ? `${error} Your writing is saved on this device.`
            : saving
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : savedAt
                  ? cloudEnabled ? "Saved to your account" : "Saved in this browser"
                  : ""}
        </span>
      </div>
      <p className="po-write-note">
        {cloudEnabled
          ? "Saved writing is stored against your account and readable only by you; the copy on this device stays too."
          : "This build has no backend configured, so your writing stays in this browser."}
      </p>
    </section>
  );
}

interface Props {
  session: Session | null;
  profile: Profile;
  go: (route: string) => void;
  /** Optional: when the app shell passes it, edits made here update the live
   *  profile immediately. Without it the portal writes straight to storage. */
  onChange?: (p: Profile) => void;
}

export default function Portal({ session, profile, go, onChange }: Props) {
  const [list, setList] = useState<ListEntry[]>(loadList);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  }, [list]);

  if (!session) {
    return (
      <div className="shell po-gate">
        <h1>Your portal</h1>
        <p>Log in to track your school list, statuses, and progress in one place.</p>
        <button type="button" className="btn" onClick={() => go("login")}>Log in</button>
      </div>
    );
  }

  const ests = estimateAll(profile);
  const byName = new Map(ests.map((e) => [e.school.name, e]));
  const listed = new Set(list.map((l) => l.school));
  const targets = ests.filter((e) => e.p >= 0.12).length;
  const plan = buildPlan(profile, ests);
  const nextDue = plan.next;
  const openMoves = plan.moves.filter((m) => !m.done).length;
  const firstName = (session.name || session.email).split(" ")[0];

  const setEntry = (school: string, patch: Partial<ListEntry>) =>
    setList((ls) => ls.map((l) => (l.school === school ? { ...l, ...patch } : l)));

  return (
    <div className="shell po">
      <header className="po-head">
        <div>
          <h1>Welcome back, {firstName}</h1>
          <p className="po-sub">
            Target odds or better at <b>{targets} of {ests.length}</b> schools with your current file.
          </p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => window.print()}>Download report</button>
      </header>

      <div className="po-stats">
        <div className="po-stat">
          <b className="num">{fmtPct(ests[0].lo)}–{fmtPct(ests[0].hi)}%</b>
          <span>your best position · {ests[0].school.name}</span>
        </div>
        <div className="po-stat">
          <b className="num">{targets}</b>
          <span>schools at target odds or better</span>
        </div>
        <div className={`po-stat${nextDue && nextDue.days <= 45 ? " urgent" : ""}`}>
          <b className="num">{nextDue ? nextDue.days : "—"}</b>
          <span>{nextDue ? `days to ${nextDue.school} (${nextDue.label})` : "no deadlines tracked"}</span>
        </div>
        <div className="po-stat">
          <b className="num">{openMoves}</b>
          <span>moves open on your file</span>
        </div>
      </div>

      <section className="po-planwrap">
        <UcSection profile={profile} ests={ests} go={go} />
      </section>

      <section className="po-planwrap">
        <ReaderView profile={profile} ests={ests} />
      </section>

      <section className="po-planwrap">
        <ActionPlan profile={profile} ests={ests} />
      </section>

      <section className="po-planwrap">
        <CourseGaps profile={profile} onEdit={() => go("check")} />
      </section>

      <section className="po-planwrap">
        <WritingSection profile={profile} onChange={onChange} go={go} />
      </section>

      <div className="po-grid">
        <section className="po-card">
          <div className="po-card-head">
            <h2>Your file</h2>
            <button type="button" className="btn-quiet" onClick={() => go("check")}>Edit</button>
          </div>
          <dl className="po-kv">
            <div><dt>GPA</dt><dd className="num">{profile.gpa.toFixed(2)}</dd></div>
            <div><dt>School</dt><dd>{profile.schoolName ?? { cc: "Community college", public4: "4-year public", private4: "4-year private" }[profile.institution]}</dd></div>
            <div><dt>Entering as</dt><dd>{profile.standing}</dd></div>
            <div><dt>Major</dt><dd>{MAJOR_LABEL[profile.major] ?? profile.major}</dd></div>
            {profile.sat != null && <div><dt>SAT</dt><dd className="num">{profile.sat}</dd></div>}
          </dl>
        </section>

        <section className="po-card">
          <div className="po-card-head">
            <h2>Best positions</h2>
            <button type="button" className="btn-quiet" onClick={() => go("results")}>All {ests.length} →</button>
          </div>
          <ul className="po-best">
            {ests.slice(0, 5).map((e) => (
              <li key={e.school.id}>
                <button type="button" className="po-best-row" onClick={() => go(`schools/${e.school.id}`)}>
                  <Tile name={e.school.name} size={24} />
                  <span className="po-best-name">{e.school.name}</span>
                  <span className="po-best-band num">{fmtPct(e.lo)}–{fmtPct(e.hi)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="po-card">
          <div className="po-card-head">
            <h2>Timeline</h2>
          </div>
          <ul className="po-clock">
            {(list.length > 0 ? list.map((l) => l.school) : ests.slice(0, 5).map((e) => e.school.name))
              .map((name) => ({ name, cd: countdown(name) }))
              .filter((x) => x.cd)
              .sort((a, b) => a.cd!.days - b.cd!.days)
              .slice(0, 6)
              .map(({ name, cd }) => (
                <li key={name} className={cd!.days <= 45 ? "po-clock-soon" : ""}>
                  <span className="po-clock-school"><Tile name={name} size={20} /> {name}</span>
                  <span className="po-clock-when">{cd!.label}</span>
                  <span className="po-clock-days num">{cd!.days}d</span>
                </li>
              ))}
          </ul>
          <p className="po-clock-note">Typical fall-transfer deadlines — always verify on the school's site.</p>
        </section>

        <section className="po-card">
          <div className="po-card-head">
            <h2>Documents</h2>
            <button type="button" className="btn-quiet" onClick={() => go("check")}>Upload</button>
          </div>
          {profile.docs.length > 0 ? (
            <div className="chipset">
              {profile.docs.map((d) => <span key={d} className="chip">{d}</span>)}
              {profile.courses.length > 0 && <span className="chip">{profile.courses.length} courses read</span>}
            </div>
          ) : (
            <p className="po-body po-empty">Drop in a transcript or Common App PDF — parsed on your device, never uploaded.</p>
          )}
        </section>
      </div>

      <section className="po-list">
        <div className="po-card-head">
          <h2>My schools</h2>
          <button type="button" className="btn btn-sm" onClick={() => setAdding((a) => !a)}>
            {adding ? "Done" : "+ Add schools"}
          </button>
        </div>

        {adding && (
          <div className="po-addwall">
            {MODEL.schools.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip po-add"
                aria-pressed={listed.has(s.name)}
                onClick={() =>
                  listed.has(s.name)
                    ? setList((ls) => ls.filter((l) => l.school !== s.name))
                    : setList((ls) => [...ls, { school: s.name, status: "planning", note: "" }])
                }
              >
                <Tile name={s.name} size={18} />
                {s.name}
                <i className="po-add-rate">{s.rate.toFixed(0)}%</i>
              </button>
            ))}
          </div>
        )}

        {list.length === 0 && !adding && (
          <p className="po-body po-empty">No schools on your list yet. Add the ones you're targeting to track statuses and notes.</p>
        )}

        {list.map((l) => {
          const e = byName.get(l.school);
          const id = e?.school.id;
          return (
            <div className="po-row" key={l.school}>
              <button type="button" className="po-row-school" onClick={() => id && go(`schools/${id}`)}>
                <Tile name={l.school} size={28} />
                <span>
                  <span className="po-row-name">{l.school}</span>
                  {e && <span className="po-row-band num">{fmtPct(e.lo)}–{fmtPct(e.hi)}% · {e.tier}</span>}
                </span>
              </button>
              <select
                aria-label={`Status for ${l.school}`}
                className={`po-status po-${l.status}`}
                value={l.status}
                onChange={(ev) => setEntry(l.school, { status: ev.target.value as Status })}
              >
                {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
              <input
                type="text"
                className="po-note"
                placeholder="Notes — deadline, portal login, who's writing recs…"
                value={l.note}
                onChange={(ev) => setEntry(l.school, { note: ev.target.value })}
              />
              <button
                type="button"
                className="po-remove"
                aria-label={`Remove ${l.school}`}
                onClick={() => setList((ls) => ls.filter((x) => x.school !== l.school))}
              >×</button>
            </div>
          );
        })}
      </section>

      <Report profile={profile} ests={ests} date={new Date().toLocaleDateString()} />
    </div>
  );
}
