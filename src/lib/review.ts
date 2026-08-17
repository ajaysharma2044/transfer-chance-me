// Deep application review — Claude-powered, grounded in the outcome dataset.
// The user's own API key is stored only in this browser and requests go
// directly to Anthropic; no other server ever sees the application.

import { MODEL } from "../engine";
import type { Profile } from "../engine";
import INTEL_RAW from "../data/intel.json";

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

/* ── Field notes from the T25 Transfer Admissions Study ────────────────────
 * Distilled from the study's per-school intelligence briefs (Google Drive).
 * Injected per TARGET only, so the prompt grows with the applicant's list,
 * not with the corpus. Every line traces back to a brief; nothing here is
 * model-generated at request time. */

interface IntelEntry {
  timing?: string;
  paths?: string[];
  pitfalls?: string[];
  aid?: string;
  notes?: string[];
}
const INTEL = INTEL_RAW as unknown as Record<string, IntelEntry | unknown>;

export function intelLines(name: string): string {
  const e = INTEL[name] as IntelEntry | undefined;
  if (!e || typeof e !== "object") return "";
  const lines = [
    e.timing ? `Timing: ${e.timing}` : "",
    e.paths?.length ? `Doors in: ${e.paths.join("; ")}` : "",
    e.pitfalls?.length ? `Pitfalls seen in real files: ${e.pitfalls.join("; ")}` : "",
    e.aid ? `Aid: ${e.aid}` : "",
    ...(e.notes ?? []).map((n) => `- ${n}`),
  ].filter(Boolean);
  return lines.length ? `Field notes (from our T25 study briefs):\n${lines.join("\n")}` : "";
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
        intelLines(s.name),
      ].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

const DATASET_FINDINGS = `
Key findings from 8,910 recorded transfer outcomes (2011-2026), 4,243 admits:
- Transfer admission is GPA-dominated. Admitted-GPA clusters: big UCs ~3.82 median, elite privates 3.95-4.0.
- Activities matter, and PATTERN beats PRESTIGE (1,217 structured profiles): campus-anchored, institutional-stack activities (PTK, honors program, TA-ships, student government, faculty research) recur throughout admit files, while flashy external activities (competitions, startups, publications) alone do not rescue a GPA and skew toward rejected files when they substitute for the academic core. Grade activity descriptions on specificity, ownership, and campus-anchoring; rewrite weak ones toward that pattern.
- The #1 differentiator admits credit: a school-specific "why transfer" essay naming programs, professors, courses. Complaint-shaped essays (framing the move as escape from a bad school) fail; fit-and-resources framing wins.
- Feeder fit matters: UCs run on California community colleges (92% of UCLA admits); elite privates take both strong 4-year students and CC students with institutional credentials.
- High-school record is nearly irrelevant (corr with college GPA 0.016); 16% of admits are "redemption" cases.
- Reporting bias is real and you must correct for it: the corpus over-represents acceptances (people post wins), and nowhere more than CS/engineering — visible CS success stories vastly outnumber actual CS transfer seats. Never let a CS applicant believe the lane is as open as forums make it look; be explicit about scarcity and about backup-major/school strategy.
- Transfer intake tracks the freshman class, not just applicant quality: pooled across schools, a school's freshman over-yield in year Y predicts a *tighter* transfer rate in year Y+1 (r=-0.52) — a school that filled its freshman class housing takes fewer transfers the next cycle. When a target's freshman class recently over-enrolled or added transfer housing, say so as a timing factor, not just a GPA one.
- The elite-private door has been closing for a decade, unevenly: official rates fell sharply at UPenn (11.6%→3.2%), Cornell (19.6%→11.7%), Rice (14.5%→6.9%), Columbia (14.7%→9.0%) while the big publics (Berkeley, Michigan) held steady or rose. Don't anchor advice to an older, looser admit-rate era at the elite privates.
`;

/** Exported for the prompt-preview script and tests; the app itself only
 *  calls it through runReview. */
export function buildPrompt(input: ReviewInput): string {
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

/** A full review was measured at ~104s. This is the client's patience, set
 *  above that so a slow-but-working review is never killed from this side —
 *  the server enforces its own, shorter deadline and explains itself. Without
 *  any timeout at all a dropped connection leaves the UI spinning forever. */
const CLIENT_TIMEOUT_MS = 180_000;

/**
 * Wait for a queued review (the Netlify background-function path) and return
 * it as a Response, so the caller's existing parsing is untouched.
 *
 * The cadence and the give-up point come from the server's own 202 rather than
 * being hard-coded here: a client with its own copy of those numbers drifts
 * from the deployment the moment either changes.
 */
async function pollForReview(
  queued: { jobId?: string; pollAfterMs?: number; expiresInMs?: number },
  signal: AbortSignal,
): Promise<Response> {
  const every = Math.max(1000, queued.pollAfterMs ?? 3000);
  // The server's expiry, bounded by the client's own patience — whichever
  // gives up first should win, and neither should wait on a job that can no
  // longer exist.
  const until = Date.now() + Math.min(queued.expiresInMs ?? CLIENT_TIMEOUT_MS, CLIENT_TIMEOUT_MS);
  const url = `${REVIEW_ENDPOINT}?job=${encodeURIComponent(queued.jobId!)}`;

  for (;;) {
    if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (Date.now() > until) {
      throw new Error("The review did not finish in time — run it again.");
    }
    await new Promise((r) => setTimeout(r, every));

    const r = await fetch(url, { signal, headers: { accept: "application/json" } });
    if (r.status === 404) throw new Error("That review expired before it finished — run it again.");
    if (!r.ok) continue; // a transient 5xx on one poll is not a failed review

    const doc = (await r.json()) as { status?: string; result?: unknown; error?: string };
    if (doc.status === "pending") continue;
    if (doc.status === "error") throw new Error(doc.error ?? "The review failed — run it again.");
    if (doc.status === "done") {
      // Hand back exactly what the synchronous endpoint would have returned,
      // so the parsing below this call site never learns which host it is on.
      return new Response(JSON.stringify(doc.result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // An unknown status is a contract break, not something to spin on.
    throw new Error("The review service returned an unexpected response.");
  }
}

export async function runReview(input: ReviewInput): Promise<ReviewResult> {
  let res: Response;
  const clock = new AbortController();
  const stop = setTimeout(() => clock.abort(), CLIENT_TIMEOUT_MS);
  try {
  if (proxyMode) {
    // Server-side proxy: no key ever touches the browser.
    res = await fetch(REVIEW_ENDPOINT, {
      method: "POST",
      signal: clock.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: buildPrompt(input) }),
    });

    /* 202 means a queue, not a result.
     *
     * Vercel answers 200 with the review, because a synchronous function there
     * can run long enough to produce one. Netlify cannot — 10s against a ~104s
     * review — so its endpoint queues the work and answers 202 { jobId }, and
     * the review arrives by polling.
     *
     * Both are supported from one client on purpose: this app has config for
     * both hosts, and a client that assumed either one would break silently on
     * the other. The status code is the discriminator, so nothing has to be
     * configured to match the deployment. */
    if (res.status === 202) {
      const queued = (await res.json()) as {
        jobId?: string; pollAfterMs?: number; expiresInMs?: number;
      };
      if (!queued.jobId) throw new Error("The review service queued nothing — run it again.");
      res = await pollForReview(queued, clock.signal);
    }
  } else {
    const key = getApiKey();
    if (!key) throw new Error("No API key set.");
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: clock.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        // Matches the server's cap. The old 6,000 truncated verbose models
        // mid-JSON, which surfaced as "unreadable response" rather than as
        // the length problem it was.
        max_tokens: 12000,
        messages: [{ role: "user", content: buildPrompt(input) }],
      }),
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("That API key was rejected. Check it in the key settings below.");
    if (res.status === 429) throw new Error("Rate limited — wait a moment and try again.");
    // The proxy sends a specific, actionable message on its own deadline.
    // Surface that rather than burying it in a generic failure string.
    if (res.status === 504) {
      let msg = "The review took too long to finish.";
      try { msg = (JSON.parse(body) as { error?: string }).error ?? msg; } catch { /* keep default */ }
      throw new Error(msg);
    }
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
  } catch (e) {
    // Our own patience ran out. Distinguish it from a server error, because
    // the two call for different responses from the reader.
    if ((e as { name?: string } | null)?.name === "AbortError") {
      throw new Error(
        `The review did not finish within ${Math.round(CLIENT_TIMEOUT_MS / 1000)} seconds. ` +
        "Your materials may be unusually long — try trimming them, or run it again.",
      );
    }
    throw e;
  } finally {
    clearTimeout(stop);
  }
}
