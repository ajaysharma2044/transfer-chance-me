// Prompts for the review panel, built by whoever runs the model (docs/spec.md
// §5) — the Netlify worker in proxy mode, the browser in bring-your-own-key
// mode — from the structured request in ./schema.ts. The browser never
// authors the brief any more, so the server always knows which bytes are its
// own instructions and which are the applicant's writing, and can fence the
// latter: `fence` wraps the one block of applicant-authored text in each
// prompt. The worker passes api/_guard.ts's wrapUntrusted; the browser passes
// noFence, as its direct calls always were.
//
// Odds come from the deterministic engine on the machine that builds the
// prompt. The model is told the numbers; it is never asked to set them.

import { DEFAULT_PROFILE, MODEL } from "../../engine";
import type { Profile } from "../../engine";
import { buildPlan } from "../actionplan";
import { intelLines } from "../intel";
import type {
  AuditInput, AuditProfile, AuditRequest, SectionKind, SpecialistId, SpecialistReportWire,
} from "./schema";

export type Fence = (text: string) => string;
export const noFence: Fence = (t) => t;

/** Output budget per section. Sized with headroom over the JSON each returns:
 *  the first live run hit a 4,000-token cap exactly and the truncated JSON
 *  failed validation, which cost a retry. The ledger reserves against this
 *  number, so the live model's real price belongs in config/budgets.ts. */
export const SECTION_MAX_TOKENS: Record<SectionKind, number> = { specialist: 8_000, lead: 6_000 };

export const FINDINGS = `
Grounding facts from 8,910 recorded transfer outcomes (4,243 admits, 2011-2026):
- Transfer admission is GPA-dominated. Elite private admits cluster 3.95-4.0; big UC admits ~3.82 median.
- Activities matter and PATTERN BEATS PRESTIGE. Across 1,217 structured profiles, 50% of admits' listed activities are campus-anchored (club leadership, tutoring/TA work, faculty research, PTK/honors, student government) and only 9% are national-scope. Trophy activities alone never rescue a GPA.
- The #1 differentiator admits credit is a school-specific "why transfer" essay naming programs, professors and courses. Complaint-shaped essays (framing the move as escape) fail; fit-and-resources framing wins.
- Feeder fit matters: the UCs run on California community colleges (92% of UCLA admits).
- High-school record barely predicts college GPA (r = 0.016); 16% of admits are redemption cases.
- Reporting bias is real: the corpus over-represents acceptances, and nowhere more than CS/engineering, where visible success stories vastly outnumber actual transfer seats. Never let a CS applicant believe that lane is as open as forums suggest.
`;

/** The wire profile back into the engine's Profile, for the odds line. Fields
 *  the wire does not carry take the defaults. */
export function toEngineProfile(w: AuditProfile): Profile {
  return { ...DEFAULT_PROFILE, ...w } as Profile;
}

/** "Best positions right now … nearest deadline …" from the deterministic
 *  engine. A profile the engine cannot place yields "not computed" rather
 *  than a thrown request. */
export function oddsLine(w: AuditProfile): string {
  try {
    const plan = buildPlan(toEngineProfile(w));
    const top = plan.focus.slice(0, 6).join(", ");
    return `Best positions right now: ${top || "not computed"}. Nearest deadline: ${
      plan.next ? `${plan.next.school} in ${plan.next.days} days (${plan.next.label})` : "none tracked"
    }.`;
  } catch {
    return "Best positions right now: not computed.";
  }
}

/** One line, no markup, capped — for the short applicant-typed fields that
 *  read better inline than inside the fence. detectInjection still sees them
 *  via untrustedText(). */
function inline(s: string | null, max = 120): string {
  return (s ?? "").replace(/[\r\n<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Structured facts: numbers, flags and enum-ish fields. Nothing here is free
 *  text the applicant typed at length. */
function factsBlock(p: AuditProfile): string {
  const creds = [p.ptk && "Phi Theta Kappa", p.honors && "honors program", p.igetc && "IGETC", p.firstGen && "first-generation"]
    .filter(Boolean).join(", ");
  return [
    `- College GPA ${p.gpa.toFixed(2)} (trend: ${inline(p.gpaTrend, 20) || "unknown"})`,
    `- Currently at: ${inline(p.schoolName) || inline(p.institution, 40)}${p.caResident ? " (California resident)" : ""}`,
    `- Entering as ${inline(p.standing, 40)}; intended major: ${inline(p.major, 40)}${p.majorDetail ? ` — specifically ${inline(p.majorDetail)}` : ""}`,
    `- Credentials: ${creds || "none listed"}`,
    p.workHours ? `- Works ${p.workHours} hrs/week while enrolled` : "",
    p.hook && p.hook !== "none" ? `- Path: ${inline(p.hook, 40)}` : "",
    p.courses.length ? `- Courses on record: ${p.courses.length} (listed in their materials)` : "- No coursework provided",
  ].filter(Boolean).join("\n");
}

function schoolBlock(targets: string[]): string {
  const known = targets.map((name) => MODEL.schools.find((x) => x.name === name)).filter((s) => s != null);
  if (known.length === 0) return "(none of the named targets is in the dataset)";
  return known.map((s) => {
    const c = s.counsel;
    return [
      `## ${s.name} — official transfer admit rate ${s.rate}%${s.gpa.p50 != null ? `, admitted GPA p25/median/p75 ${s.gpa.p25}/${s.gpa.p50}/${s.gpa.p75}` : ", admitted-GPA range not published"}`,
      c?.typical ? `Typical admit: ${c.typical}` : "",
      c?.levers?.length ? `Moves the file: ${c.levers.join("; ")}` : "",
      c?.watchouts?.length ? `Watchouts: ${c.watchouts.join("; ")}` : "",
      intelLines(s.name),
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

/** Everything the applicant wrote at length, as one block — the part a fence
 *  wraps. */
export function materialsText(input: AuditInput): string {
  const p = input.profile;
  return [
    p.courses.length ? `## Courses on record (${p.courses.length})\n${p.courses.slice(0, 60).join(", ")}` : "",
    p.awardsText ? `## Awards, in their words\n${p.awardsText}` : "",
    p.transferReason ? `## Why they say they're transferring\n${p.transferReason}` : "",
    `## Why-transfer essay\n${input.whyTransfer || "(not provided)"}`,
    input.statement ? `## Personal statement\n${input.statement}` : "",
    `## Activities, in their words\n${input.activities || "(not provided)"}`,
  ].filter(Boolean).join("\n\n");
}

/** The specialists' reports as the lead reads them. Model output derived from
 *  applicant text, so it is fenced like applicant text. */
export function reportsText(reports: SpecialistReportWire[]): string {
  return reports
    .map((r) => `## ${r.id} — grade ${r.grade}\n${r.headline}\nActions: ${r.actions.join("; ")}\nGaps: ${r.missing.join("; ") || "none"}`)
    .join("\n\n");
}

/** All applicant-controlled text in a request, for detectInjection. Includes
 *  the short inline fields, which the fence does not cover. */
export function untrustedText(req: AuditRequest): string {
  const p = req.input.profile;
  const parts = [
    materialsText(req.input),
    p.schoolName ?? "", p.majorDetail, p.gpaTrend, p.institution, p.standing, p.major, p.hook,
    ...req.input.targets,
  ];
  if (req.kind === "lead") {
    parts.push(reportsText(req.reports));
    for (const r of req.reports) parts.push(...r.notes.flatMap((n) => [n.quote, n.issue, n.fix]));
  }
  return parts.join("\n");
}

const NOTE_SHAPE = `"notes": [{"quote": "<a short verbatim quote from THEIR material, or the exact item from their record>", "issue": "<what is wrong or working — be specific and honest>", "fix": "<the concrete change to make>"}]`;

const TASKS: Record<SpecialistId, string> = {
  coursework: `# YOUR SPECIALTY: coursework and major preparation
Judge the transcript as an admissions reader would: is the major preparation actually complete for the intended major at these specific targets? Which prerequisite courses are missing, and which of those can still be taken before the deadline? Is the rigour adequate (is this a real transfer-level load, or padded)? Does the GPA trend help or hurt, and how should it be addressed? If no coursework was provided, say plainly that this is the single biggest hole in the review and list exactly what to provide.

Quote actual course names from their record in your notes.`,

  activities: `# YOUR SPECIALTY: activities, work, and awards
This is the lane the applicant most often gets wrong. Judge their activity record against the admit pattern: campus-anchored involvement with specific, quantified outcomes beats prestige. Look for (a) activities they have but have described weakly, (b) real activities missing from the list entirely (a paid job is 13% of admit activities and is routinely omitted), (c) padding or high-school filler that should be cut, (d) whether anything shows sustained commitment with a number attached.

For every note, rewrite their description into the form an admit would use — specific role, hours, span, and a number. In "actions", give moves that are achievable before their deadline, naming what to do this week.`,

  essay: `# YOUR SPECIALTY: the essays
Read the "why transfer" essay and personal statement as an admissions reader. The dataset is unambiguous: complaint-shaped essays fail, and naming specific programs, courses and professors is the single differentiator admits credit. Quote their actual sentences. Identify every sentence that frames the move as escape rather than fit, every generic claim that could appear in any applicant's essay, and every place a specific named program should replace a vague one. If a target is not named anywhere, say so explicitly.

If no essay was provided, say so and give the opening paragraph structure they should write, tailored to their profile and targets.`,

  fit: `# YOUR SPECIALTY: per-school fit and list strategy
Judge how THIS file lands at EACH named target, using that school's real admit rate, admitted-GPA range, feeder pattern and watchouts. Be blunt where a target is unrealistic and say what the file would need to change. Assess the shape of the list: is it top-heavy with reaches, missing a genuine safety, ignoring a guaranteed pathway (TAG/ADT/GAA/CAP) they qualify for? Name specific schools they should add or drop, and why. The odds above are computed from recorded outcomes; argue from them, do not restate them as your own numbers.

Use one note per school, with the school name as the "quote".`,
};

function specialistPrompt(id: SpecialistId, input: AuditInput, fence: Fence): string {
  return `You are one of four specialist reviewers on a transfer-admissions panel. You review ONLY your specialty; another reviewer covers each of the others, so do not duplicate their work. Be specific, honest, and useful — flattery costs admissions. Quote the applicant's own words or record items verbatim.

${FINDINGS}

# This applicant
${factsBlock(input.profile)}

# Their computed odds right now
${oddsLine(input.profile)}

# Their targets
${schoolBlock(input.targets)}

# Their materials
${fence(materialsText(input))}

${TASKS[id]}

Return ONLY a JSON object, no markdown fences:
{
  "grade": "<letter grade for this dimension only, e.g. B+>",
  "headline": "<one sentence: the honest read of this dimension>",
  ${NOTE_SHAPE} (4-7 notes),
  "actions": ["<the concrete things to do in this lane, highest priority first>"],
  "missing": ["<anything you could not judge because they didn't provide it>"]
}`;
}

function leadPrompt(input: AuditInput, reports: SpecialistReportWire[], fence: Fence): string {
  return `You are the lead reviewer on a transfer-admissions panel. Specialists have each reviewed one dimension of this application. Synthesise their reports into the verdict the applicant reads first.

${FINDINGS}

# Applicant
${factsBlock(input.profile)}

# Computed odds
${oddsLine(input.profile)}

# Specialist reports
${fence(reportsText(reports))}

Weigh the dimensions the way the data does: GPA and major preparation dominate, the school-specific essay is the top differentiator among qualified files, activities matter by pattern not prestige. Where specialists disagree, resolve it and say why. Be honest about ceilings — if the reaches are out of range, say so and redirect attention to what is winnable. The odds are computed; do not invent new percentages.

Return ONLY a JSON object, no markdown fences:
{
  "grade": "<overall letter grade>",
  "summary": "<4-5 sentences: the honest read of this application as a whole, and what would change it most>",
  "strengths": ["<specific>"],
  "risks": ["<specific>"],
  "priorities": ["<the 4-6 things to do before submitting, hardest-hitting first, each naming the concrete action>"]
}`;
}

/** The user-turn text for one section request. Exactly one `fence` call per
 *  prompt, so the guard's "one block" rule holds. */
export function buildSectionPrompt(req: AuditRequest, fence: Fence = noFence): string {
  return req.kind === "specialist"
    ? specialistPrompt(req.specialist, req.input, fence)
    : leadPrompt(req.input, req.reports, fence);
}
