# Progress — read this first

Living status. **New session: read this, then `docs/spec.md` (current execution reference, 17 Oct 2026), then `docs/repo-audit.md` (finding-by-finding reconciliation). `docs/spec_v3.md` PART 8 still records the authorized paid-budget split; `docs/spec_v2.md` is the first brief + early implementation log.**
Last updated: 2026-10-17.

## Budget (OpenRouter + Anthropic aggregate)
- Cap: **$25 total**, **$1 per audit**, **stop after 3 real full audits** (spec_v3 PART 8 split: extraction ≤ $3 · tagging ≤ $4 · 3 audits ≤ $3 + retries · ~$15 reserve, owner approval to spend).
- Spent: **$0.000015** (one smoke call, 2026-10-07). Reserved open: $0. Remaining ~**$24.99998**. Real audits used **0 / 3**.
- Ledger: `DATA_DIR/derived/ledger.json`, enforced by `netlify/functions/_ledger.ts` + `_llm.ts`. **The review worker does not yet go through it** (Stage B).
- External-model inputs exclude author_id, usernames, URLs, post ids (PART 8 §4).

## Environment / stack
- `.env.local` in the worktree, gitignored. Set: Supabase URL/anon/service, `SUPABASE_URL`, `OPENROUTER_API_KEY`/`MODEL`. **Unset on purpose:** `VITE_REVIEW_ENDPOINT` (so the unmetered worker isn't the default) → app is in browser-key review mode until Stage B.
- Supabase project `nikfuakdulqmumsaisnn` resolves today. **Free tier auto-pauses after ~7 idle days** (drops from DNS; happened 2026-10-07). Check `nslookup nikfuakdulqmumsaisnn.supabase.co 1.1.1.1` before live tests; owner restores from the dashboard.
- Local full stack: `npm run dev -- --port 5200` (app; `/api/*` proxied) + `npm run dev:full` (netlify dev, 8888). **Both stopped** — restart when browser verification is needed.
- Scripts run with **`tsx`** (declared devDep). `vite-node` was never in the lockfile tree.
- Baseline (clean `npm ci`): build ✅ · **296/296 tests** · netlify typecheck ✅ · lint 1 known warning. Bundle, production-equivalent: **1,372 kB / 414 kB gzip** (the 356 kB figure is the Supabase-less build — see repo-audit §1).

## Last commit → next action
- Next: **Stage A code** — per-field `confirmed` readiness (defaults never count; migrate without inventing confirmation), one **shared target list** (tracker/preview/audit/export; remove Cornell/UCLA/Michigan defaults), regression tests; fix `Portal.tsx:1271` while there. Then **Stage B**: server-built prompts + per-kind validation + 202/poll in `panel.ts` + auth + ledger routing.

## Stage matrix (spec.md §14 order)
Legend: ✅ verified · 🟡 partial / integration pending · ⬜ pending · ⛔ blocked (owner)

| Stage | Status | Notes |
|---|---|---|
| **A** Baseline, completeness, shared targets, regression tests | 🟡 | baseline ✅ (clean install, verify script, repo-audit, spec saved); completeness/targets ⬜ |
| **B** Typed server-built audit contract, auth'd jobs, atomic claims | ⬜ | breaks confirmed: `panel.ts` 202, `validateReview` mismatch, no auth, worker outside ledger |
| **C** Snapshots/sync/history, Netlify route parity, deletion lifecycle | 🟡 | D1 isolation + D14 delete-resurrection fixed; deletion/admin Netlify port ⬜; history ⬜ |
| **D** Upload confirmation, formats | ⬜ | PDF/TXT only today |
| **E** School registry, odds/guarantee honesty | 🟡 | 3.95 invented median fixed (observed → "estimated" fallback); TAG 95% ⬜; tiers-when-unknown ⬜ |
| **F** Corpus pipeline, comparables | ⬜ | DATA_DIR present; reconciliation not started |
| **G** Audit quality, progressive UI, export | ⬜ | |
| **H** Stripe test mode, entitlements, abuse controls | ⬜ | |
| **I** E2E, ops, perf, release candidate | ⬜ | CSP dual files; 414 kB gzip baseline |

## Earlier fixed defects (pre-v4, all with tests)
Odds compression · privacy copy (`privacy.ts`) · profile "Fill in" (presence-based) · cold-run secret scan · stale `.ai-codex` counts · env template + coverage test · D1 account-switch leak · D11 · D14 delete re-upload · cost ledger + call gate.

## Checks that ran against REAL services vs mocks
- OpenRouter: one real smoke call (2026-10-07). All other model paths mocked.
- Supabase: real login + session-persistence verified in a browser with a confirmed test account (2026-10-07, deleted after). A/B isolation and anon-key RLS probes **not yet run**.
- Netlify: local `netlify dev` only; nothing deployed.

## Owner-only blockers
See `docs/manual_todo.md`.
