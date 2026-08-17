// Tests for src/lib/band.ts and src/lib/blockers.ts.
//
// The properties under test, stated plainly:
//
//   · admitBand() has exactly three states, each carrying its own n and its
//     own printed caption, and the two banded states never share a word for
//     their corpus — a study band (model.json percentiles) and an observed
//     band (the outcome corpus) are different claims about different files.
//   · kind "none" produces NO BAR: every percentile is null, so there is
//     nothing a renderer could draw. 167 of 208 schools are in this state and
//     it has to be correct before the happy path is.
//   · the caption of a "none" school never asserts zero admits when the
//     corpus actually recorded some — it counts them and says they are too
//     few.
//   · blockerFor() precedence: structural rungs 1–5 can never be pre-empted
//     by fixable rungs 6–9, and the rungs inside each group order correctly.
//
// Everything is checked against the real shipped data. No fixtures.

import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, estimate, MODEL, tagFloor } from "../src/engine";
import type { Profile, School } from "../src/engine";
import { admitBand, bandPos, BAND_MAX, BAND_MIN } from "../src/lib/band";
import { blockerFor } from "../src/lib/blockers";
import { admitSignature, observedAdmits } from "../src/lib/similar";
import { analyzeCourses } from "../src/lib/coursework";
import type { CourseGaps } from "../src/lib/coursework";

const school = (name: string): School => {
  const s = MODEL.schools.find((x) => x.name === name);
  if (!s) throw new Error(`test fixture drift: ${name} is not in MODEL.schools`);
  return s;
};

const profile = (over: Partial<Profile> = {}): Profile => ({ ...DEFAULT_PROFILE, ...over });

/** A file with every core requirement covered — lets rung 9 be switched off
 *  without hand-building a transcript. */
const NO_GAPS: CourseGaps = {
  major: "humanities",
  statuses: [],
  coreDone: 0,
  coreTotal: 0,
  missingCore: [],
  extras: [],
  unmatched: [],
};

/* ── band.ts ────────────────────────────────────────────────────────────── */

describe("admitBand — the three states", () => {
  it("study: published percentiles, n from the study, captioned as study", () => {
    const ucla = school("UCLA");
    const b = admitBand(ucla);

    expect(b.kind).toBe("study");
    expect(b.p25).toBe(ucla.gpa.p25);
    expect(b.p50).toBe(ucla.gpa.p50);
    expect(b.p75).toBe(ucla.gpa.p75);
    expect(b.n).toBe(ucla.nGpa);
    expect(b.caption).toBe(`n=${ucla.nGpa} study admits`);
    expect(b.caption).not.toContain("observed");
  });

  it("observed: outcome-corpus percentiles, n from the signature", () => {
    const ucsb = school("UC Santa Barbara");
    const sig = admitSignature("UC Santa Barbara");

    expect(ucsb.gpa.p50).toBeNull();           // no study band exists here
    expect(sig).not.toBeNull();

    const b = admitBand(ucsb);
    expect(b.kind).toBe("observed");
    expect(b.n).toBe(sig!.n);
    expect(b.p25).toBe(sig!.gpaP25);
    expect(b.p50).toBe(sig!.gpaMedian);
    expect(b.p75).toBe(sig!.gpaP75);
    expect(b.caption).toBe(`n=${sig!.n} observed admits`);
    expect(b.caption).not.toContain("study");
  });

  it("none: no percentiles at all, and the caption says why", () => {
    // A school the corpus never recorded a single admit at.
    const zero = MODEL.schools.find(
      (s) => s.gpa.p50 == null && !admitSignature(s.name) && observedAdmits(s.name) === 0,
    );
    expect(zero).toBeDefined();

    const b = admitBand(zero!);
    expect(b.kind).toBe("none");
    expect(b.n).toBe(0);
    expect(b.caption).toBe("no observed admits · official rate only");
  });

  it("none: a thin school counts its admits rather than claiming it has none", () => {
    const tulane = school("Tulane");
    const observed = observedAdmits("Tulane");

    expect(observed).toBeGreaterThan(0);
    expect(admitSignature("Tulane")).toBeNull();   // under the signature floor

    const b = admitBand(tulane);
    expect(b.kind).toBe("none");
    expect(b.caption).toBe(`${observed} observed admits · too few to band`);
    expect(b.caption).not.toContain("no observed admits");
  });
});

describe('admitBand — kind "none" really produces no bar', () => {
  it("every none-band school has all three percentiles null and n = 0", () => {
    const nones = MODEL.schools.map(admitBand).filter((b) => b.kind === "none");

    expect(nones.length).toBeGreaterThan(0);
    for (const b of nones) {
      expect(b.p25).toBeNull();
      expect(b.p50).toBeNull();
      expect(b.p75).toBeNull();
      expect(b.n).toBe(0);
    }
  });

  it("no non-none band is ever missing a percentile — nothing renders half a bar", () => {
    for (const b of MODEL.schools.map(admitBand)) {
      if (b.kind === "none") continue;
      expect(b.p25).not.toBeNull();
      expect(b.p50).not.toBeNull();
      expect(b.p75).not.toBeNull();
      expect(b.n).toBeGreaterThan(0);
    }
  });
});

describe("admitBand — coverage and provenance", () => {
  it("41 of 208 schools are banded: 24 study, 17 observed, 167 none", () => {
    const kinds = MODEL.schools.map((s) => admitBand(s).kind);
    const count = (k: string) => kinds.filter((x) => x === k).length;

    expect(MODEL.schools.length).toBe(208);
    expect(count("study")).toBe(24);
    expect(count("observed")).toBe(17);
    expect(count("none")).toBe(167);
    expect(count("study") + count("observed")).toBe(41);
  });

  it("a study n and an observed count are never the same number", () => {
    // UCLA: 271 study files with a GPA, 124 recorded admits in the corpus.
    const b = admitBand(school("UCLA"));
    expect(b.n).toBe(271);
    expect(b.observed).toBe(124);
    expect(b.n).not.toBe(b.observed);
  });

  it("the axis is fixed and positions clamp to it", () => {
    expect(BAND_MIN).toBe(3.2);
    expect(BAND_MAX).toBe(4.0);
    expect(bandPos(3.2)).toBe(0);
    expect(bandPos(4.0)).toBe(100);
    expect(bandPos(3.6)).toBeCloseTo(50, 6);
    // Four real bands sit just under the floor; they clip, never go negative.
    expect(bandPos(3.1)).toBe(0);
    expect(bandPos(4.3)).toBe(100);
  });

  it("admitSignature is memoized — repeated calls return the same object", () => {
    expect(admitSignature("UC Santa Barbara")).toBe(admitSignature("UC Santa Barbara"));
  });
});

/* ── blockers.ts ────────────────────────────────────────────────────────── */

/** cc + CA resident + junior: all three TAG gates open. */
const TAG_READY: Partial<Profile> = {
  institution: "cc",
  caResident: true,
  standing: "junior",
};

const blockAt = (p: Profile, name: string, gaps: CourseGaps = NO_GAPS) =>
  blockerFor(p, estimate(p, school(name)), gaps);

describe("blockerFor — the structural rungs, in order", () => {
  it("1 · TAG fires when a floor exists, the gates open and the GPA clears", () => {
    const p = profile({ ...TAG_READY, major: "cs", gpa: 3.9 });
    expect(tagFloor("UC Riverside", "cs")).toBe(3.6);

    const b = blockAt(p, "UC Riverside");
    expect(b.kind).toBe("TAG");
    expect(b.tone).toBe("teal");
    expect(b.clause).toBe("file by Sep 30 · voids without Nov 30");
    expect(b.structural).toBe(false);   // a guarantee is not a blockage
  });

  it("2 · GPA fires against THIS major's floor, not the campus minimum", () => {
    const p = profile({ ...TAG_READY, major: "cs", gpa: 3.0 });
    // Campus floor is 2.7; CS is 3.6. A 3.0 CS applicant is short, not clear.
    const b = blockAt(p, "UC Riverside");

    expect(b.kind).toBe("GPA");
    expect(b.tone).toBe("coral");
    expect(b.clause).toBe("3.00 → 3.60 for TAG in your major");
    expect(b.structural).toBe(true);
  });

  it("3 · GATE names only the first failing gate, and outranks STANDING", () => {
    const p = profile({
      institution: "private4", caResident: false, standing: "sophomore", gpa: 3.9,
    });
    const b = blockAt(p, "UC Riverside");

    expect(b.kind).toBe("GATE");
    expect(b.tone).toBe("ink");
    expect(b.clause).toBe("TAG needs community-college enrollment");
    expect(b.all).toContain("STANDING");   // fired, but rung 4
    expect(b.all.indexOf("GATE")).toBeLessThan(b.all.indexOf("STANDING"));
  });

  it("4 · STANDING fires at a UC with no TAG when entry is not junior", () => {
    const p = profile({ ...TAG_READY, standing: "sophomore", gpa: 3.95 });
    expect(tagFloor("UCLA", p.major)).toBeNull();

    const b = blockAt(p, "UCLA");
    expect(b.kind).toBe("STANDING");
    expect(b.clause).toBe("UC transfers enter at junior standing");
    expect(b.structural).toBe(true);
  });

  it("5 · BAND names its distance and its corpus, and never mislabels it", () => {
    const p = profile({ ...TAG_READY, major: "humanities", gpa: 3.5 });
    const b = blockAt(p, "UCLA");

    expect(b.kind).toBe("BAND");
    expect(b.tone).toBe("coral");
    expect(b.clause).toBe("0.27 under p25 of 271 study admits");
    expect(b.structural).toBe(true);
  });

  it("a school with no band can never raise a BAND rung", () => {
    const p = profile({ gpa: 2.0 });
    const b = blockAt(p, "Tulane");
    expect(admitBand(school("Tulane")).kind).toBe("none");
    expect(b.all).not.toContain("BAND");
  });
});

describe("blockerFor — fixable rungs never pre-empt structural ones", () => {
  it("a sophomore four-year-private with no essay is told about the gate, not the essay", () => {
    const p = profile({
      institution: "private4", caResident: false, standing: "sophomore",
      gpa: 3.9, essayText: "", essayNamed: [],
    });
    const b = blockAt(p, "UC Riverside", analyzeCourses(p));

    expect(b.kind).toBe("GATE");
    expect(b.all).toContain("ESSAY");
    expect(b.all).toContain("PREP");
    expect(b.all.indexOf("GATE")).toBeLessThan(b.all.indexOf("ESSAY"));
    expect(b.all.indexOf("GATE")).toBeLessThan(b.all.indexOf("PREP"));
    expect(b.extra).toBeGreaterThan(0);
  });

  it("6 · TONE outranks every essay and prep rung", () => {
    const p = profile({
      gpa: 3.95, essayText: "I hate it here and this place is a waste.",
      essayVerdict: "complaint", essayNamed: [],
    });
    const b = blockAt(p, "Tulane", analyzeCourses(p));

    expect(b.kind).toBe("TONE");
    expect(b.tone).toBe("accent");
    expect(b.clause).toBe("reads complaint-shaped");
    expect(b.all[1]).toBe("ESSAY");
  });

  it("6 · TONE quotes the real signal counts when the analysis is passed in", () => {
    const p = profile({ gpa: 3.95, essayVerdict: "complaint", essayText: "x" });
    const e = estimate(p, school("Tulane"));
    const b = blockerFor(p, e, NO_GAPS, {
      words: 1, namedSchools: [], matches: {}, professorMentions: 0,
      fitScore: 2, complaintScore: 4, verdict: "complaint", notes: [],
    });

    expect(b.clause).toBe("reads complaint-shaped · 4 vs 2 signals");
  });

  it("7 · no draft on file outranks 8 · draft that names nothing", () => {
    const p = profile({ gpa: 3.95, essayText: "", essayNamed: [] });
    const b = blockAt(p, "Tulane");

    expect(b.kind).toBe("ESSAY");
    expect(b.clause).toBe("no why-transfer draft on file");
    expect(b.extra).toBe(1);            // rung 8 also fired
  });

  it("8 · a draft that names no specifics for THIS school", () => {
    const p = profile({ gpa: 3.95, essayText: "A real draft.", essayNamed: ["UCLA"] });
    const b = blockAt(p, "Tulane");

    expect(b.kind).toBe("ESSAY");
    expect(b.clause).toBe("essay names no Tulane specifics");
    expect(b.extra).toBe(0);
  });

  it("9 · PREP is last, and counts the real open requirements", () => {
    const p = profile({ gpa: 3.95, essayText: "A real draft.", essayNamed: ["Tulane"] });
    const gaps = analyzeCourses(p);
    const b = blockAt(p, "Tulane", gaps);

    expect(gaps.missingCore.length).toBeGreaterThan(0);
    expect(b.kind).toBe("PREP");
    expect(b.tone).toBe("blue");
    expect(b.clause).toBe(
      `${gaps.missingCore.length} core courses open · ${gaps.missingCore[0].label}`,
    );
    expect(b.structural).toBe(false);
  });

  it("10 · NONE when nothing fires", () => {
    const p = profile({ gpa: 3.95, essayText: "A real draft.", essayNamed: ["Tulane"] });
    const b = blockAt(p, "Tulane", NO_GAPS);

    expect(b.kind).toBe("NONE");
    expect(b.tone).toBe("ink");
    expect(b.clause).toBe("nothing blocking on file");
    expect(b.extra).toBe(0);
    expect(b.structural).toBe(false);
    expect(b.all).toEqual(["NONE"]);
  });
});

describe("blockerFor — every clause stays inside its budget", () => {
  it("no clause exceeds eight words, on any school, for four different files", () => {
    const files = [
      profile({ ...TAG_READY, major: "cs", gpa: 3.9 }),
      profile({ ...TAG_READY, major: "cs", gpa: 2.5 }),
      profile({ institution: "private4", standing: "sophomore", gpa: 3.1 }),
      profile({ gpa: 3.99, essayText: "A real draft.", essayNamed: ["UCLA"] }),
    ];
    for (const p of files) {
      const gaps = analyzeCourses(p);
      for (const s of MODEL.schools) {
        const b = blockerFor(p, estimate(p, s), gaps);
        // "·" is a separator, not a word.
        const words = b.clause.split(/\s+/).filter((w) => w !== "·" && w !== "→");
        expect(words.length, `${s.name}: ${b.clause}`).toBeLessThanOrEqual(8);
      }
    }
  });
});
