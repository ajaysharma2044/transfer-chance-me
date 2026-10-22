// /api/review — start one section of the deep audit, or poll one.
//
// WHY THIS ENDPOINT IS SPLIT IN TWO, when no other function needed to be: a
// section takes up to a couple of minutes of model time. A synchronous Netlify
// function gets 10 seconds by default, 26 at the most a plan will sell. A
// background function has a 15-minute budget but answers the caller with 202
// and an EMPTY body — it cannot return the result. So:
//
//   POST /api/review           this file. Verifies the caller, parses a typed
//                              AuditRequest (src/lib/audit/schema.ts), stores
//                              it under the caller's id, fires
//                              review-background.ts, answers 202 { jobId }.
//   (worker)                   review-background.ts. Builds the prompt from the
//                              stored request, calls the model through the
//                              cost ledger, writes the validated section.
//   GET  /api/review?job=<id>  this file. pending / done / error — only for the
//                              user who started the job.
//
// The browser never sends a prompt (docs/spec.md §5). It sends the applicant's
// structured inputs; the server authors the brief, so it always knows which
// bytes are instructions and which are the applicant's writing to fence.
//
// The job store is Netlify Blobs (./_jobs.ts): two invocations share no
// memory, so the request and the result must live somewhere both can reach,
// and Blobs is built into the platform — no new vendor holding student essays.
//
// Env vars (ALL server-side — never a VITE_ var, which Vite would inline into
// every visitor's browser bundle):
//   OPENROUTER_API_KEY / ANTHROPIC_API_KEY  at least one, read by the worker.
//   SUPABASE_URL + VITE_SUPABASE_ANON_KEY   session verification (./_auth.ts).
//   ALLOWED_ORIGIN                          required in prod. Comma-separated.

import { parseAuditRequest } from "../../src/lib/audit/schema";
import { requireUser } from "./_auth.js";
import {
  bump, clientView, dropJob, getJob, PENDING_DEADLINE_MS, POLL_AFTER_MS, putJob, putRequest,
} from "./_jobs.js";

export const config = { path: "/api/review" };

/** Transport cap: three 20k-character texts, a course list, JSON-escaped. */
const MAX_BODY_BYTES = 256 * 1024;

/* ── Rate limiting ──────────────────────────────────────────────────────────
 * Starting a section is the path that spends money, so it is counted in
 * Blobs — shared across instances — per USER (one panel run is five starts)
 * and, more loosely, per IP. `bump` is not atomic (see _jobs.ts), so a
 * simultaneous burst can slip one or two past; it makes hammering the paid
 * endpoint expensive rather than free, which is the job. The real spend gate
 * is the ledger in the worker.
 *
 * Polling is counted in instance memory only: a run polls five jobs at once
 * every three seconds, and metering each poll in the store would multiply
 * this endpoint's store traffic to guard a request that costs nothing.
 */
const START_MAX_PER_USER = 12;
const START_MAX_PER_IP = 30;
const START_WINDOW_SEC = 60;
const POLL_MAX = 300;
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

/* x-nf-client-connection-ip is written by Netlify's edge and overwrites
 * anything the caller sent. x-forwarded-for is only for `netlify dev`. */
function clientIp(req: Request): string {
  const direct = req.headers.get("x-nf-client-connection-ip");
  if (direct) return direct;
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/* no-store matters: these bodies carry the review, which quotes the student's
 * own essays back at them. */
function json(body: unknown, status: number, headers?: Headers): Response {
  const h = new Headers(headers ?? undefined);
  h.set("content-type", "application/json; charset=utf-8");
  h.set("cache-control", "no-store");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  return new Response(JSON.stringify(body), { status, headers: h });
}

/* ── CORS / origin allow-listing ────────────────────────────────────────────
 * An Origin check is a browser-side guard, not authentication: curl can forge
 * it. It stops the endpoint being embedded on someone else's site; the
 * session check and the ledger are what stop a stranger spending credit.
 * When ALLOWED_ORIGIN is unset we emit no Access-Control-Allow-Origin at all
 * rather than reflecting whatever arrived — same-origin fetches never need it.
 */
function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function corsHeaders(req: Request): Headers | null {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Max-Age": "86400",
  });
  const origin = req.headers.get("origin");
  if (!origin) return headers;
  const allowed = (process.env.ALLOWED_ORIGIN ?? "").split(",").map(normalizeOrigin).filter(Boolean);
  if (allowed.length === 0) return headers;
  if (!allowed.includes(normalizeOrigin(origin))) return null;
  headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

/* Requiring content-type: application/json is also a CSRF control — it is not
 * a CORS-"simple" content type, so a cross-origin browser request carrying it
 * must pass preflight, which the allow-list above answers. */
type BodyResult = { ok: true; value: unknown } | { ok: false; status: number; error: string };

async function readJsonBody(req: Request, maxBytes: number): Promise<BodyResult> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return { ok: false, status: 415, error: "Expected content-type: application/json." };
  }
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
  if (new TextEncoder().encode(raw).length > maxBytes) {
    return { ok: false, status: 413, error: `Request too large (max ${maxBytes} bytes).` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, status: 400, error: "Body must be valid JSON." };
  }
}

/* ── Handler ────────────────────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req);
  if (!cors) return json({ error: "Origin not allowed." }, 403);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method === "GET") return poll(req, cors);
  if (req.method !== "POST") return json({ error: "POST to start, GET to poll." }, 405, cors);

  // A missing model key is the one thing that can leave this deployment unable
  // to run a review. 503, not 500, and it does not name the variables.
  if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return json({ error: "The review service is not configured on this deployment." }, 503, cors);
  }

  const who = await requireUser(req);
  if (!who.ok) return json({ error: who.error }, who.status, cors);
  const uid = who.caller.uid;

  const ip = clientIp(req);
  const underUser = await bump(`start:user:${uid}`, START_MAX_PER_USER, START_WINDOW_SEC);
  const underIp = await bump(`start:ip:${ip}`, START_MAX_PER_IP, START_WINDOW_SEC);
  if (!underUser || !underIp) {
    const headers = new Headers(cors);
    headers.set("Retry-After", String(START_WINDOW_SEC));
    return json({ error: "Too many reviews at once — wait a minute and try again." }, 429, headers);
  }

  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body.ok) return json({ error: body.error }, body.status, cors);

  const parsed = parseAuditRequest(body.value);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status, cors);
  const audit = parsed.value;

  // The job id is the client's handle on the result; the uid on the record is
  // what guards it. Unguessable AND owned.
  const jobId = globalThis.crypto.randomUUID();

  try {
    await putRequest(jobId, { req: audit, uid });
    await putJob(jobId, { status: "pending", started: Date.now(), uid });
  } catch {
    return json({ error: "Could not queue the review — try again." }, 502, cors);
  }

  /* Fire the worker. Background functions are invoked over HTTP like any other
   * and answer 202 immediately, so this await costs one round trip. The origin
   * is taken from the incoming request so deploy previews call their own
   * worker rather than production's. */
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
    await dropJob(jobId).catch(() => {}); // don't leave a pending job the client would poll
    console.log(JSON.stringify({ evt: "review_trigger_failed", job: jobId }));
    return json({ error: "Could not start the review — try again." }, 502, cors);
  }

  // No applicant text and no identity in the log line.
  console.log(JSON.stringify({
    evt: "review_queued",
    job: jobId,
    kind: audit.kind === "specialist" ? `specialist:${audit.specialist}` : "lead",
    audit: audit.auditId ?? null,
    targets: audit.input.targets.length,
  }));
  return json(
    { status: "pending", jobId, pollAfterMs: POLL_AFTER_MS, expiresInMs: PENDING_DEADLINE_MS },
    202,
    cors,
  );
}

/**
 * GET /api/review?job=<uuid>
 *
 * 200 {"status":"pending"}                            still running
 * 200 {"status":"done","result":{kind,section}}       the validated section
 * 200 {"status":"error","error":"…"}                  the run failed; safe to show
 * 401                                                 no / expired session
 * 404 {"error":"…"}                                   unknown, expired, or not this user's job
 */
async function poll(req: Request, cors: Headers): Promise<Response> {
  const jobId = new URL(req.url).searchParams.get("job") ?? "";
  if (!UUID_RE.test(jobId)) return json({ error: "Missing or malformed 'job' id." }, 400, cors);

  if (!allowInMemory(`review:poll:${clientIp(req)}`, POLL_MAX, POLL_WINDOW_SEC)) {
    const headers = new Headers(cors);
    headers.set("Retry-After", String(POLL_WINDOW_SEC));
    return json({ error: "Too many requests — wait a minute and try again." }, 429, headers);
  }

  const who = await requireUser(req);
  if (!who.ok) return json({ error: who.error }, who.status, cors);

  let state;
  try {
    state = await getJob(jobId);
  } catch {
    return json({ error: "Could not reach the review store — try again." }, 502, cors);
  }
  // Absent, expired, and someone else's are the same answer: nothing to see.
  if (!state || state.uid !== who.caller.uid) {
    return json({ error: "That review has expired or was never started." }, 404, cors);
  }
  return json(clientView(state), 200, cors);
}
