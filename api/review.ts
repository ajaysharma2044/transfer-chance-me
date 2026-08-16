// POST /api/review — server-side proxy to the Anthropic Messages API.
//
// Why this exists: the static app's fallback mode has each user paste their
// own Anthropic key into the browser. This proxy lets the site owner hold ONE
// key server-side (ANTHROPIC_API_KEY env var) so visitors never handle keys.
// The key is read from process.env only and is never echoed to the client.
//
// Request body:  { "prompt": string }   (≤ MAX_PROMPT_CHARS)
// Response:      the raw Anthropic Messages API response JSON, so the
//                existing client parser (data.content[0].text) keeps working.
//
// Env vars:
//   ANTHROPIC_API_KEY  (required) — server-held Anthropic key.
//   ALLOWED_ORIGIN     (required in prod) — e.g. "https://transferchance.me".
//                      Requests whose Origin is present and different are 403'd.

import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_PROMPT_CHARS = 40_000; // whole prompt, all fields concatenated client-side
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 6000;

/* ── Per-IP rate limit: token bucket, in-memory ────────────────────────────
 * LIMITATION: Vercel serverless functions are ephemeral and may run as many
 * concurrent instances; this Map lives per-instance and resets on cold start.
 * It still stops naive hammering from one client hitting a warm instance, but
 * it is NOT a real global limit. For a hard guarantee, back this with
 * Upstash Redis (@upstash/ratelimit) or Vercel's WAF rate-limiting rules.
 */
const BUCKET_CAPACITY = 5; // burst
const REFILL_PER_SEC = 5 / 60; // 5 requests per minute sustained
const buckets = new Map<string, { tokens: number; last: number }>();

function allowRequest(ip: string): boolean {
  const now = Date.now() / 1000;
  const b = buckets.get(ip) ?? { tokens: BUCKET_CAPACITY, last: now };
  b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + (now - b.last) * REFILL_PER_SEC);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  // Keep the map from growing unboundedly on a long-lived instance.
  if (buckets.size > 10_000) buckets.clear();
  return true;
}

function clientIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  return (first ?? "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

/** Origin check + CORS headers. Returns false (and ends the response) on a
 * disallowed cross-site request. Same-origin requests send no Origin header
 * on some browsers, so an absent Origin is allowed. */
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
    // No ALLOWED_ORIGIN configured (e.g. preview deploys): reflect nothing
    // exotic — same-origin fetches don't need the header at all.
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is not configured (missing ANTHROPIC_API_KEY)." });
    return;
  }

  if (!allowRequest(clientIp(req))) {
    res.status(429).json({ error: "Too many requests — wait a minute and try again." });
    return;
  }

  // ── Validate body shape: exactly { prompt: string } within limits ──
  const body: unknown = req.body;
  if (typeof body !== "object" || body === null) {
    res.status(400).json({ error: "Body must be a JSON object." });
    return;
  }
  const prompt = (body as Record<string, unknown>).prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({ error: "Missing 'prompt' string." });
    return;
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    res.status(413).json({ error: `Prompt too long (max ${MAX_PROMPT_CHARS} characters).` });
    return;
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      // Pass through status but not upstream internals beyond the error type.
      const msg =
        (data as { error?: { message?: string } } | null)?.error?.message ??
        "Upstream request failed.";
      res.status(upstream.status === 429 ? 429 : 502).json({ error: msg });
      return;
    }
    res.status(200).json(data);
  } catch {
    res.status(502).json({ error: "Could not reach the review service." });
  }
}
