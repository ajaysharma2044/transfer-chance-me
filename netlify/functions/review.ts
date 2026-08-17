// /api/review — Netlify port of the Vercel handler in api/review.ts.
//
// WHY THIS ENDPOINT IS SPLIT IN TWO, when no other port needed to be:
// a full review takes ~104 seconds (measured: 3.7k tokens in, 6.7k out, on
// qwen/qwen3.7-plus). A synchronous Netlify function gets 10 seconds by
// default, 26 at the most a plan will sell — an order of magnitude short of
// every real review, while a two-sentence test call passes happily.
//
// Streaming does not rescue it, and the reason is ours rather than the
// platform's: this endpoint validates the model's JSON before handing it to a
// client that JSON.parses it and maps over the arrays (api/_guard.ts). That
// validation needs the whole object, so there is nothing to send for the first
// ~104 seconds regardless — a stream would be 104 seconds of silence followed
// by one chunk, inside the same execution limit.
//
// A background function is the only runtime here with a 15-minute budget, and
// a background function answers the caller with 202 and an EMPTY body — it
// cannot return the review. So:
//
//   POST /api/review           this file. Validates, stores the prompt, fires
//                              review-background.ts, answers 202 { jobId }.
//   (worker)                   review-background.ts. Calls the model for as
//                              long as it takes, writes the result to the store.
//   GET  /api/review?job=<id>  this file. pending / done / error.
//
// That changes the client contract: src/lib/review.ts currently does one fetch
// and one `await res.json()`. It must POST, then poll. The exact edit is
// written out in NETLIFY.md — nothing else in src/ changes.
//
// The job store is Netlify Blobs (./_jobs.ts). A store is REQUIRED here,
// unlike on Vercel: two separate invocations share no memory, so the prompt
// and the result must live somewhere both can reach. Blobs is built into the
// platform, so that costs no new vendor holding student essays and no new
// bill. See NETLIFY.md → "What the prompt store means for privacy".
//
// Env vars (ALL server-side — never a VITE_ var, which Vite would inline into
// every visitor's browser bundle):
//   OPENROUTER_API_KEY / ANTHROPIC_API_KEY  at least one, read by the worker.
//   ALLOWED_ORIGIN     required in prod. Comma-separated allow-list.

import { bump, dropJob, getJob, putJob, putPrompt } from "./_jobs.js";

export const config = { path: "/api/review" };

/** Whole assembled prompt, matching api/review.ts. */
const MAX_PROMPT_CHARS = 40_000;
/** Transport cap. JSON-escaping 40k chars of essay text can roughly double it. */
const MAX_BODY_BYTES = 128 * 1024;

/* Everything about a job dies after this. It is Netlify's own ceiling for a
 * background function, so a job cannot outlive the run that would fill it. */
const JOB_TTL_SEC = 900;

/* Poll cadence and give-up point, both sent in the 202 so the client does not
 * hard-code a copy of either. `expiresInMs` matters: without it a client that
 * misses the worker's failure — a Netlify invocation that never lands leaves no
 * error doc to read — polls a pending job until the heat death of the tab. */
const POLL_AFTER_MS = 3_000;

/* ── Job store ──────────────────────────────────────────────────────────────
 * Netlify Blobs, via ./_jobs.ts. Built into the platform: no second vendor
 * holding student review text, no extra bill, nothing to configure. The
 * earlier draft of this file used Upstash Redis, which was a new service to
 * solve a problem the host already solves.
 */

/* ── Rate limiting ──────────────────────────────────────────────────────────
 * Two tiers, on purpose:
 *
 *   POST (starting a review) is the path that spends money, so it is counted
 *   in Blobs — shared across instances, and strictly stronger than the Vercel
 *   original whose Map lived in one instance's memory. `bump` is not atomic
 *   (see _jobs.ts), so a simultaneous burst can slip one or two past; it makes
 *   hammering the paid endpoint expensive rather than free, which is the job.
 *
 *   GET (polling) is counted in instance memory only. Netlify runs many
 *   instances, so the effective ceiling is (limit x live instances): protection
 *   against one client hammering one instance, nothing more. Deliberate — a
 *   review needs ~35 polls, and metering each one in the store would triple
 *   this endpoint's store traffic to guard a request that costs nothing.
 */
const START_MAX = 5; // per IP per window — matches api/review.ts
const START_WINDOW_SEC = 60;
const POLL_MAX = 120; // ~ one poll every 500ms, well above the 3s cadence
const POLL_WINDOW_SEC = 60;

const buckets = new Map<string, { count: number; resets: number }>();

function allowInMemory(key: string, max: number, windowSec: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resets) {
    buckets.set(key, { count: 1, resets: now + windowSec * 1000 });
    if (buckets.size > 10_000) buckets.clear(); // bound instance memory
    return true;
  }
  b.count += 1;
  return b.count <= max;
}

/* ── Client identity ────────────────────────────────────────────────────────
 * x-nf-client-connection-ip is written by Netlify's edge and overwrites
 * anything the caller sent, so it is the trustworthy one. x-forwarded-for is
 * only a convenience for `netlify dev`, where the edge header is absent; in
 * production that branch is unreachable, so a forged header cannot be used to
 * dodge the limit.
 */
function clientIp(req: Request): string {
  const direct = req.headers.get("x-nf-client-connection-ip");
  if (direct) return direct;
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/* ── Responses ──────────────────────────────────────────────────────────────
 * no-store matters: these bodies carry the review, which quotes the student's
 * own essays back at them.
 */
function json(body: unknown, status: number, headers?: Headers): Response {
  const h = new Headers(headers ?? undefined);
  h.set("content-type", "application/json; charset=utf-8");
  h.set("cache-control", "no-store");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  return new Response(JSON.stringify(body), { status, headers: h });
}

/* ── CORS / origin allow-listing ────────────────────────────────────────────
 * Stated plainly because it is easy to over-trust: an Origin check is a
 * browser-side guard, not authentication. curl can omit or forge Origin at
 * will. It stops your endpoint being embedded on someone else's site; it does
 * not stop a determined person spending your credit. The rate limit above and
 * a verified Supabase session JWT are the controls that do that.
 *
 * Deliberate difference from api/review.ts, matching the Cloudflare port: when
 * ALLOWED_ORIGIN is unset we emit no Access-Control-Allow-Origin at all rather
 * than reflecting whatever Origin arrived. Same-origin fetches — all this app
 * makes — never need the header, so nothing breaks, but an unconfigured
 * deployment no longer hands every site on the internet browser-level
 * permission to read responses from a proxy that holds a key.
 */
function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function corsHeaders(req: Request): Headers | null {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  });
  const origin = req.headers.get("origin");
  if (!origin) return headers; // same-origin / non-browser: nothing to grant

  const allowed = (process.env.ALLOWED_ORIGIN ?? "").split(",").map(normalizeOrigin).filter(Boolean);
  if (allowed.length === 0) return headers; // unconfigured: grant nothing
  if (!allowed.includes(normalizeOrigin(origin))) return null; // → 403

  headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

/* ── Body reading ───────────────────────────────────────────────────────────
 * Requiring content-type: application/json is also a CSRF control — it is not
 * a CORS-"simple" content type, so a cross-origin browser request carrying it
 * must pass preflight, which the origin allow-list above then answers.
 */
type BodyResult = { ok: true; value: Record<string, unknown> } | { ok: false; status: number; error: string };

async function readJsonBody(req: Request, maxBytes: number): Promise<BodyResult> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return { ok: false, status: 415, error: "Expected content-type: application/json." };
  }
  // Cheap pre-check: reject an oversized body before reading a byte of it.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: `Request too large (max ${maxBytes} bytes).` };
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, status: 400, error: "Could not read the request body." };
  }
  // Re-check after reading: Content-Length can be absent (chunked) or wrong.
  if (new TextEncoder().encode(raw).length > maxBytes) {
    return { ok: false, status: 413, error: `Request too large (max ${maxBytes} bytes).` };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "Body must be valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, status: 400, error: "Body must be a JSON object." };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

/* ── Handler ────────────────────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req);
  if (!cors) return json({ error: "Origin not allowed." }, 403);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method === "GET") return poll(req, cors);
  if (req.method !== "POST") return json({ error: "POST to start, GET to poll." }, 405, cors);

  // Netlify Blobs needs no configuration, so a missing model key is the only
  // thing that can leave this deployment unable to run a review. 503, not 500:
  // the site keeps working in browser-key mode. Deliberately does not name the
  // variables back to the browser.
  if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return json({ error: "The review service is not configured on this deployment." }, 503, cors);
  }

  const ip = clientIp(req);
  if (!(await bump(`start:${ip}`, START_MAX, START_WINDOW_SEC))) {
    const headers = new Headers(cors);
    headers.set("Retry-After", String(START_WINDOW_SEC));
    return json({ error: "Too many requests — wait a minute and try again." }, 429, headers);
  }

  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body.ok) return json({ error: body.error }, body.status, cors);

  const prompt = body.value.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return json({ error: "Missing 'prompt' string." }, 400, cors);
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return json({ error: `Prompt too long (max ${MAX_PROMPT_CHARS} characters).` }, 413, cors);
  }

  // The job id is the client's only handle on the result, so it is also the
  // only thing guarding it: unguessable by construction, and short-lived.
  const jobId = globalThis.crypto.randomUUID();

  try {
    await putPrompt(jobId, prompt);
    await putJob(jobId, { status: "pending", started: Date.now() });
  } catch {
    return json({ error: "Could not queue the review — try again." }, 502, cors);
  }

  /* Fire the worker. Netlify background functions are invoked over HTTP like
   * any other function and answer 202 immediately, so this await costs one
   * round trip, not 104 seconds. The origin is taken from the incoming request
   * so deploy previews call their own worker rather than production's. */
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5_000);
    let triggered: Response;
    try {
      triggered = await fetch(`${new URL(req.url).origin}/.netlify/functions/review-background`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!triggered.ok) throw new Error(`trigger ${triggered.status}`);
  } catch {
    // Don't leave a pending job the client would poll for 15 minutes.
    await dropJob(jobId).catch(() => {});
    console.log(JSON.stringify({ evt: "review_trigger_failed", job: jobId }));
    return json({ error: "Could not start the review — try again." }, 502, cors);
  }

  // No prompt text and no identity in the log line; see logUsage in the worker.
  console.log(JSON.stringify({ evt: "review_queued", job: jobId, prompt_chars: prompt.length }));
  return json(
    { status: "pending", jobId, pollAfterMs: POLL_AFTER_MS, expiresInMs: JOB_TTL_SEC * 1000 },
    202,
    cors,
  );
}

/**
 * GET /api/review?job=<uuid>
 *
 * 200 {"status":"pending"}                         still running
 * 200 {"status":"done","result":{content:[…]}}     result is Anthropic-shaped,
 *                                                  so the existing client
 *                                                  parser (data.content[0].text)
 *                                                  works on `result` unchanged
 * 200 {"status":"error","error":"…"}               the run failed; message is safe to show
 * 404 {"error":"…"}                                unknown or expired job id
 */
async function poll(req: Request, cors: Headers): Promise<Response> {
  const jobId = new URL(req.url).searchParams.get("job") ?? "";
  if (!UUID_RE.test(jobId)) return json({ error: "Missing or malformed 'job' id." }, 400, cors);

  if (!allowInMemory(`review:poll:${clientIp(req)}`, POLL_MAX, POLL_WINDOW_SEC)) {
    const headers = new Headers(cors);
    headers.set("Retry-After", String(POLL_WINDOW_SEC));
    return json({ error: "Too many requests — wait a minute and try again." }, 429, headers);
  }

  let state;
  try {
    state = await getJob(jobId);
  } catch {
    return json({ error: "Could not reach the review store — try again." }, 502, cors);
  }
  // Absent covers both "never existed" and "past its TTL" — the store enforces
  // expiry on read (see _jobs.ts), so those are the same answer to the client.
  if (!state) {
    return json({ error: "That review has expired or was never started." }, 404, cors);
  }
  return json(state, 200, cors);
}
