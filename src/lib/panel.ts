// The review panel: instead of one model reading everything at once, a set of
// specialists each read the part of the application they know best, in
// parallel, and a lead reviewer synthesises the verdict from their reports.
//
// Each specialist is grounded in the dataset and in this applicant's own
// computed odds, so the feedback argues about their real file, not a generic one.

import { MODEL } from "../engine";
import type { Profile } from "../engine";
import { buildPlan } from "./actionplan";
import { getApiKey, intelLines, proxyMode, REVIEW_ENDPOINT } from "./review";

const PANEL_STORE = "tcm.panel.v1";

export type SpecialistId = "coursework" | "activities" | "essay" | "fit" | "lead";

export interface Specialist {
  id: SpecialistId;
  name: string;
  role: string;
  color: string;
}

export const SPECIALISTS: Specialist[] = [
  { id: "coursework", name: "Coursework", role: "Major-prep and transcript rigour", color: "var(--blue)" },
  { id: "activities", name: "Activities", role: "What your record shows you actually did", color: "var(--teal)" },
  { id: "essay", name: "Essays", role: "The why-transfer case, line by line", color: "var(--accent)" },
  { id: "fit", name: "School fit", role: "How this file lands at each target", color: "var(--coral)" },
];

export interface Note { quote: string; issue: string; fix: string }

export interface SpecialistReport {
  id: SpecialistId;
  grade: string;
  headline: string;
  notes: Note[];
  actions: string[];
  /** Anything the reviewer could not judge because it wasn't provided. */
  missing: string[];
}

export interface PanelResult {
  grade: string;
  summary: string;
  strengths: string[];
  risks: string[];
  reports: SpecialistReport[];
  priorities: string[];
  generatedAt: string;
}

export interface PanelInput {
  profile: Profile;
  targets: string[];
  whyTransfer: string;
  statement: string;
  activities: string;
}

export function loadPanel(): PanelResult | null {
  try {
    const raw = localStorage.getItem(PANEL_STORE);
    return raw ? (JSON.parse(raw) as PanelResult) : null;
  } catch { return null; }
}

const FINDINGS = `
Grounding facts from 8,910 recorded transfer outcomes (4,243 admits, 2011-2026):
- Transfer admission is GPA-dominated. Elite private admits cluster 3.95-4.0; big UC admits ~3.82 median.
- Activities matter and PATTERN BEATS PRESTIGE. Across 1,217 structured profiles, 50% of admits' listed activities are campus-anchored (club leadership, tutoring/TA work, faculty research, PTK/honors, student government) and only 9% are national-scope. Trophy activities alone never rescue a GPA.
- The #1 differentiator admits credit is a school-specific "why transfer" essay naming programs, professors and courses. Complaint-shaped essays (framing the move as escape) fail; fit-and-resources framing wins.
- Feeder fit matters: the UCs run on California community colleges (92% of UCLA admits).
- High-school record barely predicts college GPA (r = 0.016); 16% of admits are redemption cases.
- Reporting bias is real: the corpus over-represents acceptances, and nowhere more than CS/engineering, where visible success stories vastly outnumber actual transfer seats. Never let a CS applicant believe that lane is as open as forums suggest.
`;

function profileBlock(p: Profile): string {
  return [
    `- College GPA ${p.gpa.toFixed(2)} (trend: ${p.gpaTrend})`,
    `- Currently at: ${p.schoolName ?? p.institution}${p.caResident ? " (California resident)" : ""}`,
    `- Entering as ${p.standing}; intended major: ${p.major}${p.majorDetail ? ` — specifically ${p.majorDetail}` : ""}`,
    `- Credentials: ${[p.ptk && "Phi Theta Kappa", p.honors && "honors program", p.igetc && "IGETC", p.firstGen && "first-generation"].filter(Boolean).join(", ") || "none listed"}`,
    p.workHours ? `- Works ${p.workHours} hrs/week while enrolled` : "",
    p.hook !== "none" ? `- Path: ${p.hook}` : "",
    p.courses.length ? `- Courses on record (${p.courses.length}): ${p.courses.slice(0, 45).join(", ")}` : "- No coursework provided",
    p.awardsText ? `- Awards, in their words: ${p.awardsText.replace(/\n+/g, "; ")}` : "",
    p.transferReason ? `- Why they say they're transferring: "${p.transferReason}"` : "",
  ].filter(Boolean).join("\n");
}

function schoolBlock(targets: string[]): string {
  return targets.map((name) => {
    const s = MODEL.schools.find((x) => x.name === name);
    if (!s) return "";
    const c = s.counsel;
    return [
      `## ${s.name} — official transfer admit rate ${s.rate}%${s.gpa.p50 != null ? `, admitted GPA p25/median/p75 ${s.gpa.p25}/${s.gpa.p50}/${s.gpa.p75}` : ", admitted-GPA range not published"}`,
      c?.typical ? `Typical admit: ${c.typical}` : "",
      c?.levers?.length ? `Moves the file: ${c.levers.join("; ")}` : "",
      c?.watchouts?.length ? `Watchouts: ${c.watchouts.join("; ")}` : "",
      intelLines(s.name),
    ].filter(Boolean).join("\n");
  }).filter(Boolean).join("\n\n");
}

const NOTE_SHAPE = `"notes": [{"quote": "<a short verbatim quote from THEIR material, or the exact item from their record>", "issue": "<what is wrong or working — be specific and honest>", "fix": "<the concrete change to make>"}]`;

function specialistPrompt(id: SpecialistId, input: PanelInput, oddsLine: string): string {
  const p = input.profile;
  const head = `You are one of four specialist reviewers on a transfer-admissions panel. You review ONLY your specialty; another reviewer covers each of the others, so do not duplicate their work. Be specific, honest, and useful — flattery costs admissions. Quote the applicant's own words or record items verbatim.

${FINDINGS}

# This applicant
${profileBlock(p)}

# Their computed odds right now
${oddsLine}

# Their targets
${schoolBlock(input.targets)}
`;

  const tasks: Record<SpecialistId, string> = {
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
Judge how THIS file lands at EACH named target, using that school's real admit rate, admitted-GPA range, feeder pattern and watchouts. Be blunt where a target is unrealistic and say what the file would need to change. Assess the shape of the list: is it top-heavy with reaches, missing a genuine safety, ignoring a guaranteed pathway (TAG/ADT/GAA/CAP) they qualify for? Name specific schools they should add or drop, and why.

Use one note per school, with the school name as the "quote".`,
  } as Record<SpecialistId, string>;

  return `${head}

# Their materials
${input.whyTransfer ? `## Why-transfer essay\n${input.whyTransfer}` : "## Why-transfer essay\n(not provided)"}
${input.statement ? `\n## Personal statement\n${input.statement}` : ""}
${input.activities ? `\n## Activities, in their words\n${input.activities}` : "\n## Activities\n(not provided)"}

${tasks[id]}

Return ONLY a JSON object, no markdown fences:
{
  "grade": "<letter grade for this dimension only, e.g. B+>",
  "headline": "<one sentence: the honest read of this dimension>",
  ${NOTE_SHAPE.replace(/^/, "")} (4-7 notes),
  "actions": ["<the concrete things to do in this lane, highest priority first>"],
  "missing": ["<anything you could not judge because they didn't provide it>"]
}`;
}

function leadPrompt(input: PanelInput, reports: SpecialistReport[], oddsLine: string): string {
  return `You are the lead reviewer on a transfer-admissions panel. Four specialists have each reviewed one dimension of this application. Synthesise their reports into the verdict the applicant reads first.

${FINDINGS}

# Applicant
${profileBlock(input.profile)}

# Computed odds
${oddsLine}

# Specialist reports
${reports.map((r) => `## ${r.id} — grade ${r.grade}\n${r.headline}\nActions: ${r.actions.join("; ")}\nGaps: ${r.missing.join("; ") || "none"}`).join("\n\n")}

Weigh the dimensions the way the data does: GPA and major preparation dominate, the school-specific essay is the top differentiator among qualified files, activities matter by pattern not prestige. Where specialists disagree, resolve it and say why. Be honest about ceilings — if the reaches are out of range, say so and redirect attention to what is winnable.

Return ONLY a JSON object, no markdown fences:
{
  "grade": "<overall letter grade>",
  "summary": "<4-5 sentences: the honest read of this application as a whole, and what would change it most>",
  "strengths": ["<specific>"],
  "risks": ["<specific>"],
  "priorities": ["<the 4-6 things to do before submitting, hardest-hitting first, each naming the concrete action>"]
}`;
}

async function callModel(prompt: string, signal?: AbortSignal): Promise<string> {
  let res: Response;
  if (proxyMode) {
    res = await fetch(REVIEW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal,
    });
  } else {
    const key = getApiKey();
    if (!key) throw new Error("No API key set.");
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("That API key was rejected — check it in key settings.");
    if (res.status === 429) throw new Error("Rate limited — wait a moment and run it again.");
    throw new Error(`Review failed (${res.status}). ${body.slice(0, 160)}`);
  }
  const data = await res.json();
  return (data.content?.[0]?.text ?? "") as string;
}

function parseJson<T>(text: string, what: string): T {
  const cleaned = text.replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Models occasionally wrap or prefix; salvage the outermost object.
    const a = cleaned.indexOf("{");
    const b = cleaned.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try { return JSON.parse(cleaned.slice(a, b + 1)) as T; } catch { /* fall through */ }
    }
    throw new Error(`The ${what} reviewer returned an unreadable response — run it again.`);
  }
}

export interface PanelProgress {
  (id: SpecialistId, state: "running" | "done" | "failed", report?: SpecialistReport): void;
}

/** Run the four specialists in parallel, then the lead. */
export async function runPanel(
  input: PanelInput,
  onProgress?: PanelProgress,
  signal?: AbortSignal,
): Promise<PanelResult> {
  const plan = buildPlan(input.profile);
  const top = plan.focus.slice(0, 6).join(", ");
  const oddsLine = `Best positions right now: ${top || "not computed"}. Nearest deadline: ${
    plan.next ? `${plan.next.school} in ${plan.next.days} days (${plan.next.label})` : "none tracked"
  }.`;

  const settled = await Promise.all(
    SPECIALISTS.map(async (sp) => {
      onProgress?.(sp.id, "running");
      try {
        const text = await callModel(specialistPrompt(sp.id, input, oddsLine), signal);
        const parsed = parseJson<Omit<SpecialistReport, "id">>(text, sp.name.toLowerCase());
        const report: SpecialistReport = {
          id: sp.id,
          grade: parsed.grade ?? "—",
          headline: parsed.headline ?? "",
          notes: Array.isArray(parsed.notes) ? parsed.notes : [],
          actions: Array.isArray(parsed.actions) ? parsed.actions : [],
          missing: Array.isArray(parsed.missing) ? parsed.missing : [],
        };
        onProgress?.(sp.id, "done", report);
        return report;
      } catch (err) {
        onProgress?.(sp.id, "failed");
        // One specialist failing must not lose the other three.
        void err;
        return null;
      }
    }),
  );

  const reports = settled.filter(Boolean) as SpecialistReport[];
  if (reports.length === 0) throw new Error("Every reviewer failed — check your key and try again.");

  onProgress?.("lead", "running");
  const leadText = await callModel(leadPrompt(input, reports, oddsLine), signal);
  const lead = parseJson<Omit<PanelResult, "reports" | "generatedAt">>(leadText, "lead");
  onProgress?.("lead", "done");

  const result: PanelResult = {
    grade: lead.grade ?? "—",
    summary: lead.summary ?? "",
    strengths: Array.isArray(lead.strengths) ? lead.strengths : [],
    risks: Array.isArray(lead.risks) ? lead.risks : [],
    priorities: Array.isArray(lead.priorities) ? lead.priorities : [],
    reports,
    generatedAt: new Date().toISOString(),
  };
  try { localStorage.setItem(PANEL_STORE, JSON.stringify(result)); } catch { /* ok */ }
  return result;
}
