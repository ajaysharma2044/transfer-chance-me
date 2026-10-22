// Stage A (docs/spec.md §4): readiness is EXPLICIT confirmation of the required
// fields — never "differs from the default". A confirmed 3.8 / CS / junior must
// unlock (those equal the defaults); an untouched default profile must not; a
// GPA edit confirms only GPA; values applied by extraction stay unconfirmed
// until the user confirms them in one action.

import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../src/engine";
import type { Profile } from "../src/engine";
import { confirmAll, confirmFor, profileReadiness, REQUIRED_CONFIRM_FIELDS } from "../src/lib/profile";

const profile = (over: Partial<Profile> = {}): Profile => ({ ...DEFAULT_PROFILE, ...over });
const ALL = { gpa: true, institution: true, standing: true, major: true } as const;

describe("profileReadiness — explicit confirmation; defaults never count", () => {
  it("an untouched default profile is NOT ready and names every unconfirmed field", () => {
    const r = profileReadiness(profile());
    expect(r.ready).toBe(false);
    expect(r.unconfirmed).toEqual([...REQUIRED_CONFIRM_FIELDS]);
  });

  it("a confirmed 3.8 / CS / junior profile IS ready even though the values equal the defaults", () => {
    const p = profile({ gpa: 3.8, major: "cs", standing: "junior", confirmed: { ...ALL } });
    expect(profileReadiness(p).ready).toBe(true);
  });

  it("partial confirmation is not ready and reports exactly what is left", () => {
    const r = profileReadiness(profile({ confirmed: { gpa: true, major: true } }));
    expect(r.ready).toBe(false);
    expect(r.unconfirmed).toEqual(["institution", "standing"]);
  });

  it("a confirmed but invalid GPA is not ready and is reported as invalid", () => {
    const r = profileReadiness(profile({ gpa: Number.NaN, confirmed: { ...ALL } }));
    expect(r.ready).toBe(false);
    expect(r.invalid).toContain("gpa");
  });
});

describe("confirmFor — a manual edit confirms only what it touched", () => {
  it("editing GPA confirms gpa and nothing else", () => {
    expect(confirmFor({ gpa: 3.4 })).toEqual({ gpa: true });
  });

  it("picking the current school confirms institution", () => {
    expect(confirmFor({ schoolName: "De Anza College", institution: "cc" })).toEqual({ institution: true });
  });

  it("editing an unrelated field confirms nothing", () => {
    expect(confirmFor({ essayText: "x", activitiesText: "y" })).toEqual({});
  });
});

describe("confirmAll — the single review/confirm action for migrated or extracted values", () => {
  it("confirms every required field that currently holds a valid value", () => {
    const p = confirmAll(profile({ gpa: 3.52, major: "econ" }));
    expect(profileReadiness(p).ready).toBe(true);
  });

  it("never confirms a field whose value is invalid", () => {
    const p = confirmAll(profile({ gpa: 0 }));
    expect(p.confirmed.gpa).toBeUndefined();
    expect(profileReadiness(p).ready).toBe(false);
  });

  it("does not touch fields that are not part of readiness", () => {
    const p = confirmAll(profile({ essayText: "keep me" }));
    expect(p.essayText).toBe("keep me");
  });
});
