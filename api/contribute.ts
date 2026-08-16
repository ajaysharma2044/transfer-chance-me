// POST /api/contribute — OPT-IN dataset contributions.
//
// ⚠️ CONSENT CONTRACT: this endpoint must only ever be called from a UI flow
// where the user has ticked an explicit consent checkbox describing exactly
// what is shared and why. The frontend currently promises "your materials
// never leave your device" — that copy and a privacy policy MUST be updated
// before this endpoint is wired to any UI (see DEPLOY.md, "Data & consent").
// Any request without a literal `consent: true` is rejected outright.
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
// Storage: Upstash Redis via its REST API (no npm dependency needed) when
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set; otherwise 501.

import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_BODY_CHARS = 100_000;

/* ── PII scrub ── */

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

/* ── CORS (same policy as api/review.ts) ── */

function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const allowed = process.env.ALLOWED_ORIGIN ?? "";
  const origin = (req.headers.origin as string | undefined) ?? "";
  if (allowed) {
    if (origin && origin !== allowed) {
      res.status(403).json({ error: "Origin not allowed." });
      return false;
    }
    res.setHeader("Access-Control-Allow-Origin", allowed);
  } else if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Max-Age", "86400");
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!applyCors(req, res)) return;
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only." });
    return;
  }

  const body: unknown = req.body;
  if (typeof body !== "object" || body === null) {
    res.status(400).json({ error: "Body must be a JSON object." });
    return;
  }
  const b = body as Record<string, unknown>;

  // ── Hard consent gate: literal boolean true, nothing else counts ──
  if (b.consent !== true) {
    res.status(403).json({
      error:
        "Contributions require explicit consent. This endpoint only accepts requests where the user ticked the consent checkbox (consent: true).",
    });
    return;
  }

  if (typeof b.profile !== "object" || b.profile === null) {
    res.status(400).json({ error: "Missing 'profile' object." });
    return;
  }
  if (typeof b.materials !== "object" || b.materials === null) {
    res.status(400).json({ error: "Missing 'materials' object." });
    return;
  }
  if (b.outcomes !== undefined && (typeof b.outcomes !== "object" || b.outcomes === null)) {
    res.status(400).json({ error: "'outcomes' must be an object when present." });
    return;
  }
  if (JSON.stringify(b).length > MAX_BODY_CHARS) {
    res.status(413).json({ error: `Contribution too large (max ${MAX_BODY_CHARS} characters).` });
    return;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    res.status(501).json({
      error:
        "Contribution storage is not configured on this deployment. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable it.",
    });
    return;
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
    // Upstash REST: LPUSH contributions <json>  → single-command endpoint.
    const r = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(["LPUSH", "tcm:contributions", JSON.stringify(record)]),
    });
    if (!r.ok) {
      res.status(502).json({ error: "Storage backend rejected the write." });
      return;
    }
    res.status(200).json({ ok: true, message: "Contribution stored. Thank you." });
  } catch {
    res.status(502).json({ error: "Could not reach the storage backend." });
  }
}
