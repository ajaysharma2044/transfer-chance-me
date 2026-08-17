// Action plan: what this specific applicant should do next, in the time they
// actually have left, and what each move is really worth.
//
// The percentage lift is never invented. For every move that changes a scored
// input, we clone the profile, apply the change, re-run the same engine that
// produced their odds, and report the true difference. Moves that sharpen the
// file without changing a scored input say so instead of faking a number.

import { estimateAll, MODEL, TAG_CAMPUSES, tagFloor } from "../engine";
import type { Estimate, Profile } from "../engine";
import { countdown, DEADLINES } from "./deadlines";
import playbook from "../data/playbook.json";

export type MoveTag = "Extracurricular" | "Essay" | "Coursework" | "Credential" | "Timeline";
export type MoveLever = "ecLevel" | "essay" | "ptk" | "honors" | "igetc" | "courses" | "none";

export interface Move {
  id: string;
  title: string;
  tag: MoveTag;
  horizon: "sprint" | "semester";
  /** Minimum weeks needed for this to be real and showable. */
  minWeeks: number;
  effort: string;
  steps: string[];
  why: string;
  lever: MoveLever;
  leverValue: string;
  proof: string;
  realism: string;
}

export interface SchoolMove {
  name: string;
  from: number;
  to: number;
}

export interface PlannedMove extends Move {
  /** True percentage-point change in the average odds across their list. */
  liftPp: number;
  /** Biggest single-school movers, largest first. */
  movers: SchoolMove[];
  /** Weeks until this move stops being possible (nearest relevant deadline). */
  weeksLeft: number;
  deadlineLabel: string;
  /** minWeeks fits inside weeksLeft. */
  feasible: boolean;
  /** Already true of their profile — nothing to do. */
  done: boolean;
}

export interface PlanWindow {
  label: string;
  school: string;
  days: number;
  weeks: number;
  note?: string;
}

export interface Plan {
  windows: PlanWindow[];
  /** The tightest real deadline on their list. */
  next: PlanWindow | null;
  moves: PlannedMove[];
  /** Combined honest lift if they do every feasible scored move. */
  stackedPp: number;
  focus: string[];
}

const MOVES = playbook as unknown as Move[];

/** Their working list: the schools the plan is scored against. */
function focusSchools(ests: Estimate[]): Estimate[] {
  const real = ests.filter((e) => e.p >= 0.02);
  return (real.length >= 4 ? real : ests).slice(0, 10);
}

/** Schools a move can actually still change. A TAG campus is already won —
 *  averaging it in would understate what every move is worth everywhere else. */
function liftFocus(focus: Estimate[]): Estimate[] {
  const movable = focus.filter((e) => e.tier !== "TAG guarantee");
  return movable.length ? movable : focus;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Apply a move's lever to a copy of the profile. Returns null when the move
 *  changes nothing the engine scores, or is already satisfied. */
function withMove(profile: Profile, m: Move): Profile | null {
  const p: Profile = { ...profile, courses: [...profile.courses], essayNamed: [...profile.essayNamed] };
  switch (m.lever) {
    case "ecLevel": {
      const v = m.leverValue === "national" ? "national" : "campus";
      if (profile.ecLevel === v) return null;
      // Never present a downgrade as an improvement.
      if (profile.ecLevel === "national" && v === "campus") return null;
      p.ecLevel = v;
      return p;
    }
    case "essay": {
      if (profile.essay === "named") return null;
      p.essay = "named";
      return p;
    }
    case "ptk":
      if (profile.ptk) return null;
      p.ptk = true;
      return p;
    case "honors":
      if (profile.honors) return null;
      p.honors = true;
      return p;
    case "igetc":
      if (profile.igetc) return null;
      p.igetc = true;
      return p;
    default:
      return null;
  }
}

/** Is this move already satisfied by their profile? */
function alreadyDone(profile: Profile, m: Move): boolean {
  switch (m.lever) {
    case "ecLevel":
      return m.leverValue === "campus"
        ? profile.ecLevel === "campus" || profile.ecLevel === "national"
        : profile.ecLevel === "national";
    case "essay": return profile.essay === "named";
    case "ptk": return profile.ptk;
    case "honors": return profile.honors;
    case "igetc": return profile.igetc;
    default: return false;
  }
}

/** Deadlines that actually apply to this applicant's list, soonest first. */
export function planWindows(profile: Profile, ests: Estimate[]): PlanWindow[] {
  const out: PlanWindow[] = [];
  const seen = new Set<string>();
  for (const e of focusSchools(ests)) {
    const cd = countdown(e.school.name);
    if (!cd) continue;
    const key = `${cd.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      label: cd.label,
      school: e.school.name,
      days: cd.days,
      weeks: Math.floor(cd.days / 7),
      note: DEADLINES[e.school.name]?.note,
    });
  }
  // TAG is its own hard gate and beats every other date for CA CC juniors.
  const tagEligible =
    profile.institution === "cc" && profile.caResident && profile.standing === "junior";
  if (tagEligible) {
    // tagFloor(), not the campus minimum: TAG_CAMPUSES holds the LOWEST
    // college threshold per campus, and the published matrix puts several
    // majors well above it (Riverside CS 3.6 against a 2.7 floor). Reading
    // the campus figure told a 2.8 CS applicant they had "a guaranteed seat"
    // when the engine — correctly — guaranteed them nothing anywhere.
    const campus = Object.keys(TAG_CAMPUSES)
      .find((c) => profile.gpa >= (tagFloor(c, profile.major) ?? 9));
    if (campus) {
      const now = new Date();
      const yr = now.getMonth() > 8 || (now.getMonth() === 8 && now.getDate() > 30)
        ? now.getFullYear() + 1 : now.getFullYear();
      const sep30 = new Date(yr, 8, 30);
      const days = Math.ceil((sep30.getTime() - now.getTime()) / 86400000);
      out.unshift({
        label: "Sep 30",
        school: "UC TAG",
        days,
        weeks: Math.floor(days / 7),
        note: `TAG filing — a guaranteed seat at ${campus} at your GPA`,
      });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

export function buildPlan(profile: Profile, ests?: Estimate[]): Plan {
  const all = ests ?? estimateAll(profile);
  const focus = focusSchools(all);
  const scored = liftFocus(focus);
  const baseByName = new Map(all.map((e) => [e.school.name, e.p]));
  const baseMean = mean(scored.map((e) => e.p));

  const windows = planWindows(profile, all);
  const next = windows[0] ?? null;
  // A move must fit before the last date on the list, but we surface urgency
  // against the nearest one.
  const lastWeeks = windows.length ? windows[windows.length - 1].weeks : 26;

  const planned: PlannedMove[] = MOVES.map((m) => {
    const done = alreadyDone(profile, m);
    const mutated = done ? null : withMove(profile, m);
    let liftPp = 0;
    let movers: SchoolMove[] = [];
    if (mutated) {
      const after = estimateAll(mutated);
      const afterByName = new Map(after.map((e) => [e.school.name, e.p]));
      const afterMean = mean(scored.map((e) => afterByName.get(e.school.name) ?? e.p));
      liftPp = (afterMean - baseMean) * 100;
      movers = focus
        .map((e) => {
          const from = baseByName.get(e.school.name) ?? e.p;
          const to = afterByName.get(e.school.name) ?? from;
          return { name: e.school.name, from, to };
        })
        .filter((x) => x.to - x.from > 0.004)
        .sort((a, b) => (b.to - b.from) - (a.to - a.from))
        .slice(0, 3);
    }
    // Which deadline governs this move: TAG/UC moves answer to the UC window.
    const gov = m.tag === "Timeline" && windows.length ? windows[0] : next;
    const weeksLeft = m.horizon === "sprint" ? (gov?.weeks ?? lastWeeks) : lastWeeks;
    return {
      ...m,
      liftPp: Math.max(0, liftPp),
      movers,
      weeksLeft,
      deadlineLabel: gov ? `${gov.school} · ${gov.label}` : "your deadlines",
      feasible: m.minWeeks <= Math.max(weeksLeft, lastWeeks),
      done,
    };
  });

  // A hard date beats a soft improvement. A move that expires inside the next
  // ten weeks — filing TAG, an application window — outranks anything that can
  // still be done later, even when the engine scores it at zero.
  const urgency = (m: PlannedMove): number => {
    if (m.done) return 0;
    if (m.tag !== "Timeline") return 0;
    return m.weeksLeft <= 10 ? 2 : m.weeksLeft <= 16 ? 1 : 0;
  };

  planned.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    const ua = urgency(a), ub = urgency(b);
    if (ua !== ub) return ub - ua;
    if (Math.abs(b.liftPp - a.liftPp) > 0.05) return b.liftPp - a.liftPp;
    return a.minWeeks - b.minWeeks;
  });

  // Stacked lift: apply every feasible, scored, not-done move at once and
  // re-score — multipliers compound, so this is not the sum of the parts.
  let stacked = profile;
  for (const m of planned) {
    if (m.done || !m.feasible) continue;
    const nextP = withMove(stacked, m);
    if (nextP) stacked = nextP;
  }
  const stackedMean = mean(
    (() => {
      const after = estimateAll(stacked);
      const byName = new Map(after.map((e) => [e.school.name, e.p]));
      return scored.map((e) => byName.get(e.school.name) ?? e.p);
    })(),
  );

  return {
    windows,
    next,
    moves: planned,
    stackedPp: Math.max(0, (stackedMean - baseMean) * 100),
    focus: focus.map((e) => e.school.name),
  };
}

/** "+4.1 points" / "sharper file" — never a fake number. */
export function liftLabel(m: PlannedMove): string {
  if (m.done) return "already done";
  if (m.liftPp >= 0.1) return `+${m.liftPp.toFixed(1)} pts`;
  return "sharper file";
}

export const MEASURED_SCHOOLS = MODEL.schools.length;
