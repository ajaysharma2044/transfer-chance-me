// Major-level transfer detail: at most universities the campus-wide admit
// rate is nearly meaningless, because admission is decided by major or by
// undergraduate school and the spread between them is enormous.
//
// Researched from each university's own pages. Partial coverage by design —
// a school we haven't verified shows nothing rather than a guess.

import majorsData from "../data/majors.json";

export type MajorStatus = "open" | "competitive" | "impacted" | "closed";

export interface MajorEntry {
  name: string;
  status: MajorStatus;
  /** Published major-level transfer admit rate, when the school publishes one. */
  rate: number | null;
  prereqs: string[];
  note: string;
}

export interface SchoolMajors {
  name: string;
  /** Admission is decided at the major/school level rather than campus-wide. */
  byMajor: boolean;
  majors: MajorEntry[];
  source: string | null;
  note: string;
}

const DATA = majorsData as unknown as SchoolMajors[];
const BY_NAME = new Map(DATA.map((s) => [s.name, s]));

export function majorsFor(school: string): SchoolMajors | null {
  return BY_NAME.get(school) ?? null;
}

export const MAJOR_COVERAGE = DATA.length;

export const STATUS_LABEL: Record<MajorStatus, string> = {
  open: "Open",
  competitive: "Competitive",
  impacted: "Impacted",
  closed: "Closed to transfers",
};

export const STATUS_BLURB: Record<MajorStatus, string> = {
  open: "Admits transfers routinely — no extra screen beyond getting into the school",
  competitive: "Admits transfers, but materially below the campus-wide rate",
  impacted: "Severely restricted — extra requirements and far fewer seats",
  closed: "Not reachable by external transfer",
};
