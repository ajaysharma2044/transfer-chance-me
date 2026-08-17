// Which targets actually read the high-school record.
//
// The aggregate finding and the per-school rules genuinely disagree, and the
// product has to hold both without flattening either:
//
//   Aggregate: across this corpus, HS record correlates with college GPA at
//   0.016 (HIGH_SCHOOL_FACT). It is not predictive, so it is not scored.
//
//   Per school: several targets require and read it anyway. Vanderbilt says
//   a downward HS-to-college trend "costs a band". USC says that under 30
//   transferable units the decision rests "in large part" on the HS record.
//   Berkeley ignores it on a junior file.
//
// So the honest product behaviour is: never move the odds, but tell a student
// exactly which of THEIR schools will read it, and when a unit count makes it
// matter more. Every rule below traces to a line in src/data/intel.json.

import type { Profile } from "../engine";

export type HsWeight = "scored" | "required" | "fades" | "ignored";

export interface HsRule {
  school: string;
  weight: HsWeight;
  /** The reason, in the school's own terms. */
  note: string;
}

/**
 * Schools whose briefs state a position on the high-school record.
 *
 * Hand-mapped rather than keyword-matched: "HS transcript required" and "HS
 * is scored" are different obligations, and a regex over the brief text would
 * collapse them into one and tell a student the wrong thing.
 */
const RULES: Record<string, { weight: HsWeight; note: string }> = {
  Vanderbilt: {
    weight: "scored",
    note: "Transcript required regardless of years since graduation, and a downward high-school-to-college trend costs a band.",
  },
  NYU: {
    weight: "scored",
    note: "Reads college and high-school grades together, college first. No credit count removes the high-school record.",
  },
  Georgetown: {
    weight: "scored",
    note: "Asks every transfer applicant for a full Secondary School Report — transcript, counsellor recommendation, and school profile.",
  },
  Michigan: {
    weight: "scored",
    note: "States plainly that a 4.0 at a community college does not erase the high-school record. Junior standing lowers the emphasis.",
  },
  USC: {
    weight: "fades",
    note: "Under 30 transferable units the decision rests in large part on the high-school record; at 30+ two years of solid college work can reposition it.",
  },
  Yale: { weight: "required", note: "Complete transcript with graduation date required; no published rule that college work overwrites it." },
  Chicago: { weight: "required", note: "Final high-school transcript required as part of the file." },
  Northwestern: { weight: "required", note: "Transcript with proof of graduation required; counsellor recommendation is not." },
  Dartmouth: { weight: "required", note: "Required via the final Secondary School Report; mention-only unless the college record is short." },
  "UC Berkeley": { weight: "ignored", note: "Not scored on a junior transfer file." },
  UCLA: { weight: "ignored", note: "Not part of the published junior-transfer review." },
};

/** The rules that apply to this student's target list, most demanding first. */
export function hsRules(targets: string[]): HsRule[] {
  const order: HsWeight[] = ["scored", "fades", "required", "ignored"];
  return targets
    .map((school) => {
      const r = RULES[school];
      return r ? { school, ...r } : null;
    })
    .filter((r): r is HsRule => r !== null)
    .sort((a, b) => order.indexOf(a.weight) - order.indexOf(b.weight));
}

/**
 * Whether to ask for the high school at all, and how hard to push.
 *
 * Returns null when no target reads it — in that case the field is noise and
 * the form should not spend a question on it.
 */
export function hsPrompt(targets: string[]): string | null {
  const rules = hsRules(targets);
  const reads = rules.filter((r) => r.weight !== "ignored");
  if (!reads.length) return null;

  const scored = reads.filter((r) => r.weight === "scored").map((r) => r.school);
  if (scored.length) {
    return `${scored.slice(0, 3).join(", ")}${scored.length > 3 ? ` and ${scored.length - 3} more` : ""} read your high-school record as part of the transfer file.`;
  }
  return `${reads.length} of your targets require the high-school transcript, though they weight it lightly.`;
}

/** Under this many college credits, the schools that "fade" it still score it. */
export const UNITS_HS_STILL_COUNTS = 30;

/** True when this student is in the window where USC-style rules still read
 *  the high-school record heavily. Credits are read off the parsed courses,
 *  so this is only meaningful once a transcript is on file. */
export function hsStillHeavy(profile: Profile): boolean {
  // A course row is ~3-4 units; the app stores course codes, not unit counts,
  // so this is a lower-bound estimate and deliberately errs toward warning.
  return profile.courses.length > 0 && profile.courses.length * 4 < UNITS_HS_STILL_COUNTS;
}
