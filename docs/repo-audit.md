# Repository audit — current branch vs the 17 Oct 2026 review

Stage A deliverable (`docs/spec.md` §4). The brief reviewed `main` @ `538dcb7`; this audits the **active branch** `claude/transfer-chance-me-impl-2a8520`, which carries 13 commits beyond it. Every claim below was re-run or re-read on 2026-10-17; nothing is inherited from the brief without a check.

## 1. Baseline (dependency order, clean lockfile install)

| Check | Command | Result |
|---|---|---|
| Install from lockfile | `npm ci` | ✅ exit 0 (1,229 packages audited) |
| Build | `npm run build` (`tsc -b && vite build`) | ✅ |
| Tests (after build) | `npx vitest run` | ✅ **296 passed / 19 files** (reviewed commit: 260 / 11) |
| Netlify typecheck | `npm run typecheck:netlify` | ✅ clean |
| Lint | `npm run lint` (oxlint) | ✅ exit 0, **1 warning** `src/components/Portal.tsx:1271` exhaustive-deps (unchanged from review) |
| Runtime | — | node v22.19.0 (`.nvmrc` 22), npm 10.9.3 |
| Credentials | names only, never values | `.env.local` present + gitignored; set: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (new `sb_publishable_…` format), `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`. **Not set:** `VITE_REVIEW_ENDPOINT` → the app currently runs the review in *browser-key* mode (asks the visitor for an `sk-ant-` key) — see §3 |
| Research data | — | `DATA_DIR=/Users/ajaysharma/claude chance me/data` present (168 MB). It is **outside the repo and outside the worktree**, so the builders' relative `../data/processed` does not resolve from a worktree; `config/paths.ts` resolves it via `DATA_DIR` |
| Supabase project | DNS + `/auth/v1/health` | `nikfuakdulqmumsaisnn` resolves today (172.64.149.246). It is a free-tier project that **auto-pauses after ~7 idle days**, which drops its host from DNS (observed 2026-10-07; restored by the owner). Any live check must confirm it resolves first |

### Bundle — the baseline the brief quotes is the *unconfigured* build
The brief measured ~1,149 kB / 356 kB gzip. Reproduced exactly — **but only when `VITE_SUPABASE_*` is absent at build time**: `src/lib/supabase.ts` computes `cloudEnabled` from `import.meta.env`, Vite inlines it as a constant, and Rolldown tree-shakes `createClient` and the entire `@supabase/*` SDK out of the chunk. With production configuration present (as on any real deploy) the same source builds to:

| Chunk | Unconfigured (brief's figure, A/B @612d387) | **Configured (production-equivalent, HEAD)** |
|---|---|---|
| `index-*.js` | 1,150.87 kB / 357.15 kB gzip, 73 modules | **1,372.51 kB / 414.56 kB gzip, 113 modules** |
| of which `@supabase/*` + deps | 0 | ~890 k source chars (`auth-js` 423 k, `storage-js` 109 k, `postgrest-js` 107 k, `realtime-js` 100 k, `phoenix` 56 k, `supabase-js` 38 k, `functions-js`, `iceberg-js`, `tslib`) |
| `pdf-*.js` / worker | 427 kB / 1,262 kB (separate, lazy) | same |
| CSS | 184 kB / 34 kB gzip | same |

No package is bundled from more than one physical path (no duplication). **Consequences:** (a) Stage I's "reduce from ~356 kB" must start from **414 kB gzip**; (b) the Supabase SDK is loaded eagerly on the landing page for signed-out visitors — deferring it is a measured ~58 kB gzip initial-route win; (c) bundle measurements must be taken with production env present or they are meaningless.

### Script runner — `export:signups` was broken on a clean install
`npm ls vite-node` on the clean tree is **empty** and there is no `node_modules/.bin/vite-node`: every `npx vite-node …` run (including `npm run export:signups`) had been auto-downloading it from the registry. Fixed in this stage by adding `tsx` as the declared runner and making the three `import.meta.env` reads (`review.ts`, `supabase.ts`, `googleAuth.ts`) safe to import outside Vite.

## 2. Reconciliation — each §2 finding against current code

Legend: ✅ fixed on branch · 🟡 partially fixed / fixed to a weaker standard than this brief · ⬜ open, confirmed present · ✔ confirmed as described (fact, not defect)

| Finding (brief §2) | Current status | Evidence / file refs |
|---|---|---|
| Profile gate: 3.8 / CS locked out by default-value comparison | ✅ | Per-field explicit confirmation: `Profile.confirmed`, `profileReadiness()` (`src/lib/profile.ts`); defaults never count, extraction never confirms, editing a field confirms only that field, "These are correct" confirms all. Browser-verified 2026-10-17 (`tests/profile-readiness.test.ts`) |
| Target list split (tracker vs Review's own targets, Cornell/UCLA/Michigan default) | ✅ | One shared list `src/lib/targets.ts` (`tcm.list.v1`, `included` scope ≤ `MAX_INCLUDED_TARGETS` from `config/product.ts`); Review seeds nothing and sends exactly the displayed targets (`tests/targets.test.ts`, `tests/panel-client.test.ts`) |
| Actual AI entry point is `panel.ts`, not `runReview` | ✅ | `runReview`/`buildPrompt`/`loadLastReview` removed; `src/lib/review.ts` keeps mode + key only |
| Panel transport ignores Netlify 202/poll → empty text | ✅ | `src/lib/audit/client.ts` `proxyTransport`: POST typed request → 202 → poll until done/error/expiry, Supabase bearer on every call; E2E ×2 under `netlify dev` 2026-10-22 |
| Worker validator requires legacy full shape | ✅ | `validateSection(kind)` in `src/lib/audit/schema.ts`, shared by worker, browser and tests; `validateReview` deleted (`tests/audit-schema.test.ts`) |
| Job authorization: UUID is the only capability | ✅ | `netlify/functions/_auth.ts` verifies the session against Supabase `/auth/v1/user`; jobs carry the uid; poll is owner-only (404 otherwise); worker still accepts only a job id and now claims it atomically |
| Job concurrency: non-atomic claim/counters | ✅ claim · ✔ counters | `claimJob()` = Blobs conditional write (`onlyIfNew`), one run per job; TTLs unified in `_jobs.ts` (`PENDING_DEADLINE_MS` advertised, `JOB_TTL_SEC` stored). `bump()` is still read-modify-write and documented as unfit for a paid quota |
| Persistence: localStorage caches, swallowed sync errors, no history | 🟡 | Account-switch leak and delete-resurrection fixed (`session.ts`, `accountData.ts`; `9afa3d6`, `9376793`). No versioned report history; `pushDoc` still appends a new row every run (`Review.tsx:86-91`). Stage C |
| Authentication: Supabase + local fallback | 🟡 | Live login + session persistence verified in a real browser 2026-10-07 (test account, deleted after). Local-account fallback still exists; "require by configuration" and the no-bring-your-own-key rule are open. Stage C |
| Hosting mismatch: account deletion/admin are Vercel-only | ⬜ | `api/account/*`, `api/admin/*`; `netlify.toml` publishes only review/contribute. Stage C |
| Admin gaps (roster/notes endpoints missing) | ⬜ | per `src/components/admin/api.ts` comments; not re-audited in depth |
| Billing: $9/$49 placeholders, device-only waitlist, no Stripe | ⬜ | `Pricing.tsx` (`tcm.waitlist.v1`, "Plus plan, coming soon"). Stage H |
| Uploads: PDF/TXT only, 6 files, 20 MB | ⬜ | `ImportPanel.tsx:21,35,90`. Stage D |
| Upload integrity (direct apply, saved as transcript) | ⬜ | `ImportPanel.tsx:40-45`. Stage D |
| Privacy wording | ✅ | Components fixed with a single source of truth + guard tests (`src/lib/privacy.ts`, `c686c01`); README aligned 2026-10-22 (signed-in vs signed-out, the AI audit path) and its "near-zero weight on extracurriculars" line replaced by the pattern-beats-prestige finding |
| Probability: missing non-UC GPA → invented 3.95 "observed" median | 🟡 | Fixed to a better standard (`9805658`): observed corpus percentiles via `admitSignature` first; fallback is rate-scaled and **labelled "estimated"**, never "observed"; regression tests (Sac State 3.04 CS 17.7%→58.9%, Cleveland 17.3%→85.0%, selective unchanged). **This brief's bar is stricter** — unknown must stay unknown, no distribution from selectivity — so the rate-scaled fallback is to be replaced by readiness/selectivity tiers + official rate in Stage E |
| TAG returns 95% "guarantee" from a subset of checks | ⬜ | `engine.ts:428-445`. Stage E |
| Model may adjust numeric odds | ✅ | The only AI path is the panel: prompts carry the engine's odds as context, no output schema has an odds field (`tests/audit-prompts.test.ts`). The legacy `perSchool[].chance` prompt, `checkChance` and the Vercel/Cloudflare review handlers are deleted |
| Corpus: 8,910 / 4,243 are artifact metadata | ✔ open | `model.json.meta`; raw reconciliation not yet done — now possible, `DATA_DIR` is present (`t25_applicants.csv` is 8,918 rows per spec_v3). Stage F |
| Comparables: 856 people / 2,158 entries / 96 schools; fields `a,d,f,g,i,m,y` | ✔ | matches `similar.json.meta` and `src/lib/similar.ts` |
| Model coverage 208 / 177 / 21 / 14 | ✔ (208, 177 recounted; 21/14 as reported) | `MODEL.schools.length === 208` asserted in tests |
| Reproducibility: `../data/processed` absent; `scripts/fit_admit_model.py` absent | ✔ open | relative path fails from a worktree (data exists at `DATA_DIR`); fit script is not in the tree — `fitted_model.json` cannot be regenerated from the repo. Stage F |
| Tests don't prove integrated panel/RLS/billing/deploy | ✔ | still true; E2E is Stage I |
| Cold-run test failure = deterministic missing `dist` | ✅ | `no-secrets-in-bundle.test.ts` now builds on demand when `dist/` is absent (`807362b`); the brief's own reading ("not intermittent") matches |
| Lint warning `Portal.tsx:1271` | ✅ | `useMemo` for `listed`; lint clean |
| Bundle ~1,149 kB / 356 kB gzip | ✔ corrected | see §1 — that is the unconfigured build; production-equivalent is 1,372 kB / 414 kB gzip |

## 3. Additional defects reproduced on the current branch this session
- **Review spends outside the ledger.** ✅ Fixed — the worker calls the model only through `_llm.callModel` (reserve → dispatch → settle; five calls of a run share a `group`). The first live run then exposed that the ledger's JSON-snapshot persistence **lost entries under parallel workers** (three successful calls failed as "no entry to settle"); it is now an append-only event log (`ledger.jsonl`, `tests/ledger-log.test.ts`).
- **Hidden reasoning blew the output cap.** Reproduced 2026-10-22: the first specialist reply stopped at exactly 4,000 output tokens (truncated JSON → retry). Fixed: `reasoning: { enabled: false }` on OpenRouter calls, `SECTION_MAX_TOKENS` 8,000/6,000, real price for `qwen/qwen3.7-plus` in `config/budgets.ts`.
- **D1, in-memory half.** Reproduced 2026-10-22: after a sign-in that reset storage, Portal's React state still held the previous account's list and persisted it back (and pushed it) under the new account. Fixed: the clears broadcast `USER_DATA_CLEARED_EVENT`; Portal and Review reload from storage (`tests/user-data-cleared.test.ts`).
- **Browser-key mode is the live default locally** only when `VITE_REVIEW_ENDPOINT` is unset; the Netlify project injects it, so production is proxy mode. Stage C decides whether bring-your-own-key survives at all.
- **Dual CSP.** `netlify.toml` and `public/_headers` both set `Content-Security-Policy` and differ (Supabase hosts); Netlify applies both. Not yet reconciled (spec_v3 Step 8).
- **`deno.lock`** is emitted by `netlify dev` (Deno edge tooling); now gitignored.
- **netlify-cli in a git worktree** resolves the repository root to the main checkout and silently bundles its stale functions; `dev:full` now passes `--cwd` from outside the directory (NETLIFY.md).

## 4. Active host and deployment state
- Declared target: **Netlify** (`netlify.toml`, functions `review`, `review-background`, `_jobs`, `contribute`). Vercel (`api/`, `vercel.json`) and Cloudflare (`functions/`, `wrangler.toml`) code coexist.
- **Nothing is deployed by this work.** The repo is not linked to a Netlify site (`.netlify/state.json` absent) and no site URL is recorded anywhere; the branch is pushed to GitHub (7 of 13 commits pushed as of the last push), not merged.
- Local full-stack path (verified 2026-10-07): Vite on **5200** with `/api/*` proxied to `netlify dev` on **8888** (`npm run dev:full`); 8888's own UI is blank (netlify-dev/React-HMR preamble quirk) so the app is served from 5200. Both servers are stopped at the time of this audit.

## 5. Source availability
Present at `DATA_DIR`: `processed/{t25,analysis,context,shards}`, `outcomes.csv`, `cc_outcomes_all.csv`, `threads.jsonl`, `cc_candidates.jsonl`, `raw/`. Absent from the repo: the model-fitting script and any authorized expert briefs beyond `src/data/intel.json`/`playbook.json`. Overlap between `t25_applicants`, `outcomes`, `cc_outcomes_all` is unreconciled (Stage F).

## 6. Unknowns
Whether any Netlify site/plan exists (background functions may need a paid plan); whether the owner's `intel.json`/`playbook.json` claims are substantiated; the authority line ("multiple Ivies"); owner display/retention policy; whether the Supabase project will stay unpaused during multi-day work.

## 7. Launch blockers, in dependency order
1. ~~AI path broken on Netlify and unmetered~~ ✅ Stage B (verified locally). **Open successor:** the spend ledger is a local file — in production `reserve()` cannot write and every audit fails safe; the `spend_ledger` table (Supabase, atomic) is required before the deep audit can run on a deploy — Stage C.
2. ~~No job ownership/auth; non-atomic claims; TTL mismatch~~ ✅ Stage B.
3. **Account deletion and admin not deployable on Netlify** — Stage C.
4. ~~Profile readiness and the split target list~~ ✅ Stage A.
5. TAG 95% and the remaining estimated-median fallback — Stage E (model-set odds ✅ retired).
6. Uploads limited to PDF/TXT; no confirmation screen — Stage D.
7. No billing/entitlements; placeholder pricing — Stage H.
8. Dual CSP; 414 kB gzip initial route — Stage I.
9. Corpus reconciliation, fit-script absence, human evaluations — Stage F / gates.
10. Owner items: policy, authority line, credentials for live billing, deploy approval.
