// The audit execution contract (docs/spec.md §5), shared by the browser
// (src/lib/panel.ts), the Netlify functions (netlify/functions/review*.ts) and
// the tests. Everything that crosses the wire is typed here, and nothing is
// trusted on arrival: a request is parsed field by field under size caps, and a
// model reply is validated for the section it was asked for. A specialist
// report and the lead synthesis are different shapes — the worker used to
// check both against the legacy single-shot review shape, which neither
// satisfies, so every panel job failed validation on Netlify.
//
// Keep this module free of React, Supabase and import.meta: it runs in Node.

import { MAX_INCLUDED_TARGETS } from "../../../config/product";

export const SCHEMA_VERSION = 1 as const;

/** Size caps. Model output caps stop a runaway reply from blanking the report;
 *  applicant-input caps bound what one request can make the server store and
 *  send to a model. */
export const LIMITS = {
  /** Any single short string the model returns: a headline, a note field, one action. */
  text: 1_000,
  /** The lead's multi-sentence summary. */
  paragraph: 3_000,
  /** A grade, a trend, an enum-ish profile field. */
  short: 80,
  /** Items in a notes list. */
  notes: 12,
  /** Items in any other list the model returns. */
  items: 12,
  /** Each piece of applicant free text: why-transfer, statement, activities. */
  longText: 20_000,
  /** Profile free text: school name, major detail, awards, transfer reason. */
  field: 2_000,
  /** One course name. */
  course: 160,
  courses: 150,
  /** Targets in one request — the purchase scope, never silently truncated. */
  targets: MAX_INCLUDED_TARGETS,
  reports: 4,
} as const;

export const SPECIALIST_IDS = ["coursework", "activities", "essay", "fit"] as const;
export type SpecialistId = (typeof SPECIALIST_IDS)[number];
export type SectionKind = "specialist" | "lead";

export function isSpecialistId(v: unknown): v is SpecialistId {
  return typeof v === "string" && (SPECIALIST_IDS as readonly string[]).includes(v);
}

/* ── What the model returns ─────────────────────────────────────────────── */

export interface Note { quote: string; issue: string; fix: string }

export interface SpecialistSection {
  grade: string;
  headline: string;
  notes: Note[];
  actions: string[];
  /** Anything the reviewer could not judge because it wasn't provided. */
  missing: string[];
}

export interface LeadSection {
  grade: string;
  summary: string;
  strengths: string[];
  risks: string[];
  priorities: string[];
}

export type Section = SpecialistSection | LeadSection;

/** A specialist's finished report, as the lead request carries it. */
export interface SpecialistReportWire extends SpecialistSection { id: SpecialistId }

/* ── What the browser sends ─────────────────────────────────────────────── */

/** The profile fields a review reads. A strict subset of engine.ts's Profile:
 *  no confirmation flags, no UI state, nothing the prompt does not print. */
export interface AuditProfile {
  gpa: number;
  gpaTrend: string;
  schoolName: string | null;
  institution: string;
  caResident: boolean;
  standing: string;
  major: string;
  majorDetail: string;
  ptk: boolean;
  honors: boolean;
  igetc: boolean;
  firstGen: boolean;
  workHours: number | null;
  hook: string;
  courses: string[];
  awardsText: string;
  transferReason: string;
  /** The remaining engine inputs, so the odds the server computes for the
   *  brief are the odds the app showed (docs/spec.md §5: one engine, one answer). */
  sat: number | null;
  ecLevel: string;
  essay: string;
}

export interface AuditInput {
  profile: AuditProfile;
  /** The schools on the applicant's list that are included in this review —
   *  exactly what the UI displayed, in order. */
  targets: string[];
  whyTransfer: string;
  statement: string;
  activities: string;
}

interface RequestBase {
  schemaVersion: typeof SCHEMA_VERSION;
  /** One id for the whole panel run (four specialists + lead), minted by the
   *  browser: how the ledger groups five calls into one audit, and how a log
   *  line ties them together without naming the user. */
  auditId?: string;
  input: AuditInput;
}

export type AuditRequest =
  | (RequestBase & { kind: "specialist"; specialist: SpecialistId })
  | (RequestBase & { kind: "lead"; reports: SpecialistReportWire[] });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SectionValidation = { ok: true } | { ok: false; errors: string[] };
export type Parsed<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/* ── Validation of model output ─────────────────────────────────────────── */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function checkText(v: unknown, path: string, max: number, errors: string[]): void {
  if (typeof v !== "string") { errors.push(`${path}: expected a string`); return; }
  if (v.trim().length === 0) errors.push(`${path}: expected a non-empty string`);
  if (v.length > max) errors.push(`${path}: longer than ${max} characters`);
}

function checkList(v: unknown, path: string, errors: string[], maxItems: number, maxLen: number): void {
  if (!Array.isArray(v)) { errors.push(`${path}: expected an array of strings`); return; }
  if (v.length > maxItems) errors.push(`${path}: more than ${maxItems} items`);
  v.forEach((x, i) => {
    if (typeof x !== "string") errors.push(`${path}[${i}]: expected a string`);
    else if (x.length > maxLen) errors.push(`${path}[${i}]: longer than ${maxLen} characters`);
  });
}

function checkNotes(v: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(v)) { errors.push(`${path}: expected an array of {quote, issue, fix} objects`); return; }
  if (v.length > LIMITS.notes) errors.push(`${path}: more than ${LIMITS.notes} items`);
  v.forEach((n, i) => {
    if (!isObj(n)) { errors.push(`${path}[${i}]: expected an object with quote, issue and fix`); return; }
    for (const f of ["quote", "issue", "fix"] as const) checkText(n[f], `${path}[${i}].${f}`, LIMITS.text, errors);
  });
}

/** Does `json` have the shape of the section `kind` the model was asked for?
 *  Refuses shape, not taste: an empty list is the model's business. */
export function validateSection(kind: SectionKind, json: unknown): SectionValidation {
  if (!isObj(json)) return { ok: false, errors: ["response: expected a JSON object"] };
  const errors: string[] = [];
  if (kind === "specialist") {
    checkText(json.grade, "grade", LIMITS.short, errors);
    checkText(json.headline, "headline", LIMITS.text, errors);
    checkNotes(json.notes, "notes", errors);
    checkList(json.actions, "actions", errors, LIMITS.items, LIMITS.text);
    checkList(json.missing, "missing", errors, LIMITS.items, LIMITS.text);
  } else if (kind === "lead") {
    checkText(json.grade, "grade", LIMITS.short, errors);
    checkText(json.summary, "summary", LIMITS.paragraph, errors);
    checkList(json.strengths, "strengths", errors, LIMITS.items, LIMITS.text);
    checkList(json.risks, "risks", errors, LIMITS.items, LIMITS.text);
    checkList(json.priorities, "priorities", errors, LIMITS.items, LIMITS.text);
  } else {
    return { ok: false, errors: [`kind: unknown section kind`] };
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Copies of exactly the fields a section carries — so nothing a model adds
 *  rides along into storage or the UI. Call after validateSection passed. */
export function pickSection(kind: "specialist", json: Record<string, unknown>): SpecialistSection;
export function pickSection(kind: "lead", json: Record<string, unknown>): LeadSection;
export function pickSection(kind: SectionKind, json: Record<string, unknown>): Section;
export function pickSection(kind: SectionKind, json: Record<string, unknown>): Section {
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  if (kind === "specialist") {
    const notes = Array.isArray(json.notes) ? json.notes : [];
    return {
      grade: String(json.grade),
      headline: String(json.headline),
      notes: notes.filter(isObj).map((n) => ({ quote: String(n.quote), issue: String(n.issue), fix: String(n.fix) })),
      actions: strings(json.actions),
      missing: strings(json.missing),
    };
  }
  return {
    grade: String(json.grade),
    summary: String(json.summary),
    strengths: strings(json.strengths),
    risks: strings(json.risks),
    priorities: strings(json.priorities),
  };
}

/** The model's text as JSON: fences stripped, and the outermost object salvaged
 *  when a model prefixes or suffixes chatter. Never a cast — the caller still
 *  runs validateSection on the value. */
export function parseModelJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const attempt = (s: string): { ok: true; value: unknown } | null => {
    try { return { ok: true, value: JSON.parse(s) as unknown }; } catch { return null; }
  };
  const direct = attempt(cleaned);
  if (direct) return direct;
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a >= 0 && b > a) {
    const salvaged = attempt(cleaned.slice(a, b + 1));
    if (salvaged) return salvaged;
  }
  return { ok: false, error: "response: not parseable as JSON" };
}

/* ── Parsing of requests ────────────────────────────────────────────────── */

const fail = (error: string, status = 400): { ok: false; status: number; error: string } => ({ ok: false, status, error });

function optText(v: unknown, path: string, max: number): Parsed<string> {
  if (v === undefined || v === null) return { ok: true, value: "" };
  if (typeof v !== "string") return fail(`${path} must be a string.`);
  if (v.length > max) return fail(`${path} is longer than ${max} characters.`, 413);
  return { ok: true, value: v };
}

function parseProfile(v: unknown): Parsed<AuditProfile> {
  if (!isObj(v)) return fail("input.profile must be an object.");
  const gpa = v.gpa;
  if (typeof gpa !== "number" || !Number.isFinite(gpa) || gpa <= 0 || gpa > 5) {
    return fail("input.profile.gpa must be a number between 0 and 5.");
  }
  const short: Record<string, string> = {};
  for (const k of ["gpaTrend", "institution", "standing", "major", "hook", "ecLevel", "essay"] as const) {
    const r = optText(v[k], `input.profile.${k}`, LIMITS.short);
    if (!r.ok) return r;
    short[k] = r.value;
  }
  const sat = v.sat;
  if (sat !== undefined && sat !== null && (typeof sat !== "number" || !Number.isFinite(sat) || sat < 400 || sat > 1600)) {
    return fail("input.profile.sat must be null or a score between 400 and 1600.");
  }
  for (const k of ["institution", "standing", "major"] as const) {
    if (short[k].trim().length === 0) return fail(`input.profile.${k} is required.`);
  }
  const long: Record<string, string> = {};
  for (const k of ["majorDetail", "awardsText", "transferReason"] as const) {
    const r = optText(v[k], `input.profile.${k}`, LIMITS.field);
    if (!r.ok) return r;
    long[k] = r.value;
  }
  const schoolName = optText(v.schoolName, "input.profile.schoolName", LIMITS.field);
  if (!schoolName.ok) return schoolName;
  const wh = v.workHours;
  if (wh !== undefined && wh !== null && (typeof wh !== "number" || !Number.isFinite(wh) || wh < 0 || wh > 168)) {
    return fail("input.profile.workHours must be null or a number of hours per week.");
  }
  const courses = v.courses === undefined ? [] : v.courses;
  if (!Array.isArray(courses) || courses.length > LIMITS.courses || !courses.every((c) => typeof c === "string" && c.length <= LIMITS.course)) {
    return fail(`input.profile.courses must be up to ${LIMITS.courses} course names.`);
  }
  return {
    ok: true,
    value: {
      gpa,
      gpaTrend: short.gpaTrend,
      schoolName: schoolName.value.trim().length ? schoolName.value : null,
      institution: short.institution,
      caResident: v.caResident === true,
      standing: short.standing,
      major: short.major,
      majorDetail: long.majorDetail,
      ptk: v.ptk === true,
      honors: v.honors === true,
      igetc: v.igetc === true,
      firstGen: v.firstGen === true,
      workHours: typeof wh === "number" ? wh : null,
      hook: short.hook,
      courses: courses as string[],
      awardsText: long.awardsText,
      transferReason: long.transferReason,
      sat: typeof sat === "number" ? sat : null,
      ecLevel: short.ecLevel,
      essay: short.essay,
    },
  };
}

function parseInput(v: unknown): Parsed<AuditInput> {
  if (!isObj(v)) return fail("input must be an object.");
  const profile = parseProfile(v.profile);
  if (!profile.ok) return profile;
  const targets = v.targets;
  if (
    !Array.isArray(targets) ||
    targets.length < 1 ||
    targets.length > LIMITS.targets ||
    !targets.every((t) => typeof t === "string" && t.trim().length > 0 && t.length <= LIMITS.field)
  ) {
    return fail(`input.targets must list between 1 and ${LIMITS.targets} school names.`);
  }
  const why = optText(v.whyTransfer, "input.whyTransfer", LIMITS.longText);
  if (!why.ok) return why;
  const statement = optText(v.statement, "input.statement", LIMITS.longText);
  if (!statement.ok) return statement;
  const activities = optText(v.activities, "input.activities", LIMITS.longText);
  if (!activities.ok) return activities;
  return {
    ok: true,
    value: {
      profile: profile.value,
      targets: [...new Set(targets as string[])],
      whyTransfer: why.value,
      statement: statement.value,
      activities: activities.value,
    },
  };
}

function parseReports(v: unknown): Parsed<SpecialistReportWire[]> {
  if (!Array.isArray(v) || v.length < 1 || v.length > LIMITS.reports) {
    return fail(`reports must carry between 1 and ${LIMITS.reports} specialist reports.`);
  }
  const out: SpecialistReportWire[] = [];
  for (const r of v) {
    if (!isObj(r) || !isSpecialistId(r.id)) return fail("reports[].id must name a specialist.");
    if (out.some((x) => x.id === r.id)) return fail(`reports: duplicate specialist ${r.id}.`);
    const check = validateSection("specialist", r);
    if (!check.ok) return fail(`reports[${r.id}]: ${check.errors[0]}`);
    out.push({ id: r.id, ...pickSection("specialist", r) });
  }
  return { ok: true, value: out };
}

/** The server's only way in. Accepts structured applicant inputs and nothing
 *  else — a browser-authored prompt is refused, so the server always knows
 *  which bytes are the brief and which are the applicant's writing. The
 *  returned value is a fresh object holding exactly the known fields. */
export function parseAuditRequest(body: unknown): Parsed<AuditRequest> {
  if (!isObj(body)) return fail("Body must be a JSON object.");
  if ("prompt" in body && !("schemaVersion" in body)) {
    return fail("This endpoint takes structured audit inputs (schemaVersion 1), not a prompt — reload the app.");
  }
  if (body.schemaVersion !== SCHEMA_VERSION) {
    return fail(`Unsupported schemaVersion — this server speaks version ${SCHEMA_VERSION}.`);
  }
  const kind = body.kind;
  if (kind !== "specialist" && kind !== "lead") return fail("kind must be 'specialist' or 'lead'.");
  if (body.auditId !== undefined && (typeof body.auditId !== "string" || !UUID_RE.test(body.auditId))) {
    return fail("auditId must be a UUID when present.");
  }
  const base: RequestBase = { schemaVersion: SCHEMA_VERSION, input: undefined as unknown as AuditInput };
  if (typeof body.auditId === "string") base.auditId = body.auditId.toLowerCase();
  const input = parseInput(body.input);
  if (!input.ok) return input;
  base.input = input.value;
  if (kind === "specialist") {
    if (!isSpecialistId(body.specialist)) return fail(`specialist must be one of ${SPECIALIST_IDS.join(", ")}.`);
    return { ok: true, value: { ...base, kind, specialist: body.specialist } };
  }
  const reports = parseReports(body.reports);
  if (!reports.ok) return reports;
  return { ok: true, value: { ...base, kind, reports: reports.value } };
}
