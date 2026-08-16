// Shared helpers for the Cloudflare Pages Functions in functions/api/.
//
// ROUTING: Pages only creates a route for a module that exports an `onRequest*`
// handler. This module exports none, so it is never reachable over HTTP — it
// exists purely to be imported by review.ts and contribute.ts.
//
// TYPES: the Cloudflare types below are declared locally on purpose, so that
// functions/ needs no extra npm dependency and `npm run build` (tsc -b + vite
// build) is completely unaffected — tsconfig.app.json only includes `src`, and
// Wrangler bundles functions/ with esbuild, which strips types without checking
// them. See CLOUDFLARE.md → "Optional: type-checking functions/" if you want
// real type-checking with @cloudflare/workers-types.

/* ── Minimal Cloudflare runtime types ───────────────────────────────────── */

/** The slice of Cloudflare's KVNamespace this code actually uses. */
export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Cloudflare Pages Functions handler context. */
export interface EventContext<E, P extends string = string, D = Record<string, unknown>> {
  request: Request;
  env: E;
  params: Record<P, string | string[]>;
  data: D;
  functionPath: string;
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
}

export type PagesFunction<E> = (context: EventContext<E>) => Response | Promise<Response>;

/* ── Environment bindings ───────────────────────────────────────────────────
 * Every field is optional on purpose. Hard constraint: the site must work with
 * zero cloud config, so a missing binding must degrade to a clean, explanatory
 * response — never an unhandled exception.
 *
 * NONE of these may ever be given a VITE_ prefix. Vite inlines `VITE_*` into the
 * public JS bundle; these are read only inside the Worker, at runtime.
 */
export interface Env {
  /** Server-held Anthropic key (sk-ant-…). Powers POST /api/review. */
  ANTHROPIC_API_KEY?: string;

  /**
   * Allow-listed browser origin(s), comma-separated, no trailing slash.
   * e.g. "https://transferchance.me,https://transfer-chance-me.pages.dev"
   */
  ALLOWED_ORIGIN?: string;

  /** Supabase project URL — the server-side copy (no VITE_ prefix). */
  SUPABASE_URL?: string;
  /** Supabase service_role key. Server only. Bypasses RLS — never expose. */
  SUPABASE_SERVICE_ROLE_KEY?: string;

  /** Legacy contribution store, kept for parity with the Vercel handler. */
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;

  /** Optional KV namespace binding; upgrades the rate limit beyond per-isolate. */
  RATE_LIMIT?: KVNamespaceLike;
}

/* ── Responses ──────────────────────────────────────────────────────────── */

/**
 * JSON response with hardening headers set here rather than relying on
 * `_headers` — Cloudflare's `_headers` file governs static assets, and its
 * application to Functions responses is not something to depend on.
 * `no-store` matters: these bodies can contain a user's essay text.
 */
export function json(body: unknown, status: number, headers?: Headers): Response {
  const h = new Headers(headers ?? undefined);
  h.set("content-type", "application/json; charset=utf-8");
  h.set("cache-control", "no-store");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  return new Response(JSON.stringify(body), { status, headers: h });
}

/* ── CORS / origin allow-listing ────────────────────────────────────────────
 * IMPORTANT, and stated plainly because it is easy to over-trust: an Origin
 * check is a browser-side guard, not authentication. CORS is enforced by
 * browsers; curl and server-side callers can omit or forge Origin freely. This
 * raises the bar against casual embedding of your endpoint on another site; it
 * does NOT stop someone determined from spending your Anthropic credit. The
 * real controls are the rate limit below, Cloudflare WAF/Turnstile in front of
 * /api/*, and (best) requiring a verified Supabase session JWT.
 */

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGIN ?? "").split(",").map(normalizeOrigin).filter(Boolean);
}

/**
 * Build CORS headers for this request, or return null when the request's Origin
 * is present and not allow-listed (caller should answer 403).
 *
 * Deliberate difference from the Vercel handler: when ALLOWED_ORIGIN is unset we
 * now emit NO Access-Control-Allow-Origin at all, instead of reflecting whatever
 * Origin arrived. Same-origin fetches (which is all this app makes) never need
 * the header, so the app is unaffected — but an unconfigured deployment no
 * longer hands every website on the internet browser-level permission to read
 * responses from your key-bearing proxy.
 */
export function corsHeaders(request: Request, env: Env): Headers | null {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  });

  const allowed = allowedOrigins(env);
  const origin = request.headers.get("origin");
  if (!origin) return headers; // same-origin / non-browser: nothing to grant

  if (allowed.length === 0) return headers; // unconfigured: grant nothing
  if (!allowed.includes(normalizeOrigin(origin))) return null; // → 403

  headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

/** Preflight handler shared by both endpoints. */
export function preflight(request: Request, env: Env): Response {
  const cors = corsHeaders(request, env);
  if (!cors) return json({ error: "Origin not allowed." }, 403);
  return new Response(null, { status: 204, headers: cors });
}

/* ── Client identity ────────────────────────────────────────────────────── */

/**
 * CF-Connecting-IP is written by Cloudflare's edge and overwrites anything the
 * client sent, so it is trustworthy in production. X-Forwarded-For is NOT —
 * it is only consulted as a convenience under local `wrangler pages dev`, where
 * CF-Connecting-IP is absent. In production that branch is unreachable, so a
 * forged X-Forwarded-For cannot be used to dodge the rate limit.
 */
export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const fwd = request.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "unknown";
}

/* ── Rate limiting ──────────────────────────────────────────────────────────
 * Two tiers, chosen automatically:
 *
 *   1. No RATE_LIMIT binding → in-memory token bucket, scoped to one Worker
 *      isolate. Cloudflare runs many isolates across many colos and recycles
 *      them freely, so the effective global limit is (limit × live isolates).
 *      This is WEAKER than the equivalent Vercel version, not stronger — treat
 *      it as protection against a single client hammering one colo, nothing more.
 *
 *   2. RATE_LIMIT KV binding present → fixed-window counter in Workers KV.
 *      Global, but eventually consistent: a burst arriving in different colos
 *      within the replication window can overshoot. KV also permits only ~1
 *      write/sec per key, which is above this endpoint's legitimate rate.
 *
 * For a hard guarantee use Cloudflare WAF rate-limiting rules on /api/* (a
 * dashboard setting, no code) or a Durable Object. See CLOUDFLARE.md.
 */

const BURST = 5; // requests available instantly
const WINDOW_SEC = 60; // sustained: BURST per WINDOW_SEC
const REFILL_PER_SEC = BURST / WINDOW_SEC;

const buckets = new Map<string, { tokens: number; last: number }>();

export interface RateLimitResult {
  ok: boolean;
  retryAfter: number;
}

function allowInMemory(key: string): RateLimitResult {
  // Note: Workers freeze Date.now() between I/O operations, so this reads the
  // same value throughout a request. That is fine — we take one token per
  // request, and the clock advances between requests.
  const now = Date.now() / 1000;
  const b = buckets.get(key) ?? { tokens: BURST, last: now };
  b.tokens = Math.min(BURST, b.tokens + (now - b.last) * REFILL_PER_SEC);
  b.last = now;

  if (b.tokens < 1) {
    buckets.set(key, b);
    return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / REFILL_PER_SEC) };
  }

  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) buckets.clear(); // bound isolate memory
  return { ok: true, retryAfter: 0 };
}

async function allowViaKv(key: string, kv: KVNamespaceLike): Promise<RateLimitResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const window = Math.floor(nowSec / WINDOW_SEC);
  const retryAfter = WINDOW_SEC - (nowSec % WINDOW_SEC);
  const k = `rl:${window}:${key}`;

  const used = Number((await kv.get(k)) ?? "0") || 0;
  if (used >= BURST) return { ok: false, retryAfter };

  // expirationTtl has a 60s floor in Workers KV; 2 windows is the safe value.
  await kv.put(k, String(used + 1), { expirationTtl: WINDOW_SEC * 2 });
  return { ok: true, retryAfter: 0 };
}

export async function allowRequest(key: string, env: Env): Promise<RateLimitResult> {
  if (!env.RATE_LIMIT) return allowInMemory(key);
  try {
    return await allowViaKv(key, env.RATE_LIMIT);
  } catch {
    // KV hiccup must not take the endpoint down — fall back to the local bucket.
    return allowInMemory(key);
  }
}

export function tooManyRequests(result: RateLimitResult, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("Retry-After", String(Math.max(1, result.retryAfter)));
  return json({ error: "Too many requests — wait a minute and try again." }, 429, headers);
}

/* ── Request body: size cap + parse ─────────────────────────────────────── */

export type BodyResult =
  | { ok: true; value: unknown; raw: string }
  | { ok: false; status: number; error: string };

/**
 * Read and parse a JSON body under a hard size cap.
 *
 * Requiring `content-type: application/json` is also a CSRF control: it is not
 * a CORS-"simple" content type, so a cross-origin browser request carrying it
 * must pass preflight — which the origin allow-list above then answers.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, status: 415, error: "Expected content-type: application/json." };
  }

  // Cheap pre-check: reject an oversized body before reading a byte of it.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: `Request too large (max ${maxBytes} bytes).` };
  }

  let raw: string;
  try {
    raw = await request.text();
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
  return { ok: true, value, raw };
}
