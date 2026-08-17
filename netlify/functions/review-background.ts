// review-background — the half of /api/review that is allowed to take 104
// seconds. Netlify gives a background function 15 minutes; a synchronous one
// gets 10 seconds, which is not enough for a single real review.
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
// takes no prompt of its own — only a job id minted by netlify/functions/
// review.ts, which is where the origin allow-list, the rate limit and the
// prompt-size cap are enforced. A caller with a random id gets nothing, and a
// caller replaying a real id gets nothing either: the claim below is atomic and
// one-shot, so a job can only ever be run once.
//
// The prompt-injection defence and the response validation are the same ones
// api/review.ts uses, imported rather than copied: this path handles essays
// written by minors, and a second copy of a security guard is a copy that goes
// stale. Netlify's esbuild bundler follows the relative import out of the
// functions directory (see netlify.toml → [functions]).
//
// Env vars (server-side only, never VITE_-prefixed):
//   OPENROUTER_API_KEY / OPENROUTER_MODEL / PUBLIC_SITE_URL
//   ANTHROPIC_API_KEY  (used when OPENROUTER_API_KEY is absent)

import {
  detectInjection,
  guardSystem,
  parseReviewJson,
  screeningNote,
  validateReview,
  wrapUntrusted,
} from "../../api/_guard";
import { putJob, takePrompt } from "./_jobs.js";
import type { JobState } from "./_jobs.js";

/* Kept in lockstep with api/review.ts. Change both together or the Vercel and
 * Netlify deployments answer the same request with different models and costs. */
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 12000;
const BREVITY =
  "Return ONLY the JSON object requested — no markdown fences, no commentary. " +
  "Keep every field tight and the whole response under 5,000 tokens.";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "qwen/qwen3.7-plus";

/* One corrective retry, never two — same rule as api/review.ts. A shape the
 * model got wrong twice is a broken model or a broken prompt, not bad luck, and
 * an uncapped "try again" on a 12k-token call is how one request becomes a
 * bill. Every attempt is counted in the log line. */
const MAX_RETRIES = 1;

/* Budget for the WHOLE run, both attempts included — not per call, or a retry
 * could push past Netlify's 15-minute ceiling and the run would die without
 * writing anything the client could read. Well inside that ceiling, so a hung
 * upstream still leaves time to record a readable failure. */
const RUN_BUDGET_MS = 600_000;


/* ── Job store ──────────────────────────────────────────────────────────────
 * Netlify Blobs, via ./_jobs.ts — same store the POST half writes to.
 *
 * ONE GUARANTEE IS WEAKER THAN THE REDIS DRAFT, and it matters: that version
 * claimed a job with SET NX, an atomic compare-and-set, so a replayed
 * invocation could never buy the same review twice. Blobs has no atomic CAS.
 *
 * The claim here is takePrompt(): the prompt is read and deleted in one call,
 * so a second invocation finds nothing and stops. Two invocations that read
 * before either deletes would both proceed — the window is milliseconds, and
 * the cost of losing that race is one duplicate model call (~$0.01), not
 * corrupted or duplicated data, because both would write the same result to
 * the same key. That trade buys removing an entire third-party service from
 * the path that handles student essays, which is the better deal.
 */

async function finish(jobId: string, doc: JobState): Promise<void> {
  try {
    await putJob(jobId, doc);
  } catch {
    // Nothing left to do: the client's poll sees the pending doc until it
    // expires. Logged so the failure is visible in the function log.
    console.log(JSON.stringify({ evt: "review_store_write_failed", job: jobId }));
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 202 with an empty body, mirroring what Netlify sends the caller anyway. */
const ACCEPTED = (): Response => new Response(null, { status: 202 });

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

  /* Claim and read in one step. takePrompt deletes as it reads, so a replayed
   * invocation finds nothing and stops — see the note on the store above for
   * why this is best-effort rather than atomic, and what losing the race
   * costs. Deleting here also means the student's essay text sits in the store
   * for seconds rather than the full TTL. */
  let prompt: string | null;
  try {
    prompt = await takePrompt(jobId);
  } catch {
    await finish(jobId, { status: "error", error: "Could not read the queued review — run it again.", finished: Date.now() });
    return ACCEPTED();
  }
  if (typeof prompt !== "string" || prompt.length === 0) {
    await finish(jobId, { status: "error", error: "That review expired before it could run — run it again." , finished: Date.now() });
    return ACCEPTED();
  }
  // OpenRouter first when configured; Anthropic direct otherwise. Same
  // precedence as api/review.ts.
  const orKey = process.env.OPENROUTER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const apiKey = orKey ?? anthropicKey;
  const via: "openrouter" | "anthropic" = orKey ? "openrouter" : "anthropic";
  if (!apiKey) {
    await finish(jobId, {
      status: "error",
      error: "The review service is not configured on this deployment.", finished: Date.now(),
    });
    return ACCEPTED();
  }

  /* The browser composes the whole prompt (buildPrompt in src/lib/review.ts),
   * so the server cannot tell the review brief from the essay pasted into it —
   * and every byte of it arrived from a browser regardless. So the lot is
   * fenced as data, and the rules that must hold live in the system message,
   * the one channel an applicant cannot write into. Identical to api/review.ts;
   * the gap it leaves is documented there. */
  const flags = detectInjection(prompt);
  const fenced = wrapUntrusted(prompt);
  const system = `${guardSystem(fenced.nonce)}\n\n${BREVITY}`;
  const turns: Turn[] = [
    {
      role: "user",
      content: flags.length ? `${fenced.text}\n\n${screeningNote(flags.length)}` : fenced.text,
    },
  ];

  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), RUN_BUDGET_MS);

  // Every attempt is billed, so the log line reports the sum, not the last one.
  const spent = { in: 0, out: 0, usd: null as number | null };
  let attempts = 0;

  try {
    for (;;) {
      attempts += 1;
      const reply = await callModel(via, apiKey, system, turns, abort.signal);

      if (!reply.ok) {
        /* Never surface a raw upstream message: auth errors from both providers
         * can echo a key prefix back. Map to a fixed set of safe strings. This
         * is stricter than api/review.ts, which passes the upstream's own
         * error.message through — the difference is deliberate and the safer of
         * the two. */
        logUsage(via, reply.status, Date.now() - started, null, flags.length, attempts);
        const error =
          reply.status === 429 || reply.status === 529
            ? "The review service is busy — try again in a moment."
            : reply.status === 401 || reply.status === 403
              ? "The review service rejected this deployment's credentials."
              : "The review service could not complete this request.";
        await finish(jobId, { status: "error", error , finished: Date.now() });
        return ACCEPTED();
      }

      spent.in += reply.tokens.in;
      spent.out += reply.tokens.out;
      if (reply.tokens.usd !== null) spent.usd = (spent.usd ?? 0) + reply.tokens.usd;

      if (reply.text === null) {
        logUsage(via, 502, Date.now() - started, spent, flags.length, attempts);
        await finish(jobId, {
          status: "error",
          error: "The review service returned an unreadable response.", finished: Date.now(),
        });
        return ACCEPTED();
      }

      const parsed = parseReviewJson(reply.text);
      const check = parsed.ok ? validateReview(parsed.value) : { ok: false, errors: [parsed.error] };
      if (check.ok) {
        logUsage(via, 200, Date.now() - started, spent, flags.length, attempts);
        /* Anthropic's own response is passed through whole, as it always was;
         * OpenRouter's is normalised into that shape. Either way the client
         * reads result.content[0].text, exactly as it reads the Vercel
         * endpoint's body today. */
        await finish(jobId, {
          status: "done",
          result: via === "anthropic" ? reply.data : { content: [{ type: "text", text: reply.text }] },
          finished: Date.now(),
        });
        return ACCEPTED();
      }

      if (attempts > MAX_RETRIES) {
        // The errors name our own field types only — never the model's text,
        // which is a rephrasing of the student's material.
        logUsage(via, 502, Date.now() - started, spent, flags.length, attempts);
        await finish(jobId, {
          status: "error",
          error: "The review service returned an unreadable response.", finished: Date.now(),
        });
        return ACCEPTED();
      }
      turns.push(
        { role: "assistant", content: reply.text },
        { role: "user", content: correction(check.errors) },
      );
    }
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === "AbortError";
    logUsage(via, aborted ? 504 : 502, Date.now() - started, spent, flags.length, attempts);
    await finish(jobId, {
      status: "error",
      error: aborted
        ? "The review took too long and was cancelled — try again, or shorten your materials."
        : "Could not reach the review service.",
      finished: Date.now(),
    });
    return ACCEPTED();
  } finally {
    clearTimeout(timer);
  }
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface Reply {
  ok: boolean;
  status: number;
  /** Raw upstream JSON, kept so the Anthropic path can be passed through. */
  data: unknown;
  /** The model's message text, or null when the reply carried none. */
  text: string | null;
  tokens: { in: number; out: number; usd: number | null };
}

/** One upstream round-trip, in whichever dialect `via` speaks. Both dialects
 *  are reduced to the same {text, tokens} so the caller — which retries — does
 *  not branch on the backend. Mirrors callModel in api/review.ts. */
async function callModel(
  via: "openrouter" | "anthropic",
  apiKey: string,
  system: string,
  turns: Turn[],
  signal: AbortSignal,
): Promise<Reply> {
  if (via === "openrouter") {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        // Attribution on the OpenRouter dashboard. Never the user's URL —
        // that would leak which page a student was on.
        "HTTP-Referer": process.env.PUBLIC_SITE_URL ?? "https://transferchance.me",
        "X-Title": "Transfer Chance Me",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "system", content: system }, ...turns],
      }),
    });
    const data: unknown = await upstream.json().catch(() => null);
    const or = data as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        /** Actual dollars charged for THIS call. OpenRouter reports it;
         *  Anthropic direct does not, which is why the field is optional. */
        cost?: number;
      };
    } | null;
    const text = or?.choices?.[0]?.message?.content;
    return {
      ok: upstream.ok,
      status: upstream.status,
      data,
      text: typeof text === "string" ? text : null,
      tokens: {
        in: or?.usage?.prompt_tokens ?? 0,
        out: or?.usage?.completion_tokens ?? 0,
        usd: typeof or?.usage?.cost === "number" ? or.usage.cost : null,
      },
    };
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: turns,
    }),
  });
  const data: unknown = await upstream.json().catch(() => null);
  const anth = data as {
    content?: { text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  } | null;
  const text = anth?.content?.[0]?.text;
  return {
    ok: upstream.ok,
    status: upstream.status,
    data,
    text: typeof text === "string" ? text : null,
    tokens: {
      in: anth?.usage?.input_tokens ?? 0,
      out: anth?.usage?.output_tokens ?? 0,
      usd: null, // Anthropic's response carries no price; derive it from counts.
    },
  };
}

/** The one retry's message. Carries field names and nothing else: the student's
 *  material must not be echoed back into a turn we compose. */
function correction(errors: string[]): string {
  return [
    "Your reply did not match the required JSON object:",
    ...errors.slice(0, 12).map((e) => `- ${e}`),
    "Send the same review again as ONLY the corrected JSON object — no markdown fences, no commentary.",
  ].join("\n");
}

/**
 * One structured line per call, to the function log.
 *
 * Deliberately carries NO prompt text and no user identity — this is the path
 * that handles student essays and transcripts, and a log line is the easiest
 * place for that content to leak somewhere it was never meant to live. Counts,
 * cost and latency are enough to spot a spend spike or an upstream going bad.
 *
 * `usd` is the real amount charged for the call, which OpenRouter returns and
 * Anthropic does not. Logging the reported figure rather than tokens × a
 * hard-coded rate means the number stays right when prices change or when
 * OPENROUTER_MODEL is pointed at a different model.
 *
 * `injection` is how many injection SHAPES were flagged in the prompt — a
 * count, never the text that matched, which is student writing and belongs
 * only in the review. `attempts` is 1 unless the model's first answer failed
 * validation and the one retry was spent. Same fields as the Vercel handler's
 * line, so one log query reads both deployments.
 */
function logUsage(
  via: string,
  status: number,
  ms: number,
  tokens: { in: number; out: number; usd: number | null } | null,
  injection: number,
  attempts: number,
): void {
  console.log(
    JSON.stringify({
      evt: "review_call",
      via,
      model: via === "openrouter" ? OPENROUTER_MODEL : MODEL,
      status,
      ms,
      tokens_in: tokens?.in ?? null,
      tokens_out: tokens?.out ?? null,
      usd: tokens?.usd ?? null,
      injection,
      attempts,
    }),
  );
}
