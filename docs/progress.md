# Progress — read this first

Living status for the v3 execution (`docs/spec_v3.md`). Updated every commit.
Last updated: 2026-10-07.

## Budget (OpenRouter + Anthropic aggregate)
- Cap: **$25 total**, **$1 per audit**, **stop after 3 real full audits**.
- Spent: **$0.000015** (one smoke call). Reserved open: $0. Remaining: ~**$24.99998**.
- Real full audits used: **0 / 3**.
- Ledger: `DATA_DIR/derived/ledger.json` (outside the repo), enforced by
  `netlify/functions/_ledger.ts` + `_llm.ts` before every paid call.

## Environment / stack
- `.env.local` copied into the worktree, gitignored, **not tracked**. Set:
  OPENROUTER_API_KEY, OPENROUTER_MODEL (`qwen/qwen3.7-plus`),
  SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (mirrored), VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY. (No ANTHROPIC_API_KEY / Upstash — optional.)
- Live Supabase project `nikfuakdulqmumsaisnn`, schema+admin applied (per owner).
- `netlify dev` / `dev:full`: **not set up yet** (Section 2) — so `/api/review`
  isn't served locally yet; `npm run dev` (vite, port 5199) runs the SPA only.

## Last commit → next action
- Next: **spec_v3 full verbatim rewrite** (Section 6), then **Step 4** (lock down
  the review endpoint), then **`netlify dev` + live-Supabase E2E** (Sections 2 & 4),
  fixing **D14** before the delete tests.

## Step / defect matrix
Legend: ✅ done & verified · 🟡 partial · ⬜ pending · ⛔ blocked (owner input)

| Item | Status | Notes |
|---|---|---|
| Odds compression (pre-v3 #1) | ✅ | observed/rate-scaled; regression tests |
| Privacy copy (pre-v3 #2) | ✅ | `privacy.ts`; AI-review upload disclosed |
| Cold-run secret scan (pre-v3 #4) | ✅ | builds dist on demand |
| Stale `.ai-codex` counts (pre-v3 #5) | ✅ | 208 / 157 corrected |
| **Step 1 / D11** env template | 🟡 | `.env.example` + coverage test done; `config/paths.ts`+`--dry-run` wait for Step 12 |
| **Step 2 / D1** account isolation | 🟡 | logic+build verified (`session.ts`); live-DB E2E pending (Section 4) |
| **Step 20** cost ledger (minimal) | ✅ | `_ledger.ts`+`_llm.ts`; 10 tests; smoke call OK. Full guardrails (retries/cache/allowlist/injection/schema) ⬜ |
| Smoke call (Section 3) | ✅ | $0.000015, key valid |
| **Step 3 / D2** Netlify delete+admin ports | ⬜ | |
| **Step 4 / D7·D8·D9** endpoint lockdown | ⬜ | next |
| **Step 5 / D10** Supabase hardening | ⬜ | migration + RLS tests; no DDL on live DB without owner OK |
| **Step 6 / D3** layout overflow | ⬜ | needs Playwright |
| **Step 7 / D4** profile readiness (confirmed) | 🟡 | presence-based done; per-field `confirmed` tracking ⬜ (ties to Step 25) |
| **Step 8 / D6** single CSP + gstatic | ⬜ | blocks a trustworthy Netlify deploy |
| **Step 9 / D5** bundle lazy-load | ⬜ | main chunk ~1,150 KB |
| **Step 10 / D12·D13** copy + signed-out funnel | 🟡 | privacy copy ✅; signed-out preview (D13) ⬜ |
| **D14** "Delete my data" resurrection | ⬜ | fix before Section 4.5 delete tests |
| Phase B–I (Steps 12–38) | ⬜ | pipeline, extraction, audit engine, Stripe test, e2e, deploy readiness |
| spec_v3 full verbatim text | ⬜ | current file is condensed; rewrite (Section 6) |
| Guest-draft "keep what I entered" choice | ⬜ | Section 6 refinement to the Step 2 adopt path |

## Checks that ran against REAL services vs mocks
- OpenRouter: **real** — one smoke call ($0.000015). Everything else: **mocked** (unit tests keep the mock provider).
- Supabase: **nothing yet** — live E2E (auth, RLS, isolation, delete) is Section 4, pending `netlify dev`.

## Owner-only blockers
See `docs/manual_todo.md`. None block the deterministic work above.
