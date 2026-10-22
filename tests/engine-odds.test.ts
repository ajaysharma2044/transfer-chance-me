// Regression tests for the odds engine — specifically the "compression" bug
// where a near-open-admission school rated a mid-GPA applicant as a reach.
//
// Root cause (engine.ts positional heuristic): for a school with no published
// study GPA percentiles, the engine fabricated an ELITE admit distribution
// (median 3.95, p25 3.83) regardless of the school's selectivity, and ignored
// the observed admit percentiles the outcome corpus already holds for many of
// these schools. A 3.04 applicant then sat ~9σ below a fabricated 3.95 median,
// collapsing a 92.6%-admit school (Sacramento State) to ~18% and a 100%-admit
// school (Cleveland State) to ~17%.
//
// The fix: prefer observed corpus percentiles (admitSignature) over any
// fabrication, and when none exist, scale the estimated median off the
// official admit rate instead of assuming every school is elite.
//
// These assert PROPERTIES (floors, ordering, tier bounds), not the engine's
// exact output numbers — the brief is explicit that we don't force numerical
// agreement, so the thresholds are deliberately loose and defensible.

import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, estimate, estimateAll, MODEL } from "../src/engine";
import type { Profile, School } from "../src/engine";

const school = (name: string): School => {
  const s = MODEL.schools.find((x) => x.name === name);
  if (!s) throw new Error(`test fixture drift: ${name} is not in MODEL.schools`);
  return s;
};
const profile = (over: Partial<Profile> = {}): Profile => ({ ...DEFAULT_PROFILE, ...over });

const REACHY = new Set(["Reach", "High reach", "Long shot"]);

describe("odds engine — near-open-admission schools are not compressed into reaches", () => {
  // The flagship reported case. Sacramento State admits 92.6% of transfer
  // applicants and the corpus records admits with a median GPA of ~3.59.
  it("Sacramento State (92.6% rate) rates a 3.04 CS applicant well above a reach", () => {
    const p = profile({ gpa: 3.04, major: "cs", institution: "public4", standing: "junior" });
    const e = estimate(p, school("Sacramento State"));

    expect(e.p).toBeGreaterThanOrEqual(0.4);
    expect(["Likely", "Strong target"]).toContain(e.tier);
  });

  // Cleveland State admits ~100% and the corpus has too few admits to form an
  // observed signature, so this exercises the rate-scaled fallback.
  it("Cleveland State (100% rate, no observed sample) rates a 3.04 CS applicant Likely", () => {
    const p = profile({ gpa: 3.04, major: "cs", institution: "public4", standing: "junior" });
    const e = estimate(p, school("Cleveland State"));

    expect(e.p).toBeGreaterThanOrEqual(0.5);
    expect(e.tier).toBe("Likely");
  });

  // Generalized invariant: a clearly strong applicant (3.7) at ANY school that
  // admits 90%+ of applicants must land "Likely". Under the bug, the fabricated
  // 3.95 median pushed even 3.7 below Likely at these schools.
  it("every school admitting ≥90% rates a strong 3.7 applicant Likely", () => {
    const p = profile({ gpa: 3.7, major: "social", institution: "cc", caResident: false, standing: "junior" });
    const highAdmit = MODEL.schools.filter((s) => s.rate >= 90);

    expect(highAdmit.length).toBeGreaterThan(5);
    for (const s of highAdmit) {
      const e = estimate(p, s);
      expect(e.tier, `${s.name} (rate ${s.rate}) → ${(e.p * 100).toFixed(0)}% ${e.tier}`).toBe("Likely");
    }
  });
});

describe("odds engine — selective-school behavior is preserved", () => {
  // Guard: the same weak CS profile must stay a reach at genuinely selective
  // schools. This passes before and after the fix; it exists so the fix can't
  // silently inflate the selective end.
  it("a 3.04 CS applicant stays a reach at UCLA and MIT", () => {
    const p = profile({ gpa: 3.04, major: "cs", institution: "public4", standing: "junior" });
    for (const name of ["UCLA", "MIT"]) {
      const e = estimate(p, school(name));
      expect(e.p, `${name} → ${(e.p * 100).toFixed(1)}%`).toBeLessThan(0.12);
      expect(REACHY.has(e.tier), `${name} tier ${e.tier}`).toBe(true);
    }
  });

  it("raising GPA never lowers the estimate at the same school", () => {
    for (const name of ["Sacramento State", "UCLA", "UC Riverside", "Cleveland State"]) {
      const s = school(name);
      const base: Partial<Profile> = { major: "cs", institution: "public4", standing: "junior" };
      const low = estimate(profile({ ...base, gpa: 3.0 }), s).p;
      const high = estimate(profile({ ...base, gpa: 3.9 }), s).p;
      expect(high, `${name}: 3.9 should be ≥ 3.0`).toBeGreaterThanOrEqual(low);
    }
  });
});

describe("odds engine — global invariants hold for every school", () => {
  it("no estimate exceeds the 0.85 honesty cap, across a spread of profiles", () => {
    const files = [
      profile({ gpa: 4.0, major: "social", institution: "cc", caResident: true, igetc: true, standing: "junior" }),
      profile({ gpa: 3.5, major: "cs", institution: "public4", standing: "junior" }),
      profile({ gpa: 2.5, major: "business", institution: "private4", standing: "sophomore" }),
    ];
    for (const p of files) {
      for (const e of estimateAll(p)) {
        // TAG guarantees are the one deliberate exception (p = 0.95).
        if (e.tier === "TAG guarantee") continue;
        expect(e.p, `${e.school.name} → ${e.p}`).toBeLessThanOrEqual(0.85);
      }
    }
  });
});
