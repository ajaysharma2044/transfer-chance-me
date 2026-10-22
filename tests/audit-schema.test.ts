// Stage B (docs/spec.md §5): one typed audit execution contract shared by the
// browser, the worker and the tests.
//
// Two breaks it replaces, both confirmed on the branch:
//   · the worker validated every model reply with the LEGACY full-review shape
//     (grade/summary/strengths/risks/actions/perSchool+chance), which neither a
//     specialist report nor the lead synthesis satisfies — so every panel job
//     erred on Netlify;
//   · the browser POSTed a self-authored prompt. The server now accepts only
//     structured, size-capped applicant inputs and builds the prompt itself.

import { describe, expect, it } from "vitest";
import { MAX_INCLUDED_TARGETS } from "../config/product";
import { LIMITS, parseAuditRequest, parseModelJson, validateSection } from "../src/lib/audit/schema";

const specialist = {
  grade: "B+",
  headline: "Solid prep, thin evidence of impact.",
  notes: [{ quote: "I led the robotics club", issue: "No number attached", fix: "State members, hours, and one outcome" }],
  actions: ["Add a headcount and a measurable result to the club line"],
  missing: [],
};

const lead = {
  grade: "B",
  summary: "A credible file whose ceiling is the essay.",
  strengths: ["Complete major prep"],
  risks: ["Generic why-transfer essay"],
  priorities: ["Rewrite the essay around named Cornell programs"],
};

const input = {
  profile: {
    gpa: 3.4, gpaTrend: "upward", schoolName: "De Anza College", institution: "cc", caResident: true,
    standing: "junior", major: "cs", majorDetail: "", ptk: false, honors: false, igetc: true, firstGen: false,
    workHours: null, hook: "none", courses: ["CIS 22A"], awardsText: "", transferReason: "",
  },
  targets: ["Cornell", "UCLA"],
  whyTransfer: "I want Cornell's CS systems track.",
  statement: "",
  activities: "Robotics club lead, 6 hrs/wk",
};

describe("validateSection — per-kind shapes, never the legacy full review", () => {
  it("accepts a well-formed specialist report", () => {
    expect(validateSection("specialist", specialist)).toEqual({ ok: true });
  });

  it("accepts the lead synthesis WITHOUT perSchool/chance — the shape the legacy validator rejected", () => {
    expect(validateSection("lead", lead)).toEqual({ ok: true });
    // The retired validator required perSchool[].chance — a model-set odds
    // band. Nothing in this contract asks the model for a number.
    expect(JSON.stringify(lead)).not.toMatch(/chance|perSchool/);
  });

  it("rejects a specialist report missing its arrays", () => {
    const r = validateSection("specialist", { grade: "A", headline: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/notes|actions|missing/);
  });

  it("rejects notes whose items lack quote / issue / fix", () => {
    const r = validateSection("specialist", { ...specialist, notes: [{ quote: "only a quote" }] });
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(validateSection("summary" as never, lead).ok).toBe(false);
  });

  it("caps sizes: too many notes or an oversized field is rejected", () => {
    const many = Array.from({ length: LIMITS.notes + 1 }, () => specialist.notes[0]);
    expect(validateSection("specialist", { ...specialist, notes: many }).ok).toBe(false);
    const huge = { ...specialist, headline: "x".repeat(LIMITS.text + 1) };
    expect(validateSection("specialist", huge).ok).toBe(false);
  });
});

describe("parseModelJson — fence stripping and salvage, never a cast", () => {
  it("parses a fenced reply", () => {
    const r = parseModelJson("```json\n" + JSON.stringify(lead) + "\n```");
    expect(r.ok).toBe(true);
  });

  it("salvages the outermost object from surrounding chatter", () => {
    const r = parseModelJson("Sure! Here you go: " + JSON.stringify(lead) + " Hope this helps.");
    expect(r.ok).toBe(true);
  });

  it("fails cleanly on prose", () => {
    expect(parseModelJson("I cannot produce JSON today.").ok).toBe(false);
  });
});

describe("parseAuditRequest — structured inputs in, never a browser-authored prompt", () => {
  it("rejects the legacy { prompt } body", () => {
    const r = parseAuditRequest({ prompt: "You are a reviewer…" });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(400); expect(r.error).toMatch(/prompt|structured/i); }
  });

  it("rejects an unsupported schema version", () => {
    const r = parseAuditRequest({ schemaVersion: 99, kind: "specialist", specialist: "essay", input });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/schemaVersion/);
  });

  it("accepts a specialist request", () => {
    const r = parseAuditRequest({ schemaVersion: 1, kind: "specialist", specialist: "essay", input });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "specialist") expect(r.value.specialist).toBe("essay");
  });

  it("refuses more targets than the purchase scope instead of silently dropping some", () => {
    const tooMany = { ...input, targets: Array.from({ length: MAX_INCLUDED_TARGETS + 1 }, (_, i) => `School ${i}`) };
    const r = parseAuditRequest({ schemaVersion: 1, kind: "specialist", specialist: "fit", input: tooMany });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/targets/);
  });

  it("rejects an unknown specialist id", () => {
    expect(parseAuditRequest({ schemaVersion: 1, kind: "specialist", specialist: "astrology", input }).ok).toBe(false);
  });

  it("a lead request must carry the specialist reports it synthesises", () => {
    expect(parseAuditRequest({ schemaVersion: 1, kind: "lead", input }).ok).toBe(false);
    const r = parseAuditRequest({ schemaVersion: 1, kind: "lead", input, reports: [{ id: "essay", ...specialist }] });
    expect(r.ok).toBe(true);
  });

  it("carries the remaining engine inputs and validates the SAT range", () => {
    const ok = parseAuditRequest({ schemaVersion: 1, kind: "specialist", specialist: "fit", input: { ...input, profile: { ...input.profile, sat: 1500, ecLevel: "national", essay: "named" } } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.input.profile).toMatchObject({ sat: 1500, ecLevel: "national", essay: "named" });
    const missing = parseAuditRequest({ schemaVersion: 1, kind: "specialist", specialist: "fit", input });
    expect(missing.ok && missing.value.input.profile.sat).toBeNull();
    expect(parseAuditRequest({ schemaVersion: 1, kind: "specialist", specialist: "fit", input: { ...input, profile: { ...input.profile, sat: 99 } } }).ok).toBe(false);
  });

  it("caps applicant text lengths", () => {
    const long = { ...input, whyTransfer: "x".repeat(LIMITS.longText + 1) };
    expect(parseAuditRequest({ schemaVersion: 1, kind: "specialist", specialist: "essay", input: long }).ok).toBe(false);
  });
});
