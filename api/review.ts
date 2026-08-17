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
// Two upstreams are supported. OpenRouter wins when its key is present,
// because it is the one that can be swapped between models without a deploy;
// Anthropic direct is the fallback. Either way the RESPONSE the client sees
// is Anthropic-shaped ({content:[{text}]}), so src/lib/review.ts and
// src/lib/panel.ts keep working untouched.
//
// Env vars (ALL server-side — never a VITE_ var, which would ship the key to
// every visitor's browser):
//   OPENROUTER_API_KEY (optional) — if set, requests go to OpenRouter.
//   OPENROUTER_MODEL   (optional) — defaults to anthropic/claude-sonnet-4.5.
//   ANTHROPIC_API_KEY  (used when OPENROUTER_API_KEY is absent).
//   ALLOWED_ORIGIN     (required in prod) — e.g. "https://transferchance.me".
//                      Requests whose Origin is present and different are 403'd.
//   PUBLIC_SITE_URL    (optional) — sent to OpenRouter as HTTP-Referer for
//                      its dashboard attribution.

import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_PROMPT_CHARS = 40_000; // whole prompt, all fields concatenated client-side
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 6000;
/** OpenRouter default. Overridable without a redeploy via OPENROUTER_MODEL. */
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5";

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

  // OpenRouter first when configured; Anthropic direct otherwise.
  const orKey = process.env.OPENROUTER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const apiKey = orKey ?? anthropicKey;
  const via: "openrouter" | "anthropic" = orKey ? "openrouter" : "anthropic";
  if (!apiKey) {
    res.status(500).json({
      error: "Server is not configured (set OPENROUTER_API_KEY or ANTHROPIC_API_KEY).",
    });
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

  const started = Date.now();
  try {
    const upstream =
      via === "openrouter"
        ? await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
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
              messages: [{ role: "user", content: prompt }],
            }),
          })
        : await fetch("https://api.anthropic.com/v1/messages", {
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
      logUsage(via, upstream.status, Date.now() - started, null);
      res.status(upstream.status === 429 ? 429 : 502).json({ error: msg });
      return;
    }

    // Normalise OpenRouter's OpenAI-shaped reply into the Anthropic shape the
    // client already parses, so neither review.ts nor panel.ts has to change.
    if (via === "openrouter") {
      const or = data as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      } | null;
      const text = or?.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        logUsage(via, 502, Date.now() - started, null);
        res.status(502).json({ error: "The review service returned an unreadable response." });
        return;
      }
      logUsage(via, 200, Date.now() - started, {
        in: or?.usage?.prompt_tokens ?? 0,
        out: or?.usage?.completion_tokens ?? 0,
      });
      res.status(200).json({ content: [{ type: "text", text }] });
      return;
    }

    const anth = data as { usage?: { input_tokens?: number; output_tokens?: number } } | null;
    logUsage(via, 200, Date.now() - started, {
      in: anth?.usage?.input_tokens ?? 0,
      out: anth?.usage?.output_tokens ?? 0,
    });
    res.status(200).json(data);
  } catch {
    logUsage(via, 502, Date.now() - started, null);
    res.status(502).json({ error: "Could not reach the review service." });
  }
}

/**
 * One structured line per call, to the function log.
 *
 * Deliberately carries NO prompt text and no user identity — this is the path
 * that handles student essays and transcripts, and a log line is the easiest
 * place for that content to leak somewhere it was never meant to live. Counts
 * and latency are enough to spot a cost spike or an upstream going bad.
 */
function logUsage(
  via: string,
  status: number,
  ms: number,
  tokens: { in: number; out: number } | null,
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
    }),
  );
}
