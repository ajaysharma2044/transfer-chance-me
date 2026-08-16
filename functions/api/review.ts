// POST /api/review — Cloudflare Pages Function.
// Server-side proxy to the Anthropic Messages API. Port of api/review.ts
// (Vercel) with identical request/response contracts, so src/lib/review.ts
// needs no change: it still POSTs { prompt } and still reads data.content[0].text.
//
// Why this exists: the fallback mode has each visitor paste their own Anthropic
// key into the browser. This proxy lets the site owner hold ONE key server-side
// so visitors never handle keys. The key is read from env only, is never echoed
// to the client, and is never logged.
//
// Env (Cloudflare Pages → Settings → Variables and Secrets → Production):
//   ANTHROPIC_API_KEY  (required)  server-held Anthropic key. NOT VITE_-prefixed.
//   ALLOWED_ORIGIN     (required in prod)  comma-separated allow-list.
//   RATE_LIMIT         (optional)  KV namespace binding; see _shared.ts.
//
// Missing ANTHROPIC_API_KEY is a clean 503, never a crash — the site keeps
// working in browser-key mode.

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

/**
 * Kept in lockstep with src/lib/review.ts (browser-key mode uses the same
 * model). Change BOTH or the two paths silently diverge in output and cost.
 */
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 6000;

/** Whole assembled prompt, matching the Vercel handler. */
const MAX_PROMPT_CHARS = 40_000;
/** Transport cap. JSON-escaping 40k chars of essay text can roughly double it. */
const MAX_BODY_BYTES = 128 * 1024;
/**
 * Below Cloudflare's ~100s edge timeout, so a slow upstream surfaces as our own
 * 504 with a usable message rather than an opaque Cloudflare 524 error page.
 */
const UPSTREAM_TIMEOUT_MS = 85_000;

export const onRequestOptions = ({ request, env }: EventContext<Env>): Response =>
  preflight(request, env);

export const onRequestPost = async ({ request, env }: EventContext<Env>): Promise<Response> => {
  const cors = corsHeaders(request, env);
  if (!cors) return json({ error: "Origin not allowed." }, 403);

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // 503 rather than 500: this deployment is simply not configured for proxy
    // mode. Deliberately does not name the variable back to the browser.
    return json({ error: "The review service is not configured on this deployment." }, 503, cors);
  }

  const limit = await allowRequest(`review:${clientIp(request)}`, env);
  if (!limit.ok) return tooManyRequests(limit, cors);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return json({ error: body.error }, body.status, cors);

  const prompt = (body.value as Record<string, unknown>).prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return json({ error: "Missing 'prompt' string." }, 400, cors);
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return json({ error: `Prompt too long (max ${MAX_PROMPT_CHARS} characters).` }, 413, cors);
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), UPSTREAM_TIMEOUT_MS);

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
      signal: abort.signal,
    });

    const data: unknown = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      // Never forward upstream headers or the outbound request (it carried the
      // key), and never surface a raw upstream message — Anthropic auth errors
      // can echo a key prefix. Map to a fixed set of safe, actionable strings.
      if (upstream.status === 429 || upstream.status === 529) {
        const headers = new Headers(cors);
        const retryAfter = upstream.headers.get("retry-after");
        if (retryAfter) headers.set("Retry-After", retryAfter);
        return json({ error: "The review service is busy — try again in a moment." }, 429, headers);
      }
      if (upstream.status === 401 || upstream.status === 403) {
        // Must NOT be a 401: src/lib/review.ts renders 401 as "That API key was
        // rejected. Check it in the key settings below." — nonsense in proxy
        // mode, where the visitor has no key. This is the owner's problem.
        return json({ error: "The review service rejected this deployment's credentials." }, 503, cors);
      }
      return json({ error: "The review service could not complete this request." }, 502, cors);
    }

    // Pass the Anthropic response through verbatim so the existing client
    // parser (data.content[0].text) keeps working unchanged.
    return json(data, 200, cors);
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return json(
      {
        error: aborted
          ? "The review took too long and was cancelled — try again, or shorten your materials."
          : "Could not reach the review service.",
      },
      aborted ? 504 : 502,
      cors,
    );
  } finally {
    clearTimeout(timer);
  }
};
