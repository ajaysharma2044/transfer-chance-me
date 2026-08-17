// Tests for src/lib/extract.ts — the transcript reader behind the landing
// demo's upload burst.
//
// The demo promises the PDF fills six fields: GPA, SAT/ACT, "Now at",
// standing, major and awards. Four of those (schoolName, act, credits and
// awardsText) were promises the extractor did not keep. These tests pin them
// down, and — more importantly — pin down what the extractor must REFUSE to
// read, because the product rule is that a fabricated figure is worse than a
// blank one:
//
//   · a course row whose prefix is "ACT" is not a test score
//   · a governing district is not the school the student attends
//   · a division ("… College of Engineering") is not the institution
//   · a financial-aid award line is not an honour
//   · the units on a single course row are not a transferable-credit total
//   · a GPA sitting next to a credits line must not be read as either one
//
// The fixtures are shaped like real transcript text after src/lib/pdf.ts has
// flattened a PDF: an ALL-CAPS letterhead, then rows of "CODE TITLE UNITS
// GRADE", then a totals block.

import { describe, expect, it } from "vitest";
import { extractProfile } from "../src/lib/extract";

/** A De Anza transcript carrying every field the landing demo claims. */
const DE_ANZA = `
DE ANZA COLLEGE
21250 Stevens Creek Blvd, Cupertino, CA 95014
OFFICIAL ACADEMIC TRANSCRIPT
Student: Jane Q. Student
Declared major: Economics

ECON 1A PRINCIPLES OF MACROECONOMICS 5.00 A
ECON 1B PRINCIPLES OF MICROECONOMICS 5.00 A-
MATH 1A CALCULUS 5.00 A
ENGL 1A COMPOSITION AND READING 5.00 B+

Cumulative GPA: 3.71
Total Units Completed: 48.0
Test scores on file: SAT 1310 ACT 29
Dean's List: Fall 2023, Spring 2024
Phi Theta Kappa - inducted Spring 2024
`;

describe("schoolName", () => {
  it("reads a curated California CC off the letterhead and expands the name", () => {
    const { fields, found } = extractProfile(DE_ANZA);
    expect(fields.schoolName).toBe("De Anza College");
    expect(fields.institution).toBe("cc");
    expect(fields.caResident).toBe(true);
    expect(found).toContain("School: De Anza College");
  });

  it("keeps a school's own casing rather than re-casing it", () => {
    const { fields } = extractProfile("Diablo Valley College — Unofficial Transcript. GPA 3.40");
    expect(fields.schoolName).toBe("Diablo Valley College");
  });

  it("reads a college outside the curated list from the top of the document", () => {
    const t = "VALENCIA COLLEGE\nUnofficial Academic Transcript\nCumulative GPA: 3.55\n";
    expect(extractProfile(t).fields.schoolName).toBe("Valencia College");
  });

  it("reads a university letterhead, including the 'University of X' form", () => {
    expect(
      extractProfile("SAN JOSE STATE UNIVERSITY\nOFFICIAL TRANSCRIPT\nGPA 3.10").fields.schoolName,
    ).toBe("San Jose State University");
    expect(
      extractProfile("University of California, Davis\nOfficial Transcript\nGPA 3.10").fields.schoolName,
    ).toBe("University of California, Davis");
    // The name run would otherwise keep going into the letterhead below it.
    expect(
      extractProfile("UNIVERSITY OF OREGON\nOfficial Academic Record\nGPA 3.05").fields.schoolName,
    ).toBe("University of Oregon");
  });

  it("does not invent a school when the header is only paperwork", () => {
    const t = "OFFICIAL ACADEMIC TRANSCRIPT\nRegistrar's Office\nStudent: John Doe\nCumulative GPA: 3.20";
    expect(extractProfile(t).fields.schoolName).toBeUndefined();
  });

  it("refuses a governing district and refuses a division inside a school", () => {
    const district = "LOS ANGELES COMMUNITY COLLEGE DISTRICT\nOFFICIAL TRANSCRIPT\nGPA 3.30";
    expect(extractProfile(district).fields.schoolName).toBeUndefined();

    const division = "MONTGOMERY COLLEGE OF ENGINEERING AND APPLIED SCIENCE\nGrade Report\nGPA 3.30";
    expect(extractProfile(division).fields.schoolName).toBeUndefined();
  });

  it("ignores a school named only deep inside the body text", () => {
    const t = `${"Course history follows. ".repeat(40)}Transfer credit from Ohlone College accepted.`;
    // The curated list still recognises Ohlone anywhere; a NON-curated school
    // mentioned mid-document must not become the student's current school.
    const body = `${"Course history follows. ".repeat(40)}Transfer credit from Valencia College accepted.`;
    expect(extractProfile(t).fields.schoolName).toBe("Ohlone College");
    expect(extractProfile(body).fields.schoolName).toBeUndefined();
  });
});

describe("awardsText", () => {
  it("counts a repeated Dean's List and records the PTK induction", () => {
    const { fields } = extractProfile(DE_ANZA);
    expect(fields.awardsText).toBe("Dean's List x2, Phi Theta Kappa inducted");
    expect(fields.ptk).toBe(true);
  });

  it("honours an explicit multiplier instead of counting mentions", () => {
    const { fields } = extractProfile("Honors: Dean's List x3 while enrolled full time.");
    expect(fields.awardsText).toBe("Dean's List x3");
  });

  it("says Dean's List once when the document mentions it once", () => {
    const { fields } = extractProfile("Awarded Dean's List for the spring term.");
    expect(fields.awardsText).toBe("Dean's List");
  });

  it("picks up honor societies, named scholarships and honor roll", () => {
    const t = "Awards: Osher Scholarship (2024); Alpha Gamma Sigma; Honor Roll; graduated with honors.";
    const awards = extractProfile(t).fields.awardsText ?? "";
    expect(awards).toContain("Alpha Gamma Sigma");
    expect(awards).toContain("Osher Scholarship");
    expect(awards).toContain("Honor Roll");
    expect(awards).toContain("Graduated with honors");
  });

  it("keeps the award, not the sentence that introduces it", () => {
    const t = "Recipient of the Chancellor's Medal, 2024. Also awarded the Osher Foundation Scholarship.";
    expect(extractProfile(t).fields.awardsText).toBe("Chancellor's Medal, Osher Foundation Scholarship");
  });

  it("does not read financial aid, or a dean who is a person, as an award", () => {
    const t = "Financial Aid Award Year 2024-2025. Pell Grant disbursement posted. See the Dean of Students Office.";
    expect(extractProfile(t).fields.awardsText).toBeUndefined();
  });

  it("leaves awardsText unset when the transcript has no honours at all", () => {
    const t = "FOOTHILL COLLEGE\nOFFICIAL TRANSCRIPT\nMATH 1A CALCULUS 5.00 C\nCumulative GPA: 2.40";
    expect(extractProfile(t).fields.awardsText).toBeUndefined();
  });
});

describe("act", () => {
  it("reads a labelled composite and a bare score reported beside the SAT", () => {
    expect(extractProfile("ACT Composite: 31").fields.act).toBe(31);
    expect(extractProfile("Test scores — SAT: 1450, ACT: 33").fields.act).toBe(33);
    expect(extractProfile(DE_ANZA).fields.act).toBe(29);
    expect(extractProfile(DE_ANZA).fields.sat).toBe(1310);
  });

  it("accepts the top of the scale and rejects anything above it", () => {
    expect(extractProfile("ACT composite 36").fields.act).toBe(36);
    expect(extractProfile("ACT 41").fields.act).toBeUndefined();
    expect(extractProfile("ACT score of 137").fields.act).toBeUndefined();
  });

  it("does not read an accounting course row as a test score", () => {
    const t = `
SOUTHWEST COLLEGE
ACT 121  PRINCIPLES OF ACCOUNTING I     3.00  A
ACT 31   INTRODUCTION TO ACCOUNTING     3.00  B+
Cumulative GPA: 3.55
`;
    const { fields, found } = extractProfile(t);
    expect(fields.act).toBeUndefined();
    expect(found.some((f) => f.startsWith("ACT "))).toBe(false);
  });

  it("reports the ACT in the human-readable summary when it is real", () => {
    expect(extractProfile("ACT Composite: 28").found).toContain("ACT 28");
  });
});

describe("credits", () => {
  it("keeps the number as well as the standing it implies", () => {
    const { fields, found } = extractProfile(DE_ANZA);
    expect(fields.credits).toBe(48);
    expect(fields.standing).toBe("junior");
    expect(found).toContain("48 credits → junior standing");
  });

  it("reads a total that sits next to a GPA line without confusing the two", () => {
    const { fields } = extractProfile("Cumulative GPA 3.85 | Units Earned 30.0 | Units Attempted 33.0");
    expect(fields.gpa).toBe(3.85);
    expect(fields.credits).toBe(30);
    expect(fields.standing).toBe("sophomore");
  });

  it("is not fooled by the units on a single course row", () => {
    const t = "MATH 1A CALCULUS 5.00 UNITS A\nENGL 1A COMPOSITION 4.00 UNITS B\nTerm GPA: 3.50";
    expect(extractProfile(t).fields.credits).toBeUndefined();
    expect(extractProfile(t).fields.standing).toBeUndefined();
  });

  it("prefers the labelled total over a course row that appears first", () => {
    const t = `
MATH 1A CALCULUS 5.00 A
PHYS 4A MECHANICS 5.00 A
Total Semester Units Earned: 62.0
`;
    expect(extractProfile(t).fields.credits).toBe(62);
  });

  it("reads units earned, not units attempted, even when attempted comes first", () => {
    const t = "Total Units Attempted: 66.0\nTotal Units Earned: 58.0\nCumulative GPA: 3.20";
    expect(extractProfile(t).fields.credits).toBe(58);
  });

  it("reads a self-reported unit count from plain prose", () => {
    expect(extractProfile("I will have 54 semester units by the end of spring.").fields.credits).toBe(54);
  });
});

describe("regressions the four additions must not cause", () => {
  it("still reads GPA, major and course codes off the same transcript", () => {
    const { fields, courses } = extractProfile(DE_ANZA);
    expect(fields.gpa).toBe(3.71);
    expect(fields.major).toBe("econ");
    expect(courses).toContain("MATH 1A");
    expect(courses.some((c) => c.startsWith("ACT"))).toBe(false);
  });

  it("returns empty, not junk, for text with nothing in it", () => {
    const { fields, found, courses } = extractProfile("thanks for your interest, see attached");
    expect(fields).toEqual({});
    expect(found).toEqual([]);
    expect(courses).toEqual([]);
  });
});

// ── Column-aligned transcripts ────────────────────────────────────────────
// A real transcript PDF lays subject and number out in columns, so several
// spaces sit between them. The original pattern allowed at most one and
// returned nothing for those files — the common case, silently.
describe("course codes on column-aligned transcripts", () => {
  it("reads codes separated by runs of spaces", () => {
    const r = extractProfile(
      "MATH    1B      CALCULUS II          4.00  A\n" +
      "CIS     22C     DATA STRUCTURES      4.50  A-\n" +
      "PHYS   4A       MECHANICS            5.00  B+\n",
    );
    expect(r.courses).toEqual(expect.arrayContaining(["MATH 1B", "CIS 22C", "PHYS 4A"]));
  });

  it("normalises the separator so one course is not two entries", () => {
    const r = extractProfile("MATH   1B  CALCULUS\nMATH 1B  CALCULUS\n");
    expect(r.courses.filter((c) => c === "MATH 1B")).toHaveLength(1);
  });

  it("does NOT join the end of one line to the start of the next", () => {
    // "BIOL" ends a row; "3.00" opens the next. Collapsing whitespace across
    // the newline would invent the course "BIOL 3".
    const r = extractProfile("INTRO TO BIOL\n3.00 units earned\n");
    expect(r.courses).not.toContain("BIOL 3");
  });

  it("still reads a single-space code", () => {
    const r = extractProfile("ENGL 101 COMPOSITION 3.00 A\n");
    expect(r.courses).toContain("ENGL 101");
  });
});

describe("course codes: summary rows are not courses", () => {
  it("ignores transcript summary lines that look like wide-gap course codes", () => {
    const r = extractProfile(
      "MATH    1B      CALCULUS II      4.00  A\n" +
      "TOTAL          16.00\n" +
      "TERM GPA        3.61\n" +
      "UNITS          16\n",
    );
    expect(r.courses).toContain("MATH 1B");
    for (const bad of ["TOTAL 16", "TERM 3", "UNITS 16"]) {
      expect(r.courses).not.toContain(bad);
    }
  });
});
