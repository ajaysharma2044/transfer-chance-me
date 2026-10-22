// What makes a profile usable, stated explicitly (docs/spec.md §4).
//
// Two separate questions:
//   · isProfileScorable — are the required VALUES present and valid, so the
//     engine can compute from them?
//   · profileReadiness  — has the student CONFIRMED them? Readiness is
//     confirmation, never "differs from the default": DEFAULT_PROFILE.gpa is
//     3.8 and .major is "cs", and a real 3.8 / CS applicant must be able to
//     confirm exactly those values. Values filled by extraction are candidates
//     until confirmed. Legacy profiles load with nothing confirmed and are
//     offered the one-click confirmAll() review action rather than being erased.
//
// See tests/profile-scorable.test.ts and tests/profile-readiness.test.ts.

import type { ConfirmField, Confirmed, Profile } from "../engine";

/** The required fields, in the order the UI lists them. */
export const REQUIRED_CONFIRM_FIELDS: readonly ConfirmField[] = ["gpa", "institution", "standing", "major"];
/** @deprecated alias kept for older imports. */
export const REQUIRED_PROFILE_FIELDS = REQUIRED_CONFIRM_FIELDS;

/** A GPA we can actually position against admit distributions. Bounds reject
 *  NaN / 0 / nonsense without policing scale — weighted transcripts can read
 *  a little above 4.0, and a false "unfinished" is the worse error here. */
export function isGpaValid(gpa: number): boolean {
  return Number.isFinite(gpa) && gpa > 0 && gpa <= 5;
}

function fieldValid(p: Profile, f: ConfirmField): boolean {
  switch (f) {
    case "gpa": return isGpaValid(p.gpa);
    case "institution": return !!p.institution;
    case "standing": return !!p.standing;
    case "major": return !!p.major;
  }
}

/** True once the engine has usable values for every required field. Says
 *  nothing about whether the student has confirmed them. */
export function isProfileScorable(p: Profile): boolean {
  return REQUIRED_CONFIRM_FIELDS.every((f) => fieldValid(p, f));
}

export interface Readiness {
  ready: boolean;
  /** Required fields whose current value is not usable. */
  invalid: ConfirmField[];
  /** Required fields with a usable value the student has not yet confirmed. */
  unconfirmed: ConfirmField[];
}

/** Ready = every required field is valid AND confirmed. */
export function profileReadiness(p: Profile): Readiness {
  const confirmed = p.confirmed ?? {};
  const invalid = REQUIRED_CONFIRM_FIELDS.filter((f) => !fieldValid(p, f));
  const unconfirmed = REQUIRED_CONFIRM_FIELDS.filter((f) => fieldValid(p, f) && !confirmed[f]);
  return { ready: invalid.length === 0 && unconfirmed.length === 0, invalid, unconfirmed };
}

/**
 * Confirmation implied by a MANUAL edit: touching a required field confirms it
 * and only it. Picking the current school sets `schoolName` and counts as
 * confirming the institution. Never call this for extraction output — an
 * extracted value is a candidate until the student confirms it.
 */
export function confirmFor(patch: Partial<Profile>): Confirmed {
  const out: Confirmed = {};
  for (const f of REQUIRED_CONFIRM_FIELDS) if (f in patch) out[f] = true;
  // Picking a school confirms the institution it implies; clearing the name
  // (schoolName: null) rejects a parsed value and confirms nothing.
  if (patch.schoolName) out.institution = true;
  return out;
}

/** The single review action: confirm every required field that currently
 *  holds a valid value. Invalid fields stay unconfirmed; nothing else changes. */
export function confirmAll(p: Profile): Profile {
  const confirmed: Confirmed = { ...(p.confirmed ?? {}) };
  for (const f of REQUIRED_CONFIRM_FIELDS) if (fieldValid(p, f)) confirmed[f] = true;
  return { ...p, confirmed };
}

/** Human labels for the required fields, for badges and checklists. */
export const CONFIRM_FIELD_LABEL: Record<ConfirmField, string> = {
  gpa: "GPA",
  institution: "current school",
  standing: "standing",
  major: "major",
};
