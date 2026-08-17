// /api/contribute — Netlify port of the Vercel handler in api/contribute.ts.
//
// ⚠️ CONSENT CONTRACT (unchanged from the Vercel original): this endpoint must
// only ever be called from a UI flow where the user has ticked an explicit
// consent checkbox describing exactly what is shared and why. The frontend's
// signed-out copy promises the material never leaves the device — that copy and
// a privacy policy MUST be updated before this endpoint is wired to any UI.
// Any request without a literal `consent: true` is rejected outright.
//
// This one is a straight port: unlike /api/review it finishes in the time one
// Upstash write takes, so it stays a normal synchronous function and the client
// contract does not change.
//
// Request body:
//   {
//     consent: true,                    // required, literal boolean true
//     profile:   { ...profile fields }, // GPA, standing, major, credentials…
//     materials: { ...essay/statement/activities text },
//     outcomes?: { ...per-school results, optional }
//   }
//
// PII scrubbing: email addresses and phone numbers are stripped from every
// string before storage. This is a best-effort pattern scrub, not anonymity —
// essays are inherently identifying, which is why storage is opt-in only.
//
// Env vars (server-side only — never a VITE_ var, which Vite would inline into
// every visitor's browser bundle):
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN  storage; absent → 501.
//   ALLOWED_ORIGIN     required in prod. Comma-separated allow-list.
//
// The CORS, body-reading and rate-limit helpers are duplicated from
// netlify/functions/review.ts rather than shared. Netlify treats every file at
// the top level of the functions directory as a deployable function, so a
// `_shared.ts` here would be published as an endpoint of its own — the opposite
// of what the underscore means under api/ and functions/api/.

export const config = { path: "/api/contribute" };

/** Serialised record cap, matching api/contribute.ts exactly. */
const MAX_BODY_CHARS = 100_000;
/**
 * Transport cap, in bytes. Deliberately 4× the character cap: UTF-8's worst
 * case is 4 bytes per character, so this never fires before the record cap it
 * exists to protect — a contribution written in a non-Latin script gets the
 * same answer here as it does on Vercel.
 */
const MAX_BODY_BYTES = 4 * MAX_BODY_CHARS;

/* Not in the Vercel original, and a deliberate addition: this endpoint turns an
 * anonymous POST into an unbounded write to a store someone pays for. The
 * ceiling matches /api/review's, which is the other endpoint on this deployment
 * that a stranger can make cost money. */
const WRITE_MAX = 5;
const WRITE_WINDOW_SEC = 60;

/* ── PII scrub — identical patterns to api/contribute.ts ─────────────────── */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Phone-ish sequences: optional +country, separators, 7+ digits total.
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;

function scrubString(s: string): string {
  return s.replace(EMAIL_RE, "[email removed]").replace(PHONE_RE, "[phone removed]");
}

/** Recursively scrub every string value in a JSON-ish structure. */
function scrub(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v);
    return out;
  }
  return value;
}

/* ── Store (Upstash Redis REST) ─────────────────────────────────────────── */

interface Store {
  url: string;
  token: string;
}

function store(): Store | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

/** One Upstash REST command. Throws on transport or HTTP failure. */
async function redis(s: Store, command: (string | number)[]): Promise<unknown> {
  const r = await fetch(s.url, {
    method: "POST",
    headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
    body: JSON.stringify(command.map(String)),
  });
  if (!r.ok) throw new Error(`upstash ${r.status}`);
  const data = (await r.json()) as { result?: unknown };
  return data.result ?? null;
}

/* ── Rate limiting ──────────────────────────────────────────────────────────
 * Counted in Upstash so the limit is global rather than per-instance. A store
 * hiccup falls back to an in-memory counter — weaker, because Netlify runs many
 * instances, but it neither fails the request nor waves it through unmetered.
 */
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

/**
 * Fixed-window counter. EXPIRE is set only on the first hit of a window, so a
 * client cannot keep sliding its own window forward by hammering the endpoint.
 */
async function allowRequest(
  s: Store | null,
  key: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  if (!s) return allowInMemory(key, max, windowSec);
  try {
    const window = Math.floor(Date.now() / 1000 / windowSec);
    const k = `tcm:rl:${window}:${key}`;
    const used = Number(await redis(s, ["INCR", k]));
    if (used === 1) await redis(s, ["EXPIRE", k, windowSec * 2]);
    return used <= max;
  } catch {
    return allowInMemory(key, max, windowSec);
  }
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
 * no-store matters even on the acknowledgement: the request that produced it
 * carried a student's essays.
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
 * Same policy as netlify/functions/review.ts, including its one deliberate
 * difference from api/contribute.ts: when ALLOWED_ORIGIN is unset we emit no
 * Access-Control-Allow-Origin at all rather than reflecting whatever Origin
 * arrived. Same-origin fetches — all this app makes — never need the header, so
 * nothing breaks, but an unconfigured deployment no longer hands every site on
 * the internet browser-level permission to read responses from this endpoint.
 *
 * Stated plainly because it is easy to over-trust: an Origin check is a
 * browser-side guard, not authentication. curl can omit or forge Origin at will.
 */
function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function corsHeaders(req: Request): Headers | null {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
 * must pass preflight, which the origin allow-list above then answers. That
 * matters more here than on /api/review: this endpoint writes.
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

export default async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req);
  if (!cors) return json({ error: "Origin not allowed." }, 403);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST only." }, 405, cors);

  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body.ok) return json({ error: body.error }, body.status, cors);
  const b = body.value;

  /* ── Hard consent gate: literal boolean true, nothing else counts ──
   * First, before the size checks and before the rate limit touches the store,
   * so a request that was never allowed to be here costs nothing and leaves no
   * trace of itself anywhere. */
  if (b.consent !== true) {
    return json(
      {
        error:
          "Contributions require explicit consent. This endpoint only accepts requests where the user ticked the consent checkbox (consent: true).",
      },
      403,
      cors,
    );
  }

  if (typeof b.profile !== "object" || b.profile === null) {
    return json({ error: "Missing 'profile' object." }, 400, cors);
  }
  if (typeof b.materials !== "object" || b.materials === null) {
    return json({ error: "Missing 'materials' object." }, 400, cors);
  }
  if (b.outcomes !== undefined && (typeof b.outcomes !== "object" || b.outcomes === null)) {
    return json({ error: "'outcomes' must be an object when present." }, 400, cors);
  }
  if (JSON.stringify(b).length > MAX_BODY_CHARS) {
    return json({ error: `Contribution too large (max ${MAX_BODY_CHARS} characters).` }, 413, cors);
  }

  const s = store();
  if (!s) {
    return json(
      {
        error:
          "Contribution storage is not configured on this deployment. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable it.",
      },
      501,
      cors,
    );
  }

  if (!(await allowRequest(s, `contribute:${clientIp(req)}`, WRITE_MAX, WRITE_WINDOW_SEC))) {
    const headers = new Headers(cors);
    headers.set("Retry-After", String(WRITE_WINDOW_SEC));
    return json({ error: "Too many requests — wait a minute and try again." }, 429, headers);
  }

  // Scrub PII, then store. Note: no IP address, no user identifier — the
  // record is only what the user chose to share, minus scrubbed patterns.
  const record = scrub({
    profile: b.profile,
    materials: b.materials,
    outcomes: b.outcomes ?? null,
    contributedAt: new Date().toISOString(),
  });

  try {
    await redis(s, ["LPUSH", "tcm:contributions", JSON.stringify(record)]);
  } catch (e) {
    /* The Vercel original tells these two apart and so does this: "rejected"
     * sends you to the Upstash dashboard (wrong token, quota, wrong URL),
     * "could not reach" sends you to the network. Collapsing them into one
     * message costs the reader the first hour of the investigation. */
    const rejected = e instanceof Error && e.message.startsWith("upstash ");
    return json(
      { error: rejected ? "Storage backend rejected the write." : "Could not reach the storage backend." },
      502,
      cors,
    );
  }

  // A size, never a sample. This is the one endpoint whose payload is entirely
  // student writing, and a log line is the easiest place for that to end up
  // somewhere it was never meant to live.
  console.log(JSON.stringify({ evt: "contribution_stored", chars: JSON.stringify(record).length }));
  return json({ ok: true, message: "Contribution stored. Thank you." }, 200, cors);
}
