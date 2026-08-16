// POST /api/contribute — OPT-IN dataset contributions. Cloudflare Pages Function.
// Port of api/contribute.ts (Vercel), with Supabase added as the preferred store.
//
// ⚠️ CONSENT CONTRACT — unchanged and non-negotiable: this endpoint may only be
// called from a UI flow where the user ticked an explicit consent checkbox
// describing exactly what is shared and why. Any request without a literal
// `consent: true` is rejected outright. No such UI exists yet. Before wiring one
// up, the "nothing leaves your browser" strings listed in DEPLOY.md §4 must be
// corrected and a privacy policy published — those strings become FALSE the
// moment this endpoint is reachable from the app.
//
// PII scrubbing here is best-effort pattern removal (emails, phone numbers), NOT
// anonymisation. An essay identifies its author by construction. That is exactly
// why storage is opt-in, and why the store is locked to service_role.
//
// Storage, in precedence order:
//   1. Supabase  — SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (see CLOUDFLARE.md
//                  for the table DDL; RLS on, zero policies, service_role only)
//   2. Upstash   — UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (legacy)
//   3. Neither   — 501, exactly as the Vercel handler did.

import {
  type Env,
  type EventContext,
  allowRequest,
  clientIp,
  corsHeaders,
  json,
  preflight,
  readJsonBody,
  tooManyRequests,
} from "./_shared";

const MAX_BODY_BYTES = 100_000;
/** Guards the recursive scrub against a hostile deeply-nested payload. */
const MAX_DEPTH = 64;

/* ── PII scrub ──────────────────────────────────────────────────────────── */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Phone-ish sequences: optional +country, separators, 7+ digits total.
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;

function scrubString(s: string): string {
  return s.replace(EMAIL_RE, "[email removed]").replace(PHONE_RE, "[phone removed]");
}

/** Recursively scrub every string value in a JSON-ish structure. */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, depth + 1);
    return out;
  }
  return value;
}

/* ── Storage backends ───────────────────────────────────────────────────── */

async function storeInSupabase(env: Env, record: unknown, consentVersion: string | null): Promise<boolean> {
  const base = (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${base}/rest/v1/contributions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: key,
      authorization: `Bearer ${key}`,
      prefer: "return=minimal",
    },
    body: JSON.stringify([{ payload: record, consent_version: consentVersion }]),
  });
  return res.ok;
}

async function storeInUpstash(env: Env, record: unknown): Promise<boolean> {
  const res = await fetch(env.UPSTASH_REDIS_REST_URL!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN!}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(["LPUSH", "tcm:contributions", JSON.stringify(record)]),
  });
  return res.ok;
}

/* ── Handler ────────────────────────────────────────────────────────────── */

export const onRequestOptions = ({ request, env }: EventContext<Env>): Response =>
  preflight(request, env);

export const onRequestPost = async ({ request, env }: EventContext<Env>): Promise<Response> => {
  const cors = corsHeaders(request, env);
  if (!cors) return json({ error: "Origin not allowed." }, 403);

  // The Vercel handler had no rate limit here. An unauthenticated endpoint that
  // writes to your database needs one more than the read-only proxy does.
  const limit = await allowRequest(`contribute:${clientIp(request)}`, env);
  if (!limit.ok) return tooManyRequests(limit, cors);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return json({ error: body.error }, body.status, cors);
  const b = body.value as Record<string, unknown>;

  // ── Hard consent gate: literal boolean true, nothing else counts ──
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

  const consentVersion = typeof b.consentVersion === "string" ? b.consentVersion.slice(0, 64) : null;

  // Scrub PII, then store. Note: no IP address, no user identifier — the record
  // is only what the user chose to share, minus scrubbed patterns. See
  // CLOUDFLARE.md → "Consent is not yet revocable" for why that is a tradeoff
  // and not simply a win.
  const record = scrub({
    profile: b.profile,
    materials: b.materials,
    outcomes: b.outcomes ?? null,
    consentVersion,
    contributedAt: new Date().toISOString(),
  });

  const hasSupabase = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  const hasUpstash = Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);

  if (!hasSupabase && !hasUpstash) {
    return json(
      {
        error:
          "Contribution storage is not configured on this deployment. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (preferred), or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, to enable it.",
      },
      501,
      cors,
    );
  }

  try {
    const stored = hasSupabase
      ? await storeInSupabase(env, record, consentVersion)
      : await storeInUpstash(env, record);

    // The upstream body may quote the row (and therefore the essay) back at us;
    // never forward it. `prefer: return=minimal` also keeps it empty.
    if (!stored) return json({ error: "Storage backend rejected the write." }, 502, cors);
    return json({ ok: true, message: "Contribution stored. Thank you." }, 200, cors);
  } catch {
    return json({ error: "Could not reach the storage backend." }, 502, cors);
  }
};
