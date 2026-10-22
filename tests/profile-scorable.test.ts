// Defect #3: the profile-completeness badge showed "Fill in" even when the
// required fields were present.
//
// Root cause: isProfileScorable() in Audit.tsx used "differs from the default"
// as a proxy for "the user filled this in" — but DEFAULT_PROFILE.gpa is 3.8
// and DEFAULT_PROFILE.major is "cs". A real 3.8 applicant, or anyone applying
// in CS (the most common transfer major in this product), was told to
// "Fill in" despite a complete profile.
//
// The brief asks for required fields to be DEFINED EXPLICITLY. They are now a
// presence/validity check, not a default comparison.

import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../src/engine";
import type { Profile } from "../src/engine";
import { isGpaValid, isProfileScorable } from "../src/lib/profile";

const profile = (over: Partial<Profile> = {}): Profile => ({ ...DEFAULT_PROFILE, ...over });

describe("isProfileScorable — by presence of required fields, not default-difference", () => {
  it("a real 3.8 CS applicant (both equal to the defaults) is scorable", () => {
    expect(DEFAULT_PROFILE.gpa).toBe(3.8); // guards the regression's premise
    expect(DEFAULT_PROFILE.major).toBe("cs");
    expect(isProfileScorable(profile({ gpa: 3.8, major: "cs" }))).toBe(true);
  });

  it("scores any applicant with a valid GPA, institution, standing and major", () => {
    expect(isProfileScorable(profile({ gpa: 2.5, major: "undecided", institution: "public4" }))).toBe(true);
    expect(isProfileScorable(profile({ gpa: 4.0, major: "business", standing: "sophomore" }))).toBe(true);
  });

  it("rejects a profile with no usable GPA", () => {
    expect(isProfileScorable(profile({ gpa: Number.NaN }))).toBe(false);
    expect(isProfileScorable(profile({ gpa: 0 }))).toBe(false);
  });
});

describe("isGpaValid — rejects garbage, accepts real transfer GPAs", () => {
  it("accepts GPAs on a normal scale and rejects non-finite/out-of-range", () => {
    expect(isGpaValid(3.8)).toBe(true);
    expect(isGpaValid(2.5)).toBe(true);
    expect(isGpaValid(4.0)).toBe(true);
    expect(isGpaValid(0)).toBe(false);
    expect(isGpaValid(-1)).toBe(false);
    expect(isGpaValid(Number.NaN)).toBe(false);
    expect(isGpaValid(10)).toBe(false);
  });
});
