// What makes a profile "scorable" — the fields the audit needs before it can
// say anything specific, stated EXPLICITLY (brief §6's "minimum usable
// profile", minus the target school which is gated separately by the tracker
// count).
//
// Checked for presence and validity, never for "differs from the default":
// DEFAULT_PROFILE.gpa is 3.8 and DEFAULT_PROFILE.major is "cs", so a
// default-difference test told a real 3.8 / CS applicant — a completely
// ordinary one — that their profile was unfinished. See
// tests/profile-scorable.test.ts.

import type { Profile } from "../engine";

/** The required fields, named so the UI and tests share one definition. */
export const REQUIRED_PROFILE_FIELDS = ["gpa", "institution", "standing", "major"] as const;

/** A GPA we can actually position against admit distributions. Bounds reject
 *  NaN / 0 / nonsense without policing scale — weighted transcripts can read
 *  a little above 4.0, and a false "unfinished" is the worse error here. */
export function isGpaValid(gpa: number): boolean {
  return Number.isFinite(gpa) && gpa > 0 && gpa <= 5;
}

/** True once the audit has enough to produce something specific: a usable
 *  GPA plus a chosen institution, standing and major (all enum-valued, so
 *  always set — the operative check is the GPA). */
export function isProfileScorable(p: Profile): boolean {
  return isGpaValid(p.gpa) && !!p.institution && !!p.standing && !!p.major;
}
