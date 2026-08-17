# Deploying to Netlify

Read this before deploying. There is one hard constraint that shapes the whole
design, and one decision you have to make that costs money.

---

## The constraint: a review takes ~104 seconds

Measured this session against the live backend, not estimated:

| | prompt tokens | output tokens | wall time | cost |
|---|---|---|---|---|
| Sonnet 4.5 | 3,994 | 4,681 | 104 s | $0.0822 |
| qwen3.7-plus (live) | 3,743 | 6,722 | 115 s | $0.0098 |

Netlify's synchronous function limit is **10 seconds** (26 s on the highest
plan). That is an order of magnitude short of every real review — while a
two-sentence test call passes happily, which is how this ships broken.

**Streaming does not rescue it.** That is our constraint, not the platform's:
`/api/review` validates the model's JSON before handing it back (`api/_guard.ts`),
because the client `JSON.parse`s it and maps over the arrays. Validation needs
the whole object, so there is nothing to send for the first ~104 s regardless.
A stream would be 104 seconds of silence, then one chunk — inside the same
execution limit.

A **background function** is the only Netlify runtime with a 15-minute budget.
A background function answers the caller `202` with an empty body, so it cannot
return the review. Hence the split:

```
POST /api/review            → validates, stores the prompt, fires the worker,
                              answers 202 { jobId }
        (worker)            → review-background.ts, runs as long as it needs,
                              writes the result to the job store
GET  /api/review?job=<id>   → pending | done | error
```

## The decision: this needs a job store

The two halves run in different invocations and share nothing, so the result
has to live somewhere between them. The port uses **Upstash Redis** over its
REST API.

That is a new third-party service holding student review text, and a new bill.
It is not installed:

```bash
npm i @upstash/redis
```

**You should weigh this against staying on Vercel.** Vercel Pro allows a 300 s
synchronous function, which fits the 104 s review with room to spare and needs
no job store, no polling, and no Redis. The Vercel handler in `api/review.ts`
already works this way — the only change needed there is raising `maxDuration`
from 60 to 300 (one line, and the comment sits at it). If you are paying for a
plan either way, Vercel Pro is the simpler and cheaper architecture for this
specific app. Netlify is the right answer if you want to stay on Netlify's free
tier and accept the Redis dependency.

---

## Environment variables (Netlify UI → Site configuration → Environment)

Server-side, never `VITE_` prefixed — Vite inlines every `VITE_` var into the
browser bundle, and `tests/no-secrets-in-bundle.test.ts` fails the build if a
key reaches `dist/`:

| Var | Required | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | The live backend. |
| `OPENROUTER_MODEL` | no | Defaults to `qwen/qwen3.7-plus`. |
| `ANTHROPIC_API_KEY` | no | Fallback when OpenRouter is absent. |
| `ALLOWED_ORIGIN` | **yes in prod** | e.g. `https://transferchance.me`. Without it any origin may call the endpoint. |
| `UPSTASH_REDIS_REST_URL` | yes | Job store. |
| `UPSTASH_REDIS_REST_TOKEN` | yes | Job store. |
| `PUBLIC_SITE_URL` | no | OpenRouter dashboard attribution only. |

Build-time, and these **must** be set as build environment variables or they
will not exist in the bundle:

| Var | Notes |
|---|---|
| `VITE_SUPABASE_URL` | Accounts. |
| `VITE_SUPABASE_ANON_KEY` | Safe to expose; row-level security is the protection. |
| `VITE_REVIEW_ENDPOINT` | Set to `/api/review`. **If unset the app silently falls back to asking each visitor for their own API key** — it will not error, it will just quietly be the wrong product. |

## Two CSPs, and you must pick one

`vite` copies `public/_headers` into `dist/`, and Netlify reads a `_headers`
file in the publish directory **as well as** `netlify.toml`. Those two files
carry different `Content-Security-Policy` values: the one in `_headers` allows
Supabase, the one in `netlify.toml` (copied verbatim from `vercel.json`) does
not.

This is not a tidiness problem. If the wrong one wins, `connect-src` blocks
`*.supabase.co` and **signed-in sync fails in production while working
perfectly in dev.** Before the first deploy, decide which file owns the CSP and
delete the policy from the other.

## The client change this requires

`src/lib/review.ts` does one `fetch` and one `await res.json()`. Against a
background function it must POST, then poll. Nothing else in `src/` changes.

In `runReview`, when `proxyMode` is on:

1. `POST` the prompt as today. Expect **202** with `{ jobId }` rather than 200
   with the review.
2. Poll `GET ${REVIEW_ENDPOINT}?job=${jobId}` every 2 s.
3. Treat `{ status: "pending" }` as keep-waiting, `{ status: "done", result }`
   as the response body that the existing parsing code already handles, and
   `{ status: "error", error }` as a thrown `Error(error)`.
4. Keep the existing `CLIENT_TIMEOUT_MS` (180 s) as the overall ceiling on the
   poll loop, and keep surfacing the server's own message on timeout.

The Anthropic-shaped response contract is unchanged — the worker stores exactly
what `api/review.ts` returns today, so `data.content[0].text` still works.

## Deploy

```bash
npm i -g netlify-cli   # once
netlify login
netlify init           # link the repo
netlify deploy --prod
```

## What is NOT verified

Stated plainly rather than implied:

- **None of `netlify/functions/` has ever run.** It type-checks and it is
  written against the documented runtime, but no request has gone through it.
  The Vercel handler is the one with a measured, working round trip.
- The background-function 15-minute budget, the 202 handshake and the polling
  contract are from Netlify's documentation, not from a deploy on this account.
- The job store code has never talked to a real Upstash instance.
- `netlify/functions/` is not covered by `tsconfig.api.json` (which scopes to
  `api/**`), so it is not in `npm run build`'s type pass. Add it to that
  `include` before relying on it.
- The CSP conflict above is a real, unresolved fork — it has not been decided.
