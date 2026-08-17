# Deploying to Netlify

Read this before deploying. One hard constraint shapes the whole design.


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

## The job store: Netlify Blobs, no extra vendor

The two halves run in different invocations and share nothing, so the prompt
and the result have to live somewhere between them. That store is **Netlify
Blobs** (`netlify/functions/_jobs.ts`) — built into the platform. No signup, no
second bill, and no third party holding student essays.

An earlier draft used Upstash Redis. That was the wrong call: it added a vendor
to solve a problem the host already solves. It is gone.

Two things Blobs does not give you, both handled in `_jobs.ts` and worth
knowing before you edit it:

- **No TTL.** Expiry is a timestamp written into each record and enforced on
  read, with opportunistic deletion. There is no sweeper, so an unread expired
  record lingers until something asks for it.
- **No atomic compare-and-set.** The Redis draft claimed a job with `SET NX`,
  so a replayed invocation could never buy the same review twice. The claim now
  is `takePrompt()`, which reads and deletes in one step. Two invocations that
  both read before either deletes would both proceed — a millisecond window,
  and the cost of losing that race is one duplicate model call (~$0.01), not
  corrupted data, since both write the same result to the same key.
- The same non-atomicity applies to the rate-limit counter. It makes hammering
  the paid endpoint expensive rather than free, which is its job. **Do not
  reuse `bump()` for a paid quota or a free-audit allowance** — those need an
  exact counter, and Postgres is already in this stack.

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
| `PUBLIC_SITE_URL` | no | OpenRouter dashboard attribution only. |

Build-time, and these **must** be set as build environment variables or they
will not exist in the bundle:

| Var | Notes |
|---|---|
| `VITE_SUPABASE_URL` | Accounts. |
| `VITE_SUPABASE_ANON_KEY` | Safe to expose; row-level security is the protection. |
| `VITE_REVIEW_ENDPOINT` | Set to `/api/review`. **If unset the app silently falls back to asking each visitor for their own API key** — it will not error, it will just quietly be the wrong product. |

## The CSP conflict — found and fixed

`vite` copies `public/_headers` into `dist/`, and Netlify reads a `_headers`
file in the publish directory **as well as** `netlify.toml`. Those two carried
different policies: `_headers` allowed Supabase, `netlify.toml` did not — and
neither did `vercel.json`.

That was a live bug on **both** hosts, not a tidiness problem. Whichever policy
won, `connect-src` would have blocked `*.supabase.co` and every auth and sync
call with it: **accounts broken in production, working perfectly in dev**, with
the only symptom a console violation nobody was watching.

All three files now carry the same origins, and `tests/csp.test.ts` fails the
build if they drift apart again or if any required origin goes missing.

## The client change — done

`src/lib/review.ts` now handles both hosts from one code path, and **the status
code is the discriminator**, so nothing has to be configured to match the
deployment:

- **200** — Vercel's synchronous answer. Parsed exactly as before.
- **202** — Netlify's queue. `pollForReview()` then polls
  `GET /api/review?job=<id>` until `done` or `error`, and hands the result back
  as a `Response` so the parsing below it never learns which host it is on.

Cadence and give-up time come from the server's own 202 (`pollAfterMs`,
`expiresInMs`) rather than being hard-coded, bounded by the client's own
`CLIENT_TIMEOUT_MS`. A transient 5xx on a single poll is retried; a 404 means
the job expired and is surfaced as such.

The Anthropic-shaped response contract is unchanged — the worker stores exactly
what `api/review.ts` returns, so `data.content[0].text` still works.

## Deploy

```bash
npm i -g netlify-cli   # once
netlify login
netlify init           # link the repo
netlify deploy --prod
```

## What is NOT verified

Stated plainly rather than implied:

- **None of `netlify/functions/` has ever run.** It type-checks under
  `tsconfig.netlify.json` and is written against the documented runtime, but no
  request has gone through it. The Vercel handler is the one with a measured,
  working round trip (104 s, $0.0098, valid JSON).
- The background-function 15-minute budget, the 202 handshake and the polling
  contract are from Netlify's documentation, not from a deploy on this account.
- The Blobs job store has never talked to a real Netlify Blobs instance. The
  expiry-on-read and claim-by-delete logic is unit-testable and untested.
- `netlify dev` has not been run. The first real exercise of this path will be
  the first deploy — expect to iterate once.
