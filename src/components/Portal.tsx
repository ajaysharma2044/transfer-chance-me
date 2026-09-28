import { useEffect, useMemo, useRef, useState } from "react";
import { estimateAll, fmtPct, MODEL, TAG_CAMPUSES, tagFloor } from "../engine";
import type { Estimate, Profile } from "../engine";
import type { Session } from "../lib/auth";
import { analyzeEssay } from "../lib/essay";
import type { EssayAnalysis } from "../lib/essay";
import { analyzeCourses, MAJOR_LABEL as MAJOR_TEXT } from "../lib/coursework";
import type { CourseGaps as CourseGapsResult } from "../lib/coursework";
import { cloudEnabled } from "../lib/supabase";
import { pullProfile, pushDoc, pushSchools } from "../lib/sync";
import { dispatchListChanged } from "../lib/listEvents";
import ucData from "../data/uc_data.json";
import Tile from "./Tile";
import CampusPhoto from "./CampusPhoto";
import Report from "./Report";
import ActionPlan from "./ActionPlan";
import CourseGaps from "./CourseGaps";
import { buildPlan, liftLabel } from "../lib/actionplan";
import type { Plan, PlannedMove } from "../lib/actionplan";
import { countdown, DEADLINES } from "../lib/deadlines";
import { admitBand, bandPos, BAND_MAX, BAND_MIN } from "../lib/band";
import type { AdmitBand } from "../lib/band";
import { blockerFor } from "../lib/blockers";
import type { Blocker } from "../lib/blockers";
import { readerSheet } from "../lib/reader";
import { useCountUp, useInView } from "../lib/reveal";
import { markOf } from "../lib/schools";
import {
  admitSignature, admitSignatures, CORPUS_META, countEligible, findSimilar, MATCH_WINDOW,
} from "../lib/similar";
import "./portal.css";

// Portal v2 — the cockpit-ledger.
//
// The dashboard is an instrument panel over a working ledger of schools, not a
// document about the file. The rule that generated every line below: a sentence
// whose job is to report a value becomes the value plus the scale it is read
// against; a sentence whose job is to caveat becomes a permanent uppercase
// micro-label (never behind disclosure — this product's position is that it
// does not invent numbers, so the caveats are load-bearing); a sentence whose
// job is to say what is wrong at one school becomes a chip in that school's
// ledger row. Everything else is deleted or goes behind <details>.
//
// Every figure names the function it reads. Nothing here is written by hand.

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

const INSTITUTION_LABEL: Record<Profile["institution"], string> = {
  cc: "Community college", public4: "4-year public", private4: "4-year private",
};

const STATUS_LABEL: Record<Status, string> = {
  planning: "Planning",
  applied: "Applied",
  waitlisted: "Waitlisted",
  accepted: "Accepted",
  rejected: "Rejected",
};

const SIGNAL_LABEL: Record<string, string> = {
  strong: "strong", solid: "solid", thin: "thin", gap: "gap",
};

const fmt = (n: number): string => n.toLocaleString();

/** n=4,243 admitted files. MODEL.meta.admits, never a literal — engine.ts
 *  mutates MODEL.meta.schools to 208, so meta is read field by field. */
const ADMIT_FILES = Number(MODEL.meta.admits);

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

/** How many of the 208 measured schools have an admitted-GPA band at all.
 *  Counted once, lazily: admitBand() walks the corpus, and the answer cannot
 *  change inside a session. The ledger footer prints it so 167 blank tracks
 *  read as honesty rather than breakage. */
let BANDED_TOTAL: number | null = null;
function bandedTotal(): number {
  if (BANDED_TOTAL == null) {
    BANDED_TOTAL = MODEL.schools.filter((s) => admitBand(s).kind !== "none").length;
  }
  return BANDED_TOTAL;
}

/** Days until the next occurrence of a fixed calendar date — the same
 *  next-occurrence rule countdown() uses for school deadlines. */
function daysUntil(month: number, day: number, from = new Date()): number {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let next = new Date(today.getFullYear(), month - 1, day);
  if (next < today) next = new Date(today.getFullYear() + 1, month - 1, day);
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/** Enough of the name to read inside a tick label or a chip. */
function shortCampus(name: string): string {
  return name.replace(/^UC /, "").replace(/^University of /, "");
}

/* ── 3.1 · the hero ────────────────────────────────────────────────────────
   One premium block in place of the four dense strips this replaced (status
   bar, file line, two gauges, funnel). Same figures, same sources — the only
   thing that changed is that the page now opens on the number the reader came
   for, at a size worth reading, over their top school's campus.

   The numbers count up as they arrive. `useCountUp` resolves to the exact
   value, so nothing here can display a tween artefact as a real estimate. */

function PortalHero({
  profile, best, plan, atTarget, tracked, blocked, go, onAdd,
}: {
  profile: Profile; best: Estimate | null; plan: Plan;
  atTarget: number; tracked: number; blocked: number;
  go: (r: string) => void;
  /** Called when the empty-state CTA is clicked — opens the add-school picker. */
  onAdd: () => void;
}) {
  const [ref, seen] = useInView<HTMLElement>();

  const next = plan.next;
  const days = useCountUp(next?.days ?? 0, seen);
  const trend = profile.gpaTrend === "upward" ? "↗" : profile.gpaTrend === "downward" ? "↘" : "";

  return (
    <header className={`po-hero${best ? " g-wash" : " po-hero-empty"}`} ref={ref}>
      {best && (
        <div className="po-hero-photo" aria-hidden="true">
          <CampusPhoto name={best.school.name} height={340} />
        </div>
      )}

      <div className="po-hero-body">
        {best ? (
          <>
            <p className="po-hero-eyebrow">
              <Tile name={best.school.name} size={20} />
              Strongest position · {best.school.name}
            </p>

            <p className="po-hero-fig">
              <b className={`num g-text po-hero-num${seen ? " in" : ""}`}>
                {fmtPct(best.lo)}–{fmtPct(best.hi)}%
              </b>
              <span className="po-hero-tier">{best.tier}</span>
            </p>
          </>
        ) : (
          <>
            <p className="po-hero-eyebrow">Your portal</p>
            <p className="po-hero-fig">
              <b className="g-text po-hero-num in">Add your target schools</b>
              <span className="po-hero-tier">
                Odds appear once you pick where you want to transfer.
              </span>
            </p>
          </>
        )}

        <dl className="po-hero-id">
          <div><dt>GPA</dt><dd className="num">{profile.gpa.toFixed(2)}{trend}</dd></div>
          <div><dt>At</dt><dd>{profile.schoolName ?? INSTITUTION_LABEL[profile.institution]}</dd></div>
          <div><dt>Major</dt><dd>{MAJOR_LABEL[profile.major] ?? profile.major}</dd></div>
          <div><dt>Entering</dt><dd>{profile.standing}</dd></div>
        </dl>

        <ul className="po-hero-creds">
          <li className={profile.igetc ? "on" : ""}>IGETC</li>
          <li className={profile.ptk ? "on" : ""}>PTK</li>
          <li className={profile.honors ? "on" : ""}>Honors</li>
          {profile.sat != null && <li className="on num">SAT {profile.sat}</li>}
          <li className={profile.docs.length ? "on num" : "num"}>
            {profile.docs.length
              ? `${profile.docs.length} doc${profile.docs.length > 1 ? "s" : ""} · ${profile.courses.length} courses`
              : "no transcript"}
          </li>
        </ul>

        <div className="po-hero-acts">
          {best ? (
            <>
              <button type="button" className="btn" onClick={() => go("check")}>Edit my profile</button>
              <button type="button" className="btn-quiet" onClick={() => window.print()}>
                Download report
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={onAdd}>Add schools</button>
              <button type="button" className="btn-quiet" onClick={() => go("check")}>Edit my profile</button>
            </>
          )}
        </div>
      </div>

      {best && next && (
        <aside className={`po-hero-wall${next.days <= 45 ? " urgent" : ""}`}>
          <span className="po-hero-wlabel">Nearest deadline</span>
          <b className="num">{Math.round(days)}<i>days</i></b>
          <span className="po-hero-wsub">{next.school} · {next.label}</span>
        </aside>
      )}

      {best && (
        <ol className="po-hero-funnel num" aria-label="Your list">
          <li><b>{atTarget}</b><span>at target</span></li>
          <li><b>{tracked}</b><span>tracked</span></li>
          <li className={blocked ? "hot" : ""}><b>{blocked}</b><span>blocked</span></li>
        </ol>
      )}
    </header>
  );
}

/* ── 3.2 · THE LEDGER ─────────────────────────────────────────────────── */

type Sort = "odds" | "due" | "band";

/** The band cell, in words. The bar is aria-hidden decoration over this. */
function bandSentence(b: AdmitBand, gpa: number): string {
  if (b.kind === "none") return b.caption;
  return `${b.p25!.toFixed(2)}–${b.p75!.toFixed(2)}, median ${b.p50!.toFixed(2)}, ${b.caption}; you ${gpa.toFixed(2)}`;
}

function BandCell({ b, gpa }: { b: AdmitBand; gpa: number }) {
  return (
    <span className={`po-led-band po-band-${b.kind}`}>
      {b.kind === "none" ? (
        <span className="po-band-empty" aria-hidden="true" />
      ) : (
        <span className="po-band" aria-hidden="true">
          <span
            className="po-band-range"
            style={{ left: `${bandPos(b.p25!)}%`, width: `${Math.max(0, bandPos(b.p75!) - bandPos(b.p25!))}%` }}
          />
          <span className="po-band-med" style={{ left: `${bandPos(b.p50!)}%` }} />
          <span className="po-band-you" style={{ left: `${bandPos(gpa)}%` }} />
        </span>
      )}
      <i className="num">{b.caption}</i>
      {b.kind !== "none" && (
        <i className="po-band-figs num">
          {b.p25!.toFixed(2)}–{b.p75!.toFixed(2)} · med {b.p50!.toFixed(2)} · you {gpa.toFixed(2)}
        </i>
      )}
      <span className="sr-only">{bandSentence(b, gpa)}</span>
    </span>
  );
}

function LedgerOpen({
  profile, e, entry, blk, gaps, onNote,
}: {
  profile: Profile;
  e: Estimate;
  entry: ListEntry;
  blk: Blocker;
  gaps: CourseGapsResult;
  onNote: (v: string) => void;
}) {
  // Only the open row pays for these.
  const sheet = useMemo(() => readerSheet(profile, e), [profile, e]);
  const matches = useMemo(() => findSimilar(profile, [e.school.name], 3), [profile, e.school.name]);
  const dl = DEADLINES[e.school.name];
  const merced = e.school.name === "UC Merced" ? UC_JSON.campuses["UC Merced"]?.ccNote : null;

  return (
    <div className="po-led-open-body" role="region" aria-label={`Detail for ${e.school.name}`}>
      <div className="po-lo-col">
        <h4>How it reads</h4>
        <ul className="po-lo-dims">
          {sheet.dimensions.map((d, i) => (
            <li key={d.id} className={`po-sig-${d.signal}${d.id === sheet.pivot.id ? " pivot" : ""}`}>
              <span className="po-lo-n num">{String(i + 1).padStart(2, "0")}</span>
              <span className="po-lo-label">{d.label}</span>
              <span className="po-dim-metre" aria-hidden="true">
                <span style={{ width: `${Math.round(d.score * 100)}%` }} />
              </span>
              <span className="po-lo-sig">{SIGNAL_LABEL[d.signal]}</span>
            </li>
          ))}
        </ul>
        <p className="po-lo-note">{sheet.pivot.note}</p>
        {sheet.pivot.lift && <p className="po-dim-lift">{sheet.pivot.lift}</p>}
      </div>

      <div className="po-lo-col">
        <h4>At this school</h4>
        <ul className="po-lo-drivers">
          {e.drivers.slice(0, 3).map((d) => (
            <li key={d.text} className={`po-lo-${d.dir}`}>
              <em aria-hidden="true">{d.dir === "up" ? "↑" : d.dir === "down" ? "↓" : "–"}</em>
              {d.text}
            </li>
          ))}
        </ul>
        {e.school.counsel?.levers?.length ? (
          <ul className="po-lo-levers">
            {e.school.counsel.levers.slice(0, 2).map((l) => <li key={l}>{l}</li>)}
          </ul>
        ) : null}
        {blk.extra > 0 && (
          <p className="po-lo-blocks">
            <span className="po-lo-flabel">Also firing</span>
            {blk.all.slice(1).map((k, i) => <em key={`${k}-${i}`}>{k}</em>)}
          </p>
        )}
        {dl?.note && <p className="po-lo-fine">{dl.note}</p>}
        {merced && <p className="po-lo-fine">† {merced}</p>}
        {gaps.missingCore.length > 0 && (
          <p className="po-lo-fine num">
            {gaps.coreDone} of {gaps.coreTotal} core requirements covered
          </p>
        )}
      </div>

      <div className="po-lo-col">
        <h4>Closest real files</h4>
        {matches.map((m, i) => {
          const d = m.gpa - profile.gpa;
          return (
            <div className="po-lo-match" key={`${m.gpa}-${m.major}-${m.year}-${i}`}>
              <span className="po-lo-mtop">
                <b className="num">{m.gpa.toFixed(2)}</b>
                <span>{m.major}{m.institutionLabel ? ` · ${m.institutionLabel}` : ""} · {m.year}</span>
                <em className={`num${d > 0 ? " behind" : ""}`}>
                  {d > 0 ? "+" : d < 0 ? "−" : "±"}{Math.abs(d).toFixed(2)}
                </em>
              </span>
              <Ledgerette label="IN" tone="in" names={m.admits} />
              {m.denies.length > 0 && <Ledgerette label="OUT" tone="out" names={m.denies} />}
            </div>
          );
        })}
        <label className="po-lo-notefield">
          <span className="po-lo-flabel">Your note</span>
          <input
            type="text"
            className="po-note"
            placeholder="Deadline, portal login, who's writing recs…"
            value={entry.note}
            onChange={(ev) => onNote(ev.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

/** IN / OUT ledger of Tiles, capped at 3 — the remainder is counted, never
 *  silently dropped. */
function Ledgerette({ label, tone, names }: { label: string; tone: "in" | "out"; names: string[] }) {
  const shown = names.slice(0, 3);
  return (
    <span className="po-lo-led">
      <em className={`po-lo-tag po-lo-${tone}`}>{label}</em>
      {shown.map((s) => (
        <span key={s} className="po-lo-school"><Tile name={s} size={15} /> {markOf(s).word}</span>
      ))}
      {names.length > 3 && <span className="po-lo-more num">+{names.length - 3} more</span>}
    </span>
  );
}

/* ── 3.8 · the reading sheet ──────────────────────────────────────────── */

function ReadingSheet({ profile, ests, targets }: { profile: Profile; ests: Estimate[]; targets: string[] }) {
  /* Read against the STUDENT'S schools only. The old sheet picked the top 6
   *  by odds — schools the student never named — and asked them to read
   *  themselves against strangers. */
  const targetSet = useMemo(() => new Set(targets), [targets]);
  const picks = useMemo(
    () => ests.filter((e) => targetSet.has(e.school.name)).slice(0, 6),
    [ests, targetSet],
  );
  const [pick, setPick] = useState(0);
  const [openDim, setOpenDim] = useState<string | null>(null);
  const target = picks[Math.min(pick, picks.length - 1)];
  const sheet = useMemo(() => readerSheet(profile, target), [profile, target]);

  return (
    <section className="po-read" aria-labelledby="po-read-h">
      <header className="po-read-head">
        <h2 id="po-read-h">How it reads</h2>
        <div className="po-read-pick" role="tablist" aria-label="Read against">
          {picks.map((t, i) => (
            <button
              type="button"
              role="tab"
              key={t.school.id}
              aria-selected={i === pick}
              className={i === pick ? "on" : ""}
              onClick={() => setPick(i)}
            >
              <Tile name={t.school.name} size={20} />
              <span className="sr-only">{t.school.name}</span>
            </button>
          ))}
        </div>
      </header>

      <p className={`po-read-gate${sheet.gateCleared ? " ok" : " under"}${sheet.bandEstimated ? " est" : ""}`}>
        <span className="po-read-glabel">Academic gate</span>
        <b>{sheet.gateCleared ? "Cleared" : "Under the band"}</b>
        {sheet.bandEstimated && <i>Band estimated — this school publishes none</i>}
      </p>

      <ol className="po-read-dims">
        {sheet.dimensions.map((d, i) => {
          const isPivot = d.id === sheet.pivot.id;
          const open = isPivot || openDim === d.id;
          return (
            <li key={d.id} className={`po-dim po-sig-${d.signal}${isPivot ? " pivot" : ""}`}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenDim((o) => (o === d.id ? null : d.id))}
              >
                <span className="po-dim-n num">{String(i + 1).padStart(2, "0")}</span>
                <span className="po-dim-label">{d.label}</span>
                <span className="po-dim-metre" aria-hidden="true">
                  <span style={{ width: `${Math.round(d.score * 100)}%` }} />
                </span>
                <span className="po-dim-sig">{SIGNAL_LABEL[d.signal]}</span>
                {isPivot && <i className="po-dim-pivot">Reader stops here</i>}
                {d.schoolInvariant && <i className="po-dim-inv">Same at every school</i>}
              </button>
              {open && (
                <div className="po-dim-body">
                  <p className="po-dim-note">{d.note}</p>
                  {d.lift && <p className="po-dim-lift">{d.lift}</p>}
                  <p className="po-dim-lens">{d.lens}</p>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="po-read-foot">
        <span className="num">n={fmt(ADMIT_FILES)} admitted files</span>
      </p>
    </section>
  );
}

/* ── 3.9 · the corpus panel ───────────────────────────────────────────── */

function CorpusPanel({ profile, targets }: { profile: Profile; targets: string[] }) {
  // The caller rebuilds `targets` every render, so the memos hang off a stable
  // string of it — findSimilar scans 856 files and the essay box re-renders the
  // page on every keystroke.
  const key = targets.join("|");
  const names = useMemo(() => (key ? key.split("|") : []), [key]);
  const matches = useMemo(() => findSimilar(profile, names, 3), [profile, names]);
  const sigs = useMemo(() => admitSignatures(names, 2), [names]);
  const eligible = useMemo(() => countEligible(profile), [profile]);
  const thin = useMemo(() => names.filter((t) => admitSignature(t) === null), [names]);
  // Name at most two, then count the rest. Counted, never silently dropped.
  const thinLabel = thin.length > 2
    ? `${thin.slice(0, 2).join(", ")} and ${thin.length - 2} more`
    : thin.join(" and ");

  return (
    <section className="po-corp" aria-labelledby="po-corp-h">
      <h2 id="po-corp-h">Files like yours</h2>
      <p className="po-corp-q">
        <span className="po-corp-op">MATCH</span>
        <span>
          gpa <b className="num">{profile.gpa.toFixed(2)}</b> ±{MATCH_WINDOW.toFixed(2)} · major family ·
          from {INSTITUTION_LABEL[profile.institution].toLowerCase()}
        </span>
      </p>
      <p className="po-corp-funnel num">
        <span><b>{fmt(CORPUS_META.people)}</b> files scanned</span><i>▸</i>
        <span><b>{eligible}</b> inside the window</span><i>▸</i>
        <span><b>{matches.length}</b> nearest returned</span>
        <span className="po-corp-dec">{fmt(CORPUS_META.records)} recorded decisions</span>
      </p>

      <div className="po-corp-head num"><span>#</span><span>GPA</span><span>FILE</span><span>Δ VS YOU</span></div>
      {matches.map((m, i) => {
        const d = m.gpa - profile.gpa;
        return (
          <div className="po-corp-card" key={`${m.gpa}-${m.major}-${m.year}-${i}`}>
            <div className="po-corp-top">
              <span className="po-corp-idx num">{String(i + 1).padStart(2, "0")}</span>
              <b className="po-corp-gpa num">{m.gpa.toFixed(2)}</b>
              <span className="po-corp-meta">
                {m.major}{m.institutionLabel ? ` · ${m.institutionLabel}` : ""} · {m.year}
              </span>
              <span className={`po-corp-delta num${d > 0 ? " behind" : ""}`}>
                {d > 0 ? "+" : d < 0 ? "−" : "±"}{Math.abs(d).toFixed(2)}
              </span>
            </div>
            <Ledgerette label="IN" tone="in" names={m.admits} />
            {m.denies.length > 0 && <Ledgerette label="OUT" tone="out" names={m.denies} />}
          </div>
        );
      })}

      {sigs.length > 0 && <h3 className="po-corp-h2">Admitted files at your targets</h3>}
      {sigs.map((s) => (
        <div className="po-sig" key={s.school}>
          <div className="po-sig-top">
            <span className="po-sig-photo">
              <CampusPhoto name={s.school} color={markOf(s.school).color} height={26} />
            </span>
            <Tile name={s.school} size={16} />
            <b>{markOf(s.school).word}</b>
            <span className="po-sig-n num">n={s.n} observed admits</span>
          </div>
          <div className="po-band po-band-observed" aria-hidden="true">
            <span
              className="po-band-range"
              style={{
                left: `${bandPos(s.gpaP25)}%`,
                width: `${Math.max(0, bandPos(s.gpaP75) - bandPos(s.gpaP25))}%`,
              }}
            />
            <span className="po-band-med" style={{ left: `${bandPos(s.gpaMedian)}%` }} />
            <span className="po-band-you" style={{ left: `${bandPos(profile.gpa)}%` }} />
          </div>
          <p className="po-sig-line num">
            {s.gpaP25.toFixed(2)}–{s.gpaP75.toFixed(2)}, median <b>{s.gpaMedian.toFixed(2)}</b> ·
            you <b className="po-sig-mine">{profile.gpa.toFixed(2)}</b>
          </p>
        </div>
      ))}
      {sigs.length > 0 && (
        <p className="po-corp-axis num" aria-hidden="true">
          <i>{BAND_MIN.toFixed(2)}</i><i>{((BAND_MIN + BAND_MAX) / 2).toFixed(2)}</i><i>{BAND_MAX.toFixed(2)}</i>
        </p>
      )}

      {thin.length > 0 && (
        <p className="po-corp-honest">
          {thinLabel}: too few observed admits to characterize — you get the official rate there,
          not a number we made up.
        </p>
      )}
    </section>
  );
}

/* ── 3.10 · the UC block ──────────────────────────────────────────────── */

interface UcRow { name: string; est: Estimate; uc: UcCampusData | null }

function UcSection({
  profile, ests, go,
}: { profile: Profile; ests: Estimate[]; go: (route: string) => void }) {
  const [openFloor, setOpenFloor] = useState<string | null>(null);

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

  if (rows.length === 0) return null;

  // ── TAG: the engine's own three structural gates, shown one by one ──
  const gates = [
    { ok: profile.institution === "cc", label: "Community college", miss: "community-college enrollment" },
    { ok: profile.caResident, label: "California resident", miss: "California residency" },
    { ok: profile.standing === "junior", label: "Junior standing", miss: "junior-standing entry" },
  ];
  const gatesOk = gates.every((g) => g.ok);
  const firstMiss = gates.find((g) => !g.ok)?.miss ?? null;

  // Floors for THIS applicant's major, not the campus-wide minimum — see
  // tagFloor() in engine.ts. Showing the campus figure here contradicted the
  // odds the engine printed on the same screen.
  const floors = Object.keys(TAG_CAMPUSES)
    .map((c) => [c, tagFloor(c, profile.major)] as [string, number | null])
    .filter((f): f is [string, number] => f[1] != null)
    .sort((a, b) => a[1] - b[1]);
  const cleared = floors.filter(([, min]) => profile.gpa >= min);

  // Two campuses can land on the same floor for one major (Irvine and Santa
  // Barbara both sit at 3.4). Stacking two ticks at one x would hide one of
  // them, so a shared floor is one tick naming both campuses.
  const ticks: { min: number; campuses: string[] }[] = [];
  for (const [campus, min] of floors) {
    const hit = ticks.find((t) => t.min === min);
    if (hit) hit.campuses.push(campus);
    else ticks.push({ min, campuses: [campus] });
  }

  const tagDays = daysUntil(9, 30);
  const AX_MIN = 2.6, AX_MAX = 3.7;
  const pctOf = (v: number): number => clamp(((v - AX_MIN) / (AX_MAX - AX_MIN)) * 100);

  return (
    <section className="po-uc" aria-labelledby="po-uc-h">
      <header className="po-uc-head">
        <div className="po-uc-headtext">
          <span className="po-uc-eyebrow">The biggest transfer destination in this dataset</span>
          <h2 id="po-uc-h">The University of California</h2>
          <span className="po-uc-facts num">
            {rows.length} campuses ▸ one application ▸ one Nov 30 wall
            {CC_MIN != null && CC_MAX != null && (
              <> ▸ {CC_MIN}%–{CC_MAX}% from CA CCs across the {CC_SHARES.length} campuses
                UC publishes a breakdown for</>
            )}
          </span>
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
                      {fmt(est.school.admitted)} of {fmt(est.school.applicants)} admitted
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

      <div className="po-tag">
        <p className="po-tag-head">
          <span>TAG · Transfer Admission Guarantee</span>
          <b className={`num${tagDays <= 45 ? " soon" : ""}`}>{tagDays}d to Sep 30</b>
          <em className={gatesOk ? "" : "no"}>
            {gatesOk
              ? `Eligible · clears ${cleared.length} of ${floors.length}`
              : `Blocked · needs ${firstMiss}`}
          </em>
        </p>

        <ul className="po-tag-gates">
          {gates.map((g) => (
            <li key={g.label} className={g.ok ? "ok" : "no"}>
              <span aria-hidden="true">{g.ok ? "●" : "○"}</span>{g.label}
            </li>
          ))}
        </ul>

        <div className="po-tag-ax">
          <span className="po-tag-a num">{AX_MIN.toFixed(2)}</span>
          <span className="po-tag-b num">{AX_MAX.toFixed(2)}</span>
          {ticks.map((t) => {
            const id = t.min.toFixed(2);
            return (
              <button
                type="button"
                key={id}
                className={`po-tag-tick${profile.gpa >= t.min ? " clear" : ""}`}
                style={{ left: `${pctOf(t.min)}%` }}
                aria-expanded={openFloor === id}
                onClick={() => setOpenFloor((f) => (f === id ? null : id))}
              >
                <b className="num">{t.min.toFixed(1)}</b>
                <span>{t.campuses.map(shortCampus).join(" · ")}</span>
              </button>
            );
          })}
          <span className="po-tag-you" style={{ left: `${pctOf(profile.gpa)}%` }}>
            <b className="num">{profile.gpa.toFixed(2)}</b>
            <span>You</span>
          </span>
        </div>

        {openFloor && (
          <div className="po-tag-note">
            {(ticks.find((t) => t.min.toFixed(2) === openFloor)?.campuses ?? []).map((c) => (
              <p key={c}>{UC_JSON.tag.minGpaNotes[c]}</p>
            ))}
          </div>
        )}

        <p className="po-tag-rule">Voids unless the regular UC application follows by November 30.</p>
        <p className="po-tag-src">{UC_JSON.tag.minGpaNotes.source}</p>
      </div>
    </section>
  );
}

/* ── 3.11 · major prep, one line ──────────────────────────────────────── */

function PrepLine({
  profile, gaps, go,
}: { profile: Profile; gaps: CourseGapsResult; go: (r: string) => void }) {
  const core = gaps.statuses.filter((s) => s.tier === "core");
  return (
    <>
      <p className="po-prep">
        <span className="po-prep-label">Major prep · {MAJOR_TEXT[profile.major]}</span>
        <span className="po-prep-bar" aria-hidden="true">
          {core.map((s) => <i key={s.key} className={s.have ? "on" : ""} title={s.label} />)}
        </span>
        <b className="num">{gaps.coreDone} of {gaps.coreTotal} covered</b>
        {gaps.missingCore.length > 0 && (
          <span className="po-prep-open">
            <span className="po-prep-olabel">Open</span>
            {gaps.missingCore.slice(0, 6).map((m) => <em key={m.key}>{m.label}</em>)}
          </span>
        )}
        <span className="po-prep-igetc">IGETC {profile.igetc ? "●" : "○"}</span>
        <span className="po-prep-src">ASSIST.org is the authority</span>
      </p>
      <details className="po-prep-more">
        <summary>All {gaps.coreTotal} requirements, line by line</summary>
        <CourseGaps profile={profile} onEdit={() => go("check")} />
      </details>
    </>
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

/** essay.ts's own thresholds: 250 short · 400–650 target · 800 long. */
const WBAND_MAX = 800;
const wpos = (words: number): string => `${clamp((words / WBAND_MAX) * 100)}%`;

/** A note's chip form. Full text rides on title=. */
function shortNote(n: string): string {
  if (n.startsWith("Very short")) return "very short";
  if (n.startsWith("Long")) return "long";
  if (n.startsWith("No professors named")) return "no professors named";
  return n.split(/[—.]/)[0].trim().toLowerCase();
}

function EssayRow({ a }: { a: EssayAnalysis }) {
  const total = Math.max(1, a.fitScore + a.complaintScore);
  return (
    <p className="po-essay-row">
      <b className="num">{a.words}</b>
      <span className="po-essay-wlabel">words</span>
      <span className="po-wband" aria-hidden="true">
        <span className="po-wband-target" />
        <span className="po-wband-you" style={{ left: wpos(a.words) }} />
      </span>
      <span className="po-essay-names">
        Names {a.namedSchools.length
          ? a.namedSchools.map((n) => <Tile key={n} name={n} size={16} />)
          : "—"}
      </span>
      <span className="po-essay-prof">Prof <b className="num">{a.professorMentions}</b></span>
      <span className="po-fitbar" aria-hidden="true">
        <span style={{ width: `${(a.fitScore / total) * 100}%` }} />
        <span style={{ width: `${(a.complaintScore / total) * 100}%` }} />
      </span>
      <span className="po-essay-fit num">Fit {a.fitScore}–{a.complaintScore}</span>
      <span className={`po-essay-verdict po-v-${a.verdict}`}>{a.verdict}</span>
    </p>
  );
}

function WritingSection({
  profile, onChange, go, essayMove,
}: {
  profile: Profile;
  onChange?: (p: Profile) => void;
  go: (route: string) => void;
  essayMove: PlannedMove | null;
}) {
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
        {essayMove && (
          <span className="po-write-lever">The essay lever · {liftLabel(essayMove)}</span>
        )}
        <button type="button" className="btn-quiet" onClick={() => go("review")}>
          Send to deep review →
        </button>
      </div>

      <div className="po-doc">
        <label htmlFor="po-essay">Why transfer · feeds row 05</label>
        <textarea
          id="po-essay"
          rows={10}
          placeholder="Paste your 'why transfer' essay. We check it for the things admits' essays actually do — naming programs, courses and faculty, and framing the move as fit rather than escape."
          value={draft.essay}
          onChange={(e) => set("essay", e.target.value)}
        />
        {essay ? (
          <>
            <EssayRow a={essay} />
            {essay.verdict === "complaint" && (
              <p className="po-essay-warn">
                Reads complaint-shaped ({essay.complaintScore} complaint signals vs {essay.fitScore} fit
                signals). Admits frame the move around what the target offers, not what your school lacks.
              </p>
            )}
            {essay.notes.filter((n) => !n.startsWith("Reads complaint")).length > 0 && (
              <p className="po-essay-chips">
                {essay.notes.filter((n) => !n.startsWith("Reads complaint")).map((n) => (
                  <em key={n} title={n}>{shortNote(n)}</em>
                ))}
              </p>
            )}
          </>
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
        {statement && <EssayRow a={statement} />}
      </div>

      <div className="po-doc-pair">
        <div className="po-doc">
          <label htmlFor="po-activities">Activities · feeds row 04</label>
          <textarea
            id="po-activities"
            rows={6}
            placeholder={"Tutor, campus learning center — 6 hrs/week\nPresident, CS club — ran 4 workshops\nJob: 20 hrs/week while enrolled"}
            value={draft.activities}
            onChange={(e) => set("activities", e.target.value)}
          />
          <p className="po-write-hint num">
            {lineCount(draft.activities)} {lineCount(draft.activities) === 1 ? "entry" : "entries"} ·
            pattern beats prestige
          </p>
        </div>
        <div className="po-doc">
          <label htmlFor="po-awards">Awards &amp; honors · feeds row 04</label>
          <textarea
            id="po-awards"
            rows={6}
            placeholder={"Dean's List (3 semesters)\nPhi Theta Kappa\nHackathon finalist, 2025"}
            value={draft.awards}
            onChange={(e) => set("awards", e.target.value)}
          />
          <p className="po-write-hint num">
            {lineCount(draft.awards)} {lineCount(draft.awards) === 1 ? "entry" : "entries"} on file
          </p>
        </div>
      </div>

      <p className="po-write-piq">
        UC reads no per-campus essay — the same four PIQs go to every campus.
      </p>

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

/* ── The page ─────────────────────────────────────────────────────────── */

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
  const [query, setQuery] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("odds");

  useEffect(() => {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
    dispatchListChanged();
  }, [list]);

  // ── Ledger sync (both directions) ──────────────────────────────────────
  // The profile and the documents already reach the account; until this, the
  // school list — statuses, notes, the thing the portal is FOR — lived only
  // in this browser and silently vanished on any other device.

  // Adopt on mount: a device with no local list takes the account's copy.
  // A device WITH a local list keeps it — the local list is newer or equal
  // by construction, because every local edit is pushed below.
  useEffect(() => {
    if (!cloudEnabled || !session) return;
    let live = true;
    pullProfile()
      .then(({ schools }) => {
        if (!live || !schools || loadList().length) return;
        const adopted: ListEntry[] = Object.entries(schools).map(([school, v]) => ({
          school, status: (v.status as Status) || "planning", note: v.notes ?? "",
        }));
        if (adopted.length) setList(adopted);
      })
      .catch(() => { /* offline: the local list stands */ });
    return () => { live = false; };
    // Session identity only — this is adopt-on-login, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.email]);

  // Push on change, debounced. Deliberately pushes `list` and not the seeded
  // preview: an untouched seed is a suggestion, not the student's data.
  useEffect(() => {
    if (!cloudEnabled || !session || !list.length) return;
    const t = window.setTimeout(() => {
      const rec: Record<string, { status: string; notes: string }> = {};
      for (const l of list) rec[l.school] = { status: l.status, notes: l.note };
      pushSchools(rec).catch(() => { /* offline is not an error here */ });
    }, 1200);
    return () => clearTimeout(t);
  }, [list, session]);

  // Computed once for the whole page and passed down. buildPlan() re-runs
  // estimateAll() over 208 schools once per playbook move; calling it here and
  // again inside ActionPlan doubled that.
  const ests = useMemo(() => estimateAll(profile), [profile]);
  const plan = useMemo(() => buildPlan(profile, ests), [profile, ests]);
  const gaps = useMemo(() => analyzeCourses(profile), [profile]);
  const essayAnalysis = useMemo(
    () => (profile.essayText.trim() ? analyzeEssay(profile.essayText) : null),
    [profile.essayText],
  );
  const byName = useMemo(() => new Map(ests.map((e) => [e.school.name, e])), [ests]);

  // The ledger. The student picks the schools — the app never suggests any as
  // if they were theirs, because the whole point of a portal is that the list
  // is *their* list. Empty until they add one.
  const base = list;
  const hasSchools = base.length > 0;

  const rows = useMemo(() => {
    const rs = base.filter((r) => byName.has(r.school));
    const copy = [...rs];
    if (sort === "due") {
      return copy.sort((a, b) => (countdown(a.school)?.days ?? 1e9) - (countdown(b.school)?.days ?? 1e9));
    }
    if (sort === "band") {
      const gap = (n: string): number => {
        const b = admitBand(byName.get(n)!.school);
        return b.p50 == null ? Infinity : profile.gpa - b.p50;
      };
      return copy.sort((a, b) => gap(a.school) - gap(b.school));
    }
    return copy.sort((a, b) => byName.get(b.school)!.p - byName.get(a.school)!.p);
  }, [base, byName, sort, profile.gpa]);

  const blockers = useMemo(() => {
    const m = new Map<string, Blocker>();
    for (const r of rows) {
      const e = byName.get(r.school);
      if (e) m.set(r.school, blockerFor(profile, e, gaps, essayAnalysis));
    }
    return m;
  }, [rows, byName, profile, gaps, essayAnalysis]);

  const bandedRows = rows.filter((r) => admitBand(byName.get(r.school)!.school).kind !== "none").length;
  const blockedRows = rows.filter((r) => blockers.get(r.school)?.structural).length;
  const targets = ests.filter((e) => e.p >= 0.12).length;
  const essayMove = plan.moves.find((m) => m.lever === "essay" && !m.done) ?? null;
  const listed = new Set(base.map((l) => l.school));
  /** The strongest odds inside THE STUDENT'S list — never the top of the full
   *  208. Null means they haven't added a school yet, in which case the hero
   *  drops its odds figure and the page asks them to pick their targets. */
  const bestListed = useMemo(
    () => ests.find((e) => listed.has(e.school.name)) ?? null,
    [ests, listed],
  );

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return MODEL.schools.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  if (!session) {
    return (
      <div className="shell po-gate">
        <h1>Your portal</h1>
        <p>Log in to track your school list, statuses, and progress in one place.</p>
        <button type="button" className="btn" onClick={() => go("login")}>Log in</button>
      </div>
    );
  }

  const setEntry = (school: string, patch: Partial<ListEntry>) =>
    setList(() => base.map((l) => (l.school === school ? { ...l, ...patch } : l)));
  const removeEntry = (school: string) =>
    setList(() => base.filter((l) => l.school !== school));
  const toggleSchool = (school: string) =>
    setList(() => (listed.has(school)
      ? base.filter((l) => l.school !== school)
      : [...base, { school, status: "planning" as Status, note: "" }]));

  return (
    <div className="shell po">
      <PortalHero
        profile={profile}
        best={bestListed}
        plan={plan}
        atTarget={targets}
        tracked={rows.length}
        blocked={blockedRows}
        go={go}
        onAdd={() => setAdding(true)}
      />

      <section className="po-led" aria-labelledby="po-led-h" data-fx>
        <header className="po-led-head">
          <h2 id="po-led-h">Your ledger</h2>
          <span className="po-led-scope num">
            {hasSchools ? `${rows.length} schools · ${bandedRows} banded` : "Not started"}
          </span>
          {hasSchools && (
            <span className="po-led-sorts">
              <button
                type="button" className={sort === "odds" ? "on" : ""}
                aria-pressed={sort === "odds"} onClick={() => setSort("odds")}
              >Odds</button>
              <button
                type="button" className={sort === "due" ? "on" : ""}
                aria-pressed={sort === "due"} onClick={() => setSort("due")}
              >Due</button>
              <button
                type="button" className={sort === "band" ? "on" : ""}
                aria-pressed={sort === "band"} onClick={() => setSort("band")}
              >Band</button>
            </span>
          )}
          <button type="button" className="btn btn-sm" onClick={() => setAdding((a) => !a)}>
            {adding ? "Done" : hasSchools ? "+ Add" : "+ Add schools"}
          </button>
        </header>

        {!hasSchools && !adding && (
          <div className="po-led-empty">
            <p>
              <b>Pick the schools you want to transfer to.</b>
              Add them below to see your odds, deadlines, and what's blocking each one — all
              scored against your saved profile.
            </p>
            <button type="button" className="btn" onClick={() => setAdding(true)}>
              Add your first school
            </button>
          </div>
        )}

        {adding && (
          <div className="po-pick">
            <input
              type="text"
              className="po-pick-in"
              placeholder="Search all 208 measured schools…"
              aria-label="Search schools to add"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="po-pick-hits">
              {hits.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="po-pick-hit"
                  aria-pressed={listed.has(s.name)}
                  onClick={() => toggleSchool(s.name)}
                >
                  <Tile name={s.name} size={18} />
                  <span>{s.name}</span>
                  <i className="num">{s.rate.toFixed(0)}%</i>
                </button>
              ))}
            </div>
          </div>
        )}

        {hasSchools && (
        <div className="po-led-scroll" role="region" tabIndex={0} aria-label="Your ledger table">
          <div className="po-led-cols" aria-hidden="true">
            <span className="po-led-colgrid">
              <span>#</span><span>School</span><span>Official</span>
              <span>Admitted band — where observed</span><span>Your odds</span>
              <span>Blocking</span><span>Due</span>
            </span>
            <span>Status</span>
            <span />
          </div>

          <ul className="po-led-rows">
            {rows.map((r, i) => {
              const e = byName.get(r.school)!;
              const b = admitBand(e.school);
              const blk = blockers.get(r.school)!;
              const cd = countdown(r.school);
              const open = openRow === r.school;
              const mercedNote = r.school === "UC Merced"
                ? UC_JSON.campuses["UC Merced"]?.ccNote
                : undefined;
              return (
                <li key={r.school} className={`po-led-row po-led-${blk.kind.toLowerCase()}`}>
                  <button
                    type="button"
                    className="po-led-open"
                    aria-expanded={open}
                    onClick={() => setOpenRow((o) => (o === r.school ? null : r.school))}
                  >
                    <span className="po-led-i num">{String(i + 1).padStart(2, "0")}</span>
                    <span className="po-led-school">
                      <Tile name={r.school} size={22} />
                      <span>
                        <b>{r.school}</b>
                        <i title={e.school.cycle}>{e.school.cycle}</i>
                      </span>
                    </span>
                    <span className="po-led-rate">
                      <b className="num">{e.school.rate.toFixed(1)}%</b>
                      {e.school.admitted != null && e.school.applicants != null && (
                        <i className="num">{fmt(e.school.admitted)}/{fmt(e.school.applicants)}</i>
                      )}
                      {mercedNote && <em className="po-led-dag" title={mercedNote}>†</em>}
                    </span>
                    <BandCell b={b} gpa={profile.gpa} />
                    <span className="po-led-odds">
                      <b className="num">{fmtPct(e.lo)}–{fmtPct(e.hi)}%</b>
                      <i>{e.tier}</i>
                    </span>
                    <span className={`po-led-blk po-tone-${blk.tone}`}>
                      <em>{blk.kind === "NONE" ? "—" : blk.kind}</em>
                      <i title={blk.clause}>{blk.clause}</i>
                      {blk.extra > 0 && <b className="num">+{blk.extra}</b>}
                    </span>
                    <span className={`po-led-due${cd && cd.days <= 45 ? " soon" : ""}`}>
                      {cd ? <><b className="num">~{cd.days}d</b><i>{cd.label}</i></> : <i>—</i>}
                    </span>
                  </button>

                  <select
                    aria-label={`Status for ${r.school}`}
                    className={`po-status po-${r.status}`}
                    value={r.status}
                    onChange={(ev) => setEntry(r.school, { status: ev.target.value as Status })}
                  >
                    {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="po-remove"
                    aria-label={`Remove ${r.school}`}
                    onClick={() => removeEntry(r.school)}
                  >×</button>

                  {open && (
                    <LedgerOpen
                      profile={profile}
                      e={e}
                      entry={r}
                      blk={blk}
                      gaps={gaps}
                      onNote={(v) => setEntry(r.school, { note: v })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        )}

        {hasSchools && (
          <p className="po-led-foot">
            <span className="num">
              {bandedTotal()} of {MODEL.schools.length} schools with admitted-GPA bands
            </span>
            <span className="po-led-key">
              <em className="po-key-study" /> study
              <em className="po-key-observed" /> observed
              <em className="po-key-you" /> you {profile.gpa.toFixed(2)}
            </span>
            <span className="num">
              {BAND_MIN.toFixed(2)}–{BAND_MAX.toFixed(2)}
            </span>
          </p>
        )}
      </section>

      {hasSchools && (
        <>
          <div className="po-cols" data-fx>
            <ReadingSheet profile={profile} ests={ests} targets={rows.map((r) => r.school)} />
            <CorpusPanel profile={profile} targets={rows.map((r) => r.school)} />
          </div>

          <section className="po-planwrap" data-fx>
            <UcSection profile={profile} ests={ests} go={go} />
          </section>

          <div data-fx>
            <PrepLine profile={profile} gaps={gaps} go={go} />
          </div>

          <section className="po-planwrap" data-fx>
            <WritingSection profile={profile} onChange={onChange} go={go} essayMove={essayMove} />
          </section>

          <section className="po-planwrap po-plan" data-fx>
            <ActionPlan profile={profile} ests={ests} plan={plan} />
          </section>

          <Report profile={profile} ests={ests} date={new Date().toLocaleDateString()} />
        </>
      )}
    </div>
  );
}
