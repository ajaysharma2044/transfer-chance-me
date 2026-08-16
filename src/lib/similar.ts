// Matched profiles: real recorded applicants whose file looks like yours.
//
// Every person in similar.json is a real pseudonymous author from the outcome
// corpus, carrying the GPA / major / institution they applied from and the
// full list of schools that admitted AND denied them. Nothing is generated:
// there are no names, no invented students, and no filled-in blanks. Where a
// field was never recorded (institution, most often) it stays unknown and the
// UI omits it rather than guessing.

import corpus from "../data/similar.json";
import type { Institution, Major, Profile } from "../engine";

type InstCode = Institution | "unk";

interface RawPerson {
  g: number;      // college GPA
  m: string;      // intended major, their words
  i: InstCode;    // institution type, "unk" when never recorded
  y: number;      // most recent cycle year on the record
  f: string;      // major family, for matching only
  a: number[];    // school indices that admitted them
  d: number[];    // school indices that denied them
}

const DATA = corpus as unknown as {
  meta: { people: number; records: number; schools: number; years: [number, number] };
  schools: string[];
  people: RawPerson[];
};

export const CORPUS_META = DATA.meta;

/** The engine's Major enum → the family codes used in the corpus. */
const FAMILY_OF: Record<Major, string> = {
  cs: "cs_eng",
  engineering: "cs_eng",
  business: "econ_biz",
  econ: "econ_biz",
  stem: "phys_math",
  social: "social",
  humanities: "human_arts",
  undecided: "other",
};

const INST_LABEL: Record<Institution, string> = {
  cc: "Community college",
  public4: "Four-year public",
  private4: "Four-year private",
};

/** How wide a GPA window still counts as "a file like yours". */
export const MATCH_WINDOW = 0.15;

/** How many recorded files actually pass the match filter — the middle number
 *  in "856 scanned → n eligible → 3 nearest". Counted, not asserted. */
export function countEligible(p: Profile): number {
  const fam = FAMILY_OF[p.major];
  return DATA.people.filter(
    (r) =>
      Math.abs(r.g - p.gpa) <= MATCH_WINDOW &&
      r.f === fam &&
      (r.i === p.institution || r.i === "unk"),
  ).length;
}

export interface MatchedProfile {
  gpa: number;
  major: string;
  /** null when the corpus never recorded it — never inferred. */
  institution: Institution | null;
  institutionLabel: string | null;
  year: number;
  admits: string[];
  denies: string[];
  /** Target schools this person also applied to — why they surfaced. */
  sharedTargets: string[];
  /** 0–1, how close this file reads to yours. */
  closeness: number;
}

/**
 * The nearest real files to this profile. Ranked on GPA proximity first, then
 * on whether they came from the same kind of institution, studied the same
 * family of subject, applied where you're applying, and how recent they are.
 */
export function findSimilar(p: Profile, targets: string[], n = 3): MatchedProfile[] {
  const fam = FAMILY_OF[p.major];
  const tIdx = new Set(
    targets.map((t) => DATA.schools.indexOf(t)).filter((i) => i >= 0),
  );
  const [minY, maxY] = DATA.meta.years;
  const span = Math.max(1, maxY - minY);

  // Rank inside the stated match window, so anything we call a match really
  // is one. Only when the window holds too few files do we fall back to the
  // whole corpus — otherwise the returned set would contradict the filter we
  // just showed the user.
  const eligible = DATA.people.filter(
    (r) => Math.abs(r.g - p.gpa) <= MATCH_WINDOW && r.f === fam && (r.i === p.institution || r.i === "unk"),
  );
  const pool = eligible.length >= n ? eligible : DATA.people;

  const scored = pool.map((r) => {
    // GPA proximity dominates: a file half a point away is not your file.
    const near = Math.max(0, 1 - Math.abs(r.g - p.gpa) / 0.45);
    let s = near * 3;
    if (r.f === fam) s += 1.6;
    if (r.i === p.institution) s += 1.2;
    else if (r.i === "unk") s += 0.25;
    s += ((r.y - minY) / span) * 0.7;
    const shared = [...r.a, ...r.d].filter((i) => tIdx.has(i));
    s += Math.min(shared.length, 3) * 0.6;
    s += Math.min(r.a.length + r.d.length, 6) * 0.12;
    return { r, s, shared };
  });

  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, n);
  const best = top[0]?.s || 1;

  return top.map(({ r, s, shared }) => ({
    gpa: r.g,
    major: r.m,
    institution: r.i === "unk" ? null : r.i,
    institutionLabel: r.i === "unk" ? null : INST_LABEL[r.i],
    year: r.y,
    admits: r.a.map((i) => DATA.schools[i]),
    denies: r.d.map((i) => DATA.schools[i]),
    sharedTargets: [...new Set(shared.map((i) => DATA.schools[i]))],
    closeness: Math.min(1, s / Math.max(best, 1)),
  }));
}

export interface AdmitSignature {
  school: string;
  /** Observed admitted files in the corpus. */
  n: number;
  nDenied: number;
  gpaP25: number;
  gpaMedian: number;
  gpaP75: number;
  topMajors: string[];
  /** Share of admits from a community college, among those whose
   *  institution was actually recorded. null when too few were. */
  ccShare: number | null;
  ccKnown: number;
}

/** Below this the sample says nothing, so we return null instead of a number
 *  that would read as authoritative. */
const MIN_SIGNATURE_N = 8;

/** What the admitted files at this school actually look like, from the corpus.
 *  Returns null when we have too few observed admits to say anything. */
export function admitSignature(school: string): AdmitSignature | null {
  const i = DATA.schools.indexOf(school);
  if (i < 0) return null;
  const admitted = DATA.people.filter((r) => r.a.includes(i));
  if (admitted.length < MIN_SIGNATURE_N) return null;

  const gpas = admitted.map((r) => r.g).sort((a, b) => a - b);
  const q = (f: number) => gpas[Math.min(gpas.length - 1, Math.floor(gpas.length * f))];
  const mid = gpas.length % 2
    ? gpas[(gpas.length - 1) / 2]
    : (gpas[gpas.length / 2 - 1] + gpas[gpas.length / 2]) / 2;

  const counts = new Map<string, number>();
  for (const r of admitted) counts.set(r.m, (counts.get(r.m) || 0) + 1);
  const topMajors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m]) => m);

  const known = admitted.filter((r) => r.i !== "unk");
  const cc = known.filter((r) => r.i === "cc").length;

  return {
    school,
    n: admitted.length,
    nDenied: DATA.people.filter((r) => r.d.includes(i)).length,
    gpaP25: q(0.25),
    gpaMedian: mid,
    gpaP75: q(0.75),
    topMajors,
    ccShare: known.length >= MIN_SIGNATURE_N ? cc / known.length : null,
    ccKnown: known.length,
  };
}

/** Signatures for a target list, strongest sample first, thin ones dropped. */
export function admitSignatures(targets: string[], n = 3): AdmitSignature[] {
  return targets
    .map(admitSignature)
    .filter((s): s is AdmitSignature => s !== null)
    .sort((a, b) => b.n - a.n)
    .slice(0, n);
}
