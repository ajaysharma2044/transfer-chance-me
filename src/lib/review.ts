// Deep application review — Claude-powered, grounded in the outcome dataset.
// The user's own API key is stored only in this browser and requests go
// directly to Anthropic; no other server ever sees the application.

import { MODEL } from "../engine";
import type { Profile } from "../engine";

const KEY_STORE = "tcm.apikey.v1";
const RESULT_STORE = "tcm.review.v1";

// Proxy mode: when VITE_REVIEW_ENDPOINT is set at build time (e.g.
// "/api/review"), the prompt is POSTed there and the server holds the
// Anthropic key. When unset, the original browser-key path is used.
export const REVIEW_ENDPOINT: string =
  (import.meta.env.VITE_REVIEW_ENDPOINT as string | undefined) ?? "";
export const proxyMode = REVIEW_ENDPOINT.length > 0;

export function getApiKey(): string {
  try { return localStorage.getItem(KEY_STORE) ?? ""; } catch { return ""; }
}
export function setApiKey(k: string): void {
  if (k) localStorage.setItem(KEY_STORE, k.trim());
  else localStorage.removeItem(KEY_STORE);
}

export interface ReviewInput {
  profile: Profile;
  targets: string[];
  whyTransfer: string;
  statement: string;
  activities: string;
}

export interface EssayNote { quote: string; issue: string; fix: string }
export interface SchoolVerdict { school: string; verdict: string; moves: string[] }
export interface ReviewResult {
  grade: string;
  summary: string;
  strengths: string[];
  risks: string[];
  essay: { grade: string; notes: EssayNote[]; direction: string } | null;
  statement: { grade: string; notes: EssayNote[] } | null;
  activities: { grade: string; notes: EssayNote[]; reframes: string[] } | null;
  perSchool: SchoolVerdict[];
  actions: string[];
  generatedAt: string;
}

export function loadLastReview(): ReviewResult | null {
  try {
    const raw = localStorage.getItem(RESULT_STORE);
    return raw ? (JSON.parse(raw) as ReviewResult) : null;
  } catch { return null; }
}

function schoolContext(targets: string[]): string {
  return targets
    .map((name) => {
      const s = MODEL.schools.find((x) => x.name === name);
      if (!s) return "";
      const c = s.counsel;
      return [
        `## ${s.name} (official transfer admit rate ${s.rate}%, admitted-GPA p25/median/p75: ${s.gpa.p25}/${s.gpa.p50}/${s.gpa.p75})`,
        c?.typical ? `Typical admit: ${c.typical}` : "",
        c?.levers?.length ? `What moves the file: ${c.levers.join("; ")}` : "",
        c?.watchouts?.length ? `Watchouts: ${c.watchouts.join("; ")}` : "",
        c?.programs?.length ? `Named pathways admits cite: ${c.programs.join(", ")}` : "",
      ].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

const DATASET_FINDINGS = `
Key findings from 8,910 recorded transfer outcomes (2011-2026), 4,243 admits:
- Transfer admission is GPA-dominated. Admitted-GPA clusters: big UCs ~3.82 median, elite privates 3.95-4.0.
- Extracurricular strength shows NO admit advantage once GPA is held constant (1,217 structured profiles). Institutional-stack activities (PTK, honors program, TA, student gov, campus research help) skew ADMIT; flashy external ones (competitions, startups, publications) skew REJECT in the data - likely because they substitute for, rather than complement, the academic core.
- The #1 differentiator admits credit: a school-specific "why transfer" essay naming programs, professors, courses. Complaint-shaped essays (framing the move as escape from a bad school) fail; fit-and-resources framing wins.
- Feeder fit matters: UCs run on California community colleges (92% of UCLA admits); elite privates take both strong 4-year students and CC students with institutional credentials.
- High-school record is nearly irrelevant (corr with college GPA 0.016); 16% of admits are "redemption" cases.
`;

function buildPrompt(input: ReviewInput): string {
  const p = input.profile;
  return `You are the senior reviewer at a transfer-admissions consultancy staffed by transfer students at Ivy League schools, Duke, UChicago and Stanford. You are reviewing a real applicant's transfer application materials. Your feedback must be specific, honest, and actionable - quote their actual sentences, never generic advice. Ground every judgment in the dataset findings and per-school intelligence below.

${DATASET_FINDINGS}

# Per-school intelligence for this applicant's targets
${schoolContext(input.targets)}

# Applicant profile
- College GPA: ${p.gpa.toFixed(2)} (trend: ${p.gpaTrend})
- Current school: ${p.schoolName ?? p.institution}${p.caResident ? " (California)" : ""}
- Entering as: ${p.standing}; intended major: ${p.major}${p.majorDetail ? ` — specifically: ${p.majorDetail}` : ""}
- Credentials: ${[p.ptk && "Phi Theta Kappa", p.honors && "honors program", p.igetc && "IGETC", p.firstGen && "first-generation"].filter(Boolean).join(", ") || "none listed"}
- Path: ${p.hook}${p.sat ? `; SAT ${p.sat}` : ""}${p.workHours ? `; works ${p.workHours} hrs/week while enrolled` : ""}
${p.awardsText ? `- Awards & honors (their words): ${p.awardsText.replace(/\n+/g, "; ")}` : ""}
${p.transferReason ? `- Their stated reason for transferring (raw, unpolished): "${p.transferReason}" — assess whether this reason, as framed, helps or hurts, and how to frame it.` : ""}
${p.courses.length ? `- Courses taken: ${p.courses.slice(0, 40).join(", ")} — assess major-prep completeness for their intended major and each target.` : ""}

# Materials
${input.whyTransfer ? `## "Why transfer" essay\n${input.whyTransfer}` : "## \"Why transfer\" essay\n(not provided)"}
${input.statement ? `\n## Personal statement\n${input.statement}` : ""}
${input.activities ? `\n## Activities list (their own descriptions)\n${input.activities}` : ""}

# Your task
Return ONLY a JSON object (no markdown fences, no commentary) with exactly this shape:
{
  "grade": "<letter grade for the whole application, e.g. B+>",
  "summary": "<3-4 sentences: the honest read of this application as a whole>",
  "strengths": ["<specific strength>", ...],
  "risks": ["<specific risk or weakness>", ...],
  "essay": ${input.whyTransfer ? `{"grade": "<letter>", "notes": [{"quote": "<exact short quote from their essay>", "issue": "<what's wrong or working>", "fix": "<concrete rewrite direction>"}, ... 4-7 notes], "direction": "<2-3 sentences: overall rewrite direction>"}` : "null"},
  "statement": ${input.statement ? `{"grade": "<letter>", "notes": [{"quote": "...", "issue": "...", "fix": "..."}, ... 3-5 notes]}` : "null"},
  "activities": ${input.activities ? `{"grade": "<letter>", "notes": [{"quote": "<their description>", "issue": "...", "fix": "..."}, ... 3-6 notes], "reframes": ["<rewritten activity description they can use>", ...]}` : "null"},
  "perSchool": [{"school": "<target name exactly as given>", "verdict": "<2-3 sentences: how THIS application lands at THIS school, using the school intelligence>", "moves": ["<school-specific move>", ...]}],
  "actions": ["<highest-priority action first - the 3-6 things to do before submitting>"]
}
Quotes must be verbatim from the applicant's materials. Be direct about problems; flattery costs admissions.`;
}

export async function runReview(input: ReviewInput): Promise<ReviewResult> {
  let res: Response;
  if (proxyMode) {
    // Server-side proxy: no key ever touches the browser.
    res = await fetch(REVIEW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: buildPrompt(input) }),
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
        max_tokens: 6000,
        messages: [{ role: "user", content: buildPrompt(input) }],
      }),
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("That API key was rejected. Check it in the key settings below.");
    if (res.status === 429) throw new Error("Rate limited — wait a moment and try again.");
    throw new Error(`Review failed (${res.status}). ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? "";
  const jsonText = text.replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: Omit<ReviewResult, "generatedAt">;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("The reviewer returned an unreadable response — run it again.");
  }
  const result: ReviewResult = { ...parsed, generatedAt: new Date().toISOString() };
  try { localStorage.setItem(RESULT_STORE, JSON.stringify(result)); } catch { /* ok */ }
  return result;
}
