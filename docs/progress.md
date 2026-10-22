# Progress — read this first

Living status. **New session: read this, then `docs/spec.md` (current execution reference, 17 Oct 2026), then `docs/repo-audit.md` (finding-by-finding reconciliation). `docs/spec_v3.md` PART 8 still records the authorized paid-budget split; `docs/spec_v2.md` is the first brief + early implementation log.**
Last updated: 2026-10-22.

## Budget (OpenRouter + Anthropic aggregate)
- Cap: **$25 total**, **$1 per audit**, **stop after 3 real full audits** (spec_v3 PART 8 split: extraction ≤ $3 · tagging ≤ $4 · 3 audits ≤ $3 + retries · ~$15 reserve, owner approval to spend).
- Spent to date ≈ **$0.042**: run 1 (2026-10-22) ≈ $0.035 — $0.0164 recorded in the old `ledger.json` snapshot plus ~$0.018 for three successful specialist calls the old snapshot-rewrite ledger LOST in a write race (estimated from the recorded calls of the same run); run 2 $0.0067 (one group of 5 calls, all first-attempt); smoke calls $0.00005. Remaining ≈ $24.96.
- Real full audits used **2 / 3** (groups `e2fbab45…` and `df37758f…`). One more is authorized without asking.
- Ledger: `DATA_DIR/derived/ledger.jsonl` — an **append-only event log** since 2026-10-22 (`netlify/functions/_ledger.ts`); the older `ledger.json` snapshot beside it seeds the state and is never rewritten. Every model call (`_llm.ts`) reserves before dispatch; the review worker goes through it; five calls of one panel run share a `group`.
- External-model inputs exclude author_id, usernames, URLs, post ids (PART 8 §4).

## Environment / stack
- `.env.local` in the worktree, gitignored. Set: Supabase URL/anon/service, `SUPABASE_URL`, `OPENROUTER_API_KEY`/`MODEL`. `VITE_REVIEW_ENDPOINT` is **not** in the file; the 5200 dev server was started with it in the shell (`VITE_REVIEW_ENDPOINT=/api/review`) → proxy mode locally.
- **The linked Netlify project's settings inject `VITE_REVIEW_ENDPOINT`, `ALLOWED_ORIGIN` and `PUBLIC_SITE_URL`** (seen in `netlify dev` logs) — i.e. **production is in proxy mode**, so a deploy of `main` ships whatever `/api/review` is on `main`. Today that is the retired `{prompt}` contract the current client no longer speaks; after merging this branch it is the typed contract, which fails safe in production until the spend ledger moves off the local file (see blockers).
- Supabase project `nikfuakdulqmumsaisnn` resolves today. **Free tier auto-pauses after ~7 idle days** (drops from DNS; happened 2026-10-07). Check `nslookup nikfuakdulqmumsaisnn.supabase.co 1.1.1.1` before live tests; owner restores from the dashboard.
- Local full stack: `npm run dev -- --port 5200` (app; `/api/*` proxied to 8888) + `npm run dev:full` (netlify dev on 8888). **Worktree quirk:** netlify-cli resolves the repo root to the first `.git` *directory* — the MAIN checkout — and bundles its stale functions; `dev:full` now runs `netlify dev --cwd` from outside the directory. Export `ALLOWED_ORIGIN=http://localhost:5200,http://localhost:8888` in that shell or the injected production allow-list 403s the browser. Both servers are running as of this update.
- Scripts run with **`tsx`**. Baseline: `npm run verify` ✅ (build 1,379 kB / 417 kB gzip configured) · **341/341 tests, 28 files** · netlify typecheck ✅ · lint clean.
- CI: `.github/workflows/ci.yml` (npm ci → `npm run verify` → bundle secret grep) — added 2026-10-22, first run happens on the first push.

## State at 2026-10-22 → next action
- **Stage A done and browser-verified** (2026-10-17, real Supabase account): fresh account reads **Confirm**, not Ready, with the 3.8/CS/junior defaults; a GPA edit confirms only GPA; confirm-all → **Ready** while step 3 stays **Locked** with zero targets; adding Cornell unlocks step 3 and the review lists only Cornell; the list survives a reload.
- **Stage B done and verified end to end locally** (2026-10-22, real Supabase session + real OpenRouter): 401 without a session / on a bad token; 202 handshake; polling; owner-only poll; worker claim; server-built prompt with one fenced block; model call through the ledger; per-section validation + one retry; the full five-call panel rendered in the browser. Run 1 exposed two defects fixed the same day — the ledger snapshot race (now an event log) and hidden reasoning blowing the output cap (now `reasoning: {enabled:false}` + larger caps) — run 2 was clean: 5/5 first-attempt, < 20 s, $0.0067.
- **Also fixed 2026-10-22 (D1, in-memory half):** after `clearUserLocalState()` the Portal list / Review drafts stayed in React state and were written back under the next account (reproduced live: account B showed and then re-persisted account A's Cornell). The clears now broadcast (`listEvents.ts` `USER_DATA_CLEARED_EVENT`); Portal and Review reload from storage; Portal also follows Review's `included` toggles.
- Legacy path retired: `runReview`/`buildPrompt`/`loadLastReview`, `validateReview`/`parseReviewJson`, Vercel `api/review.ts`, Cloudflare `functions/api/review.ts`; docs updated (NETLIFY.md rewritten with measured numbers; DEPLOY/CLOUDFLARE/SECURITY/README/.ai-codex).
- **Next:** commit in three commits (Stage A · Stage B + ledger · CI/docs), push the branch, open the PR with the verification record; then Stage C (Netlify ports of account deletion/admin, Supabase `spend_ledger`, history), Stage E (TAG 95%, estimated-median fallback), Stage I (CSP single source, bundle).

## Stage matrix (spec.md §14 order)
Legend: ✅ verified · 🟡 partial / integration pending · ⬜ pending · ⛔ blocked (owner)

| Stage | Status | Notes |
|---|---|---|
| **A** Baseline, completeness, shared targets, regression tests | ✅ | browser-verified 2026-10-17; `profileReadiness`, `Profile.confirmed`, `src/lib/targets.ts`, `config/product.ts` |
| **B** Typed server-built audit contract, auth'd jobs, atomic claims | ✅ local | E2E under `netlify dev` ×2; **production needs the Supabase spend ledger first** |
| **C** Snapshots/sync/history, Netlify route parity, deletion lifecycle | 🟡 | D1 (storage + in-memory) and D14 fixed; deletion/admin Netlify port ⬜; history ⬜; `spend_ledger` table ⬜ |
| **D** Upload confirmation, formats | ⬜ | PDF/TXT only today |
| **E** School registry, odds/guarantee honesty | 🟡 | 3.95 invented median fixed; TAG 95% ⬜; tiers-when-unknown ⬜; model-set odds retired ✅ |
| **F** Corpus pipeline, comparables | ⬜ | DATA_DIR present; reconciliation not started |
| **G** Audit quality, progressive UI, export | ⬜ | |
| **H** Stripe test mode, entitlements, abuse controls | ⬜ | |
| **I** E2E, ops, perf, release candidate | 🟡 | CI workflow added; CSP dual files; 417 kB gzip baseline |

## Earlier fixed defects (pre-v4, all with tests)
Odds compression · privacy copy (`privacy.ts`) · profile "Fill in" (presence-based) · cold-run secret scan · stale `.ai-codex` counts · env template + coverage test · D1 account-switch leak · D11 · D14 delete re-upload · cost ledger + call gate.

## Checks that ran against REAL services vs mocks
- OpenRouter: two full panel runs + three smoke calls (2026-10-07, 2026-10-22). Unit tests mock the provider.
- Supabase: real login + session persistence in a browser (two `tcm-test+` accounts, 2026-10-07 and 2026-10-22, deleted after); the review function verified sessions against `/auth/v1/user` live. A/B isolation and anon-key RLS probes **not yet run** as scripted tests.
- Netlify: local `netlify dev` only; nothing deployed from this branch.

## Owner-only blockers
See `docs/manual_todo.md`.
