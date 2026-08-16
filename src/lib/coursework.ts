// Major-prep gap analysis.
//
// We deliberately do NOT ship a course catalog for every college — course
// codes differ at every institution and a wrong code sends someone into the
// wrong class. Instead the student's own typed courses (their real codes, from
// their real transcript) are matched against a canonical transfer spine, and
// we report which requirements for their major are covered and which aren't.

import type { Major, Profile } from "../engine";
import spine from "../data/coursespine.json";

export interface SpineCourse {
  key: string;
  label: string;
  group: string;
  match: string[];
}

interface Spine {
  courses: SpineCourse[];
  byMajor: Record<string, { core: string[]; strong: string[] }>;
  universal: string[];
}

const SPINE = spine as unknown as Spine;
const BY_KEY = new Map(SPINE.courses.map((c) => [c.key, c]));

/** Normalise for matching: lowercase, collapse punctuation and spacing. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[.,;:()/\-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Which spine course, if any, does this typed course line correspond to? */
export function classify(line: string): SpineCourse | null {
  const n = norm(line);
  if (!n) return null;
  let best: { c: SpineCourse; score: number } | null = null;
  for (const c of SPINE.courses) {
    for (const m of c.match) {
      const mn = norm(m);
      if (!mn || !n.includes(mn)) continue;
      // Longer alias hits are more specific: "calculus 2" must beat "calculus".
      const score = mn.length;
      if (!best || score > best.score) best = { c, score };
    }
  }
  return best?.c ?? null;
}

export interface CourseStatus {
  key: string;
  label: string;
  group: string;
  have: boolean;
  /** The student's own course line that satisfied it. */
  via: string | null;
  /** Core requirement for the major vs. a strengthener. */
  tier: "core" | "strong";
}

export interface CourseGaps {
  major: Major;
  statuses: CourseStatus[];
  coreDone: number;
  coreTotal: number;
  missingCore: CourseStatus[];
  /** Courses they've taken that we recognised but the major doesn't require. */
  extras: string[];
  /** Lines we could not classify — usually fine, just unrecognised titles. */
  unmatched: string[];
}

export function analyzeCourses(profile: Profile): CourseGaps {
  const req = SPINE.byMajor[profile.major] ?? SPINE.byMajor.undecided;
  const core = [...new Set([...req.core, ...SPINE.universal])];
  const strong = req.strong.filter((k) => !core.includes(k));

  const taken = new Map<string, string>(); // spine key -> their line
  const unmatched: string[] = [];
  for (const line of profile.courses) {
    const c = classify(line);
    if (c) {
      if (!taken.has(c.key)) taken.set(c.key, line);
    } else if (line.trim()) {
      unmatched.push(line.trim());
    }
  }

  const mk = (key: string, tier: "core" | "strong"): CourseStatus => {
    const c = BY_KEY.get(key)!;
    return {
      key,
      label: c.label,
      group: c.group,
      have: taken.has(key),
      via: taken.get(key) ?? null,
      tier,
    };
  };

  const statuses = [...core.map((k) => mk(k, "core")), ...strong.map((k) => mk(k, "strong"))];
  const coreStatuses = statuses.filter((s) => s.tier === "core");
  const extras = [...taken.entries()]
    .filter(([k]) => !core.includes(k) && !strong.includes(k))
    .map(([, line]) => line);

  return {
    major: profile.major,
    statuses,
    coreDone: coreStatuses.filter((s) => s.have).length,
    coreTotal: coreStatuses.length,
    missingCore: coreStatuses.filter((s) => !s.have),
    extras,
    unmatched,
  };
}

export const MAJOR_LABEL: Record<Major, string> = {
  cs: "computer science",
  engineering: "engineering",
  business: "business",
  econ: "economics",
  stem: "science / pre-health",
  social: "social science",
  humanities: "humanities",
  undecided: "an undeclared major",
};
