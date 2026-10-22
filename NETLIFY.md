# Deploying to Netlify

Netlify is the host for the whole product: the static app **and** the deep-audit
proxy. (Vercel and Cloudflare can serve the static app and `/api/contribute`
only — see `DEPLOY.md` / `CLOUDFLARE.md`.) Read this before deploying; two
constraints shape the design and one blocker still stands.

---

## The contract: structured request → 202 → poll (docs/spec.md §5)

The browser never sends a prompt. `src/lib/panel.ts` builds a typed
`AuditRequest` (`src/lib/audit/schema.ts`) per section — four specialists in
parallel, then the lead with their reports — and the server authors the brief:

```
POST /api/review            netlify/functions/review.ts
                            verifies the Supabase session (Authorization: Bearer),
                            parses the AuditRequest (size caps, ≤ MAX_INCLUDED_TARGETS),
                            stores it under the caller's uid, fires the worker,
                            answers 202 { status, jobId, pollAfterMs, expiresInMs }
        (worker)            netlify/functions/review-background.ts
                            claims the job (Blobs conditional write — one run per job),
                            builds the prompt (src/lib/audit/prompts.ts) with the
                            applicant's writing in ONE fenced block (api/_guard.ts),
                            calls the model through the cost ledger, validates the
                            reply for that section kind, retries the shape once,
                            stores only the picked fields
GET  /api/review?job=<id>   pending | done { kind, section } | error — owner only;
                            anyone else gets 404
```

Why two halves: a synchronous Netlify function gets 10 seconds (26 at most); a
background function gets 15 minutes but answers the caller 202 with an empty
body, so the result has to travel through a store. The store is **Netlify
Blobs** (`netlify/functions/_jobs.ts`): built in, no second vendor holding
student essays. Expiry is a timestamp enforced on read (Blobs has no TTL); the
request record — the applicant's text — is deleted when the worker claims it,
the finished section stays readable for an hour.

Odds never come from the model. The prompt carries the engine's numbers and
asks for grades, notes and actions; `validateSection` has no odds field to
accept.

## Measured on this contract (2026-10-22, local `netlify dev`, OpenRouter `qwen/qwen3.7-plus`, reasoning disabled)

| section | in | out | wall | cost (provider-reported) |
|---|---|---|---|---|
| specialist ×4 (parallel) | ~1.5k | 616–883 | 12–16 s | $0.0013–0.0016 each |
| lead | 1.7k | 406 | 8 s | $0.0011 |
| **whole panel** | | | **< 20 s** | **$0.0067** |

The first live run, before two fixes, looked very different and both fixes are
load-bearing:

- **Output caps.** With `reasoning` left on, the model's hidden deliberation
  counted against `max_tokens`: a specialist hit the 4,000-token cap exactly,
  the JSON was truncated, validation failed, the retry spent again (109 s,
  6,660 output tokens). `_llm.ts` now sends `reasoning: { enabled: false }` and
  `SECTION_MAX_TOKENS` has headroom (8,000 / 6,000).
- **The ledger file.** It was a JSON snapshot rewritten on every operation; the
  four worker processes raced, three reservations vanished, and `settle()`
  threw for calls that had already succeeded — three sections lost, money spent
  and unrecorded. It is now an append-only event log (`ledger.jsonl`, see
  `_ledger.ts`).

## Environment variables (Site configuration → Environment)

Server-side, never `VITE_` prefixed (Vite inlines every `VITE_` var into the
browser bundle; `tests/no-secrets-in-bundle.test.ts` fails the build if a key
reaches `dist/`):

| Var | Required | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | The live backend. |
| `OPENROUTER_MODEL` | no | Defaults to `qwen/qwen3.7-plus`. Add its price to `config/budgets.ts` or the ledger reserves at the conservative default and refuses sooner than it should. |
| `ANTHROPIC_API_KEY` | no | Fallback when OpenRouter is absent (`anthropicProvider`). |
| `SUPABASE_URL` | yes | Session verification (`_auth.ts` asks `/auth/v1/user`). Falls back to `VITE_SUPABASE_URL`. |
| `ALLOWED_ORIGIN` | **yes in prod** | Comma-separated. Must include the site's own origin: browsers send `Origin` on same-origin POSTs, and an origin not on the list is a 403. The project's value is injected into `netlify dev` too — override it locally (see below). |
| `PUBLIC_SITE_URL` | no | OpenRouter dashboard attribution only. |

Build-time, and these **must** exist at build or they are not in the bundle:

| Var | Notes |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Accounts. The anon key is public by design; RLS is the protection. `_auth.ts` also reads the anon key server-side, so the variable must be available to functions, not scoped to builds only. |
| `VITE_REVIEW_ENDPOINT` | `/api/review` → proxy mode (the deep audit runs on the user's account through these functions). **This is set in the project today**, so a deploy of `main` ships proxy mode. Unset → browser-key mode. |

## The blocker before a production deploy of this contract

The cost ledger lives at `DATA_DIR/derived/ledger.jsonl` (`config/paths.ts`).
On Netlify that path does not exist and is not writable, so `reserve()` throws
before dispatch and **every audit fails safe with "Could not reach the review
service"**. That is the correct failure mode for an unaccounted paid call, and
it means the deep audit cannot run in production until the spend ledger moves
to Postgres (the `spend_ledger` table under RLS, atomic reserve/settle) or an
equivalent durable store. `docs/progress.md` tracks it.

Also known: the per-IP/per-user `bump()` counter in Blobs is not atomic (fine
for a rate limit, never for a paid quota), and the auth cache accepts a revoked
token for up to 60 s on read-only polls.

## Local full-stack dev

```bash
npm run dev -- --port 5200     # the SPA, proxying /api → :8888 (vite.config.ts)
npm run dev:full               # netlify dev on :8888 — functions + Blobs sandbox
```

Set `VITE_REVIEW_ENDPOINT=/api/review` in the environment of the Vite process
to exercise proxy mode locally (`.env.local` or the shell). `netlify dev` reads
`.env.local` for the function env.

Three quirks, encoded in `package.json` and `netlify.toml`:

- **Git worktrees.** `netlify-cli` finds the repository root by walking up to
  the first `.git` *directory*; in a worktree `.git` is a file, so it lands on
  the main checkout and bundles **its** functions — stale code with no error.
  `dev:full` therefore runs `netlify dev --cwd "$PWD"` from outside the
  directory, which makes the CLI treat the worktree as the base.
- **Its own Vite.** `netlify dev` starts a framework server and waits for it on
  `targetPort`. `vite.config.ts` defaults `npm run dev` to 5199 (the documented
  app port), so `netlify.toml` `[dev]` pins netlify dev's Vite to 5173 with
  `--strictPort`; without that it binds 5199 and the CLI times out waiting on
  5173.
- **ALLOWED_ORIGIN.** The project setting is injected into `netlify dev`; the
  function allows the request's own origin (so 8888 works), but
  `http://localhost:5200` must be allowed explicitly: export
  `ALLOWED_ORIGIN=http://localhost:5200,http://localhost:8888` in the shell
  that starts `dev:full` (process env wins over project settings).

Blobs runs in sandbox mode locally (`.netlify/blobs-serve`, gitignored); the
conditional-write claim works there.

## CSP

`netlify.toml`, `public/_headers` and `vercel.json` carry the same policy and
`tests/csp.test.ts` fails the build if they drift. Proxy mode is same-origin;
browser-key mode still needs `https://api.anthropic.com` in `connect-src`.

## Deploy

```bash
npm i -g netlify-cli   # once
netlify login
netlify init           # link the repo
netlify deploy --prod
```

## What is verified, and what is not

- Verified locally under `netlify dev` with the real Supabase project and the
  real OpenRouter backend: session gate (401 without a token, 401 on a bad
  token), 202 handshake, polling, owner-only poll, the worker's claim, prompt
  build, model call through the ledger, per-section validation and retry, and
  the full five-call panel rendering in the browser (two runs; the numbers
  above are the second).
- **Not** verified: a Netlify deploy of this branch. The background-function
  budget, Blobs in production, and the function env scopes come from the
  documentation and the project settings, not from a deploy — and the ledger
  blocker above means the deep audit would fail safe on one anyway.
