// Stage B (docs/spec.md §5): the prompt is built by the side that runs the
// model, from structured inputs, with the applicant's writing in one fenced
// block and the odds taken from the engine — never set by the model.

import { describe, expect, it } from "vitest";
import { buildSectionPrompt, oddsLine, SECTION_MAX_TOKENS, untrustedText } from "../src/lib/audit/prompts";
import { parseAuditRequest, type AuditRequest } from "../src/lib/audit/schema";

const profile = {
  gpa: 3.4, gpaTrend: "upward", schoolName: "De Anza College", institution: "cc", caResident: true,
  standing: "junior", major: "cs", majorDetail: "", ptk: false, honors: false, igetc: true, firstGen: false,
  workHours: 12, hook: "none", courses: ["CIS 22A", "MATH 1A"], awardsText: "", transferReason: "",
};

const input = {
  profile,
  targets: ["Cornell", "UCLA"],
  whyTransfer: "I want Cornell's CS systems track. ZEBRA-ESSAY-LINE",
  statement: "",
  activities: "Robotics club lead, 6 hrs/wk",
};

function req(body: unknown): AuditRequest {
  const r = parseAuditRequest(body);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const specialist = req({ schemaVersion: 1, kind: "specialist", specialist: "essay", input });
const report = { id: "essay", grade: "B", headline: "Generic.", notes: [], actions: ["Name a lab"], missing: [] };
const lead = req({ schemaVersion: 1, kind: "lead", input, reports: [report] });

const fence = (t: string) => `<<FENCE>>${t}<</FENCE>>`;

describe("buildSectionPrompt", () => {
  it("fences exactly one block, with the applicant's writing inside it and the brief outside", () => {
    const text = buildSectionPrompt(specialist, fence);
    expect(text.split("<<FENCE>>").length - 1).toBe(1);
    const open = text.indexOf("<<FENCE>>");
    const close = text.indexOf("<</FENCE>>");
    expect(text.slice(open, close)).toContain("ZEBRA-ESSAY-LINE");
    expect(text.slice(open, close)).toContain("CIS 22A"); // transcript text is applicant-controlled too
    expect(text.indexOf("YOUR SPECIALTY")).toBeGreaterThan(close);
    expect(text.indexOf("This applicant")).toBeLessThan(open);
  });

  it("tells the model the engine's odds and never asks it for a chance or percentage", () => {
    const text = buildSectionPrompt(specialist);
    expect(text).toContain("Their computed odds right now");
    expect(text).toMatch(/Best positions right now/);
    expect(text).not.toMatch(/"chance"|perSchool|"lo":|"hi":|chanceRationale/);
  });

  it("the lead prompt fences the specialist reports, which are model text derived from applicant text", () => {
    const text = buildSectionPrompt(lead, fence);
    expect(text.split("<<FENCE>>").length - 1).toBe(1);
    const open = text.indexOf("<<FENCE>>");
    const close = text.indexOf("<</FENCE>>");
    expect(text.slice(open, close)).toContain("Name a lab");
    expect(text).toContain('"priorities"');
  });

  it("names only targets the dataset knows; an unknown name is not echoed into the brief", () => {
    const r = req({ schemaVersion: 1, kind: "specialist", specialist: "fit", input: { ...input, targets: ["Hogwarts"] } });
    const text = buildSectionPrompt(r);
    expect(text).not.toContain("Hogwarts");
    expect(text).toContain("none of the named targets");
  });

  it("budgets output per section", () => {
    expect(SECTION_MAX_TOKENS.specialist).toBeGreaterThan(SECTION_MAX_TOKENS.lead);
  });
});

describe("untrustedText", () => {
  it("covers the short inline fields the fence does not wrap", () => {
    const t = untrustedText(specialist);
    expect(t).toContain("De Anza College");
    expect(t).toContain("ZEBRA-ESSAY-LINE");
  });

  it("includes every note field of the reports a lead request carries", () => {
    const withNotes = req({
      schemaVersion: 1, kind: "lead", input,
      reports: [{ ...report, notes: [{ quote: "Q-SENTINEL", issue: "I-SENTINEL", fix: "F-SENTINEL" }] }],
    });
    const t = untrustedText(withNotes);
    for (const s of ["Q-SENTINEL", "I-SENTINEL", "F-SENTINEL"]) expect(t).toContain(s);
  });
});

describe("oddsLine", () => {
  it("never throws on a profile the engine does not know", () => {
    expect(oddsLine({ ...profile, institution: "??", standing: "??", major: "??", hook: "??" })).toMatch(/Best positions right now/);
  });
});
