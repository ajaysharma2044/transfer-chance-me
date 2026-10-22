// review-background — the half of /api/review that is allowed to take minutes.
// Netlify gives a background function 15 minutes; a synchronous one gets 10
// seconds, which is not enough for a single real section.
//
// The `-background` suffix in the FILENAME is what makes this a background
// function. Consequences worth knowing before editing:
//   - Netlify answers the caller 202 with an empty body and discards whatever
//     Response this returns. The only way results reach anyone is the store.
//   - A background function that THROWS is retried by Netlify. Each retry would
//     be another paid model call, so this file catches everything and records
//     the failure instead of throwing.
//
// It is reachable at /.netlify/functions/review-background by anyone, so it
// takes no applicant data of its own — only a job id minted by review.ts,
// which is where the session check, the rate limit and the size caps live. A
// caller with a random id gets nothing; a caller replaying a real id loses the
// claim (a conditional write, see _jobs.ts) and gets nothing either.
//
// What this does with a claimed job (docs/spec.md §5):
//   1. builds the prompt itself from the stored AuditRequest
//      (src/lib/audit/prompts.ts), with the applicant's writing in one block
//      fenced by a per-run nonce (api/_guard.ts) — the brief is ours and sits
//      outside the fence, so the model can tell them apart;
//   2. calls the model through the cost ledger (_llm.ts): worst-case cost is
//      reserved before dispatch and the five calls of one panel run share one
//      group, so the per-audit cap and the real-audit count hold;
//   3. validates the reply for the section kind that was asked for
//      (validateSection), retries the shape once, and stores only the picked
//      fields. The model never sets odds — the prompt carries the engine's.
//
// Env vars (server-side only, never VITE_-prefixed):
//   OPENROUTER_API_KEY / OPENROUTER_MODEL / PUBLIC_SITE_URL
//   ANTHROPIC_API_KEY  (used when OPENROUTER_API_KEY is absent)

import { detectInjection, guardSystem, makeNonce, screeningNote, wrapUntrusted } from "../../api/_guard";
import { buildSectionPrompt, SECTION_MAX_TOKENS, untrustedText } from "../../src/lib/audit/prompts";
import { parseModelJson, pickSection, validateSection } from "../../src/lib/audit/schema";
import { claimJob, getJob, putJob, RUN_BUDGET_MS, takeRequest } from "./_jobs.js";
import type { JobState } from "./_jobs.js";
import { BudgetExceededError } from "./_ledger.js";
import { anthropicProvider, callModel, openRouterProvider } from "./_llm.js";
import type { Message } from "./_llm.js";

const ANTHROPIC_MODEL = "claude-sonnet-5";
const DEFAULT_OPENROUTER_MODEL = "qwen/qwen3.7-plus";
const BREVITY = "Return ONLY the JSON object requested — no markdown fences, no commentary. Keep every field tight.";

/* One corrective retry, never two. A shape the model got wrong twice is a
 * broken model or a broken prompt, not bad luck, and an uncapped "try again"
 * is how one request becomes a bill. Every attempt goes through the ledger. */
const MAX_RETRIES = 1;

/* Per-call ceiling inside the run budget; the ledger's timeout aborts the
 * fetch and releases the reservation. */
const CALL_TIMEOUT_MS = 300_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 202 with an empty body, mirroring what Netlify sends the caller anyway. */
const ACCEPTED = (): Response => new Response(null, { status: 202 });

async function finish(jobId: string, doc: JobState): Promise<void> {
  try {
    await putJob(jobId, doc);
  } catch {
    // The client's poll sees the pending doc until it expires. Logged so the
    // failure is visible in the function log.
    console.log(JSON.stringify({ evt: "review_store_write_failed", job: jobId }));
  }
}

/** Record a failure only while the job is still pending — a late replay must
 *  never overwrite a result someone can still read. */
async function failIfPending(jobId: string, error: string): Promise<void> {
  const cur = await getJob(jobId).catch(() => null);
  if (!cur || cur.status !== "pending") return;
  await finish(jobId, { status: "error", error, finished: Date.now(), uid: cur.uid });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return ACCEPTED();

  let jobId = "";
  try {
    const body = (await req.json()) as { jobId?: unknown };
    if (typeof body.jobId === "string") jobId = body.jobId;
  } catch {
    /* falls through to the shape check below */
  }
  if (!UUID_RE.test(jobId)) return ACCEPTED();

  /* The claim. Exactly one invocation per job gets past this line. */
  let claimed = true;
  try {
    claimed = await claimJob(jobId);
  } catch {
    claimed = true; // store hiccup: takeRequest below is still one-shot in practice
  }
  if (!claimed) return ACCEPTED();

  let queued;
  try {
    queued = await takeRequest(jobId);
  } catch {
    await failIfPending(jobId, "Could not read the queued review — run it again.");
    return ACCEPTED();
  }
  if (!queued) {
    await failIfPending(jobId, "That review expired before it could run — run it again.");
    return ACCEPTED();
  }
  const { req: audit, uid } = queued;
  const errorDoc = (error: string): JobState => ({ status: "error", error, finished: Date.now(), uid });

  // OpenRouter first when configured; Anthropic direct otherwise.
  const orKey = process.env.OPENROUTER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!orKey && !anthropicKey) {
    await finish(jobId, errorDoc("The review service is not configured on this deployment."));
    return ACCEPTED();
  }
  const via: "openrouter" | "anthropic" = orKey ? "openrouter" : "anthropic";
  const model = via === "openrouter" ? (process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL) : ANTHROPIC_MODEL;
  const provider = via === "openrouter" ? openRouterProvider : anthropicProvider;

  /* The brief is ours; the applicant's writing is the one fenced block. The
   * rules live in the system message, the channel an applicant cannot write
   * into. Screening only counts shapes — the matched text stays in the review. */
  const nonce = makeNonce();
  const prompt = buildSectionPrompt(audit, (text) => wrapUntrusted(text, nonce).text);
  const flags = detectInjection(untrustedText(audit));
  const messages: Message[] = [
    { role: "system", content: `${guardSystem(nonce)}\n\n${BREVITY}` },
    { role: "user", content: flags.length ? `${prompt}\n\n${screeningNote(flags.length)}` : prompt },
  ];

  const kind = audit.kind === "specialist" ? `audit:specialist:${audit.specialist}` : "audit:lead";
  const group = audit.auditId ?? jobId;
  const started = Date.now();
  const spent = { in: 0, out: 0, usd: 0 };
  let attempts = 0;

  try {
    for (;;) {
      attempts += 1;
      const remaining = RUN_BUDGET_MS - (Date.now() - started);
      if (remaining < 10_000) throw Object.assign(new Error("run budget exhausted"), { name: "AbortError" });

      const reply = await callModel({
        kind,
        messages,
        maxTokens: SECTION_MAX_TOKENS[audit.kind],
        model,
        provider,
        providerName: via,
        audit: true,
        group,
        timeoutMs: Math.min(remaining, CALL_TIMEOUT_MS),
      });
      spent.in += reply.inputTokens;
      spent.out += reply.outputTokens;
      spent.usd += reply.costUsd;

      const parsed = parseModelJson(reply.text);
      const check = parsed.ok ? validateSection(audit.kind, parsed.value) : { ok: false as const, errors: [parsed.error] };
      if (parsed.ok && check.ok) {
        logUsage(via, model, kind, 200, Date.now() - started, spent, flags.length, attempts);
        await finish(jobId, {
          status: "done",
          result: { kind: audit.kind, section: pickSection(audit.kind, parsed.value as Record<string, unknown>) },
          finished: Date.now(),
          uid,
        });
        return ACCEPTED();
      }

      if (attempts > MAX_RETRIES) {
        logUsage(via, model, kind, 502, Date.now() - started, spent, flags.length, attempts);
        await finish(jobId, errorDoc("The review service returned an unreadable response — run it again."));
        return ACCEPTED();
      }
      // The correction names our own field types only — never the model's
      // text, which is a rephrasing of the student's material.
      messages.push(
        { role: "assistant", content: reply.text },
        { role: "user", content: correction(check.ok ? [] : check.errors) },
      );
    }
  } catch (err) {
    const e = err as { name?: string; message?: string } | null;
    if (err instanceof BudgetExceededError) {
      logUsage(via, model, kind, 402, Date.now() - started, spent, flags.length, attempts);
      await finish(jobId, errorDoc("The review budget for this deployment is used up for now — try again later."));
      return ACCEPTED();
    }
    const aborted = e?.name === "AbortError" || /abort/i.test(e?.message ?? "");
    const upstream = /^(?:OpenRouter|Anthropic) (\d{3})/.exec(e?.message ?? "");
    const status = aborted ? 504 : upstream ? Number(upstream[1]) : 502;
    logUsage(via, model, kind, status, Date.now() - started, spent, flags.length, attempts);
    // The failure's shape, never its text: which lets a "settle" or store
    // error be told apart from an upstream one in the function log.
    console.log(JSON.stringify({ evt: "review_call_failed", job: jobId, kind, name: e?.name ?? null, message: (e?.message ?? "").slice(0, 80) }));
    /* Never surface a raw upstream message: auth errors from both providers
     * can echo a key prefix back. Map to a fixed set of safe strings. */
    const error = aborted
      ? "The review took too long and was cancelled — try again, or shorten your materials."
      : status === 429 || status === 529
        ? "The review service is busy — try again in a moment."
        : status === 401 || status === 403
          ? "The review service rejected this deployment's credentials."
          : "Could not reach the review service.";
    await finish(jobId, errorDoc(error));
    return ACCEPTED();
  }
}

/** The one retry's message. Carries field names and nothing else. */
function correction(errors: string[]): string {
  return [
    "Your reply did not match the required JSON object:",
    ...errors.slice(0, 12).map((e) => `- ${e}`),
    "Send the same review again as ONLY the corrected JSON object — no markdown fences, no commentary.",
  ].join("\n");
}

/**
 * One structured line per section run, to the function log. Deliberately
 * carries NO applicant text and no user identity — this is the path that
 * handles student essays, and a log line is the easiest place for that
 * content to leak. Counts, cost and latency are enough to spot a spend spike
 * or an upstream going bad. `usd` is the ledger's settled figure (the
 * provider's reported cost when it reports one).
 */
function logUsage(
  via: string,
  model: string,
  kind: string,
  status: number,
  ms: number,
  spent: { in: number; out: number; usd: number },
  injection: number,
  attempts: number,
): void {
  console.log(JSON.stringify({
    evt: "review_call", via, model, kind, status, ms,
    tokens_in: spent.in, tokens_out: spent.out, usd: Number(spent.usd.toFixed(6)),
    injection, attempts,
  }));
}
