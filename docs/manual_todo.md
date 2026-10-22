# Manual TODO — actions only Ajay can do

Tracked per `docs/spec_v3.md` Part 6. Claude records blockers here instead of re-asking.
Last updated 2026-10-22.

## Credentials / env (put in the worktree's untracked `.env` — never pasted in chat)
- [x] `OPENROUTER_API_KEY` — **provided** (in the worktree `.env.local`, 2026-10-07; confirmed working by a smoke call). Needed from the **first paid call** onward. Direct Anthropic `ANTHROPIC_API_KEY` is the configured fallback (not set — optional).
- [ ] Supabase for live testing: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and server-only `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Then run migrations (`supabase/migrations/`).
- [ ] Stripe **test** keys + webhook secret (Step 33 live test).

## Budget (authorized envelope — enforced by the ledger, Step 20)
- Aggregate paid budget: **$25** across all providers + retries.
- Hard stops: after **3 real full audits**, or if any single audit exceeds **$1**. Ledger reserves worst-case cost *before* each paid call and refuses unaffordable dispatch.
- Larger live evaluation (e.g. the 20-audit grading packet) needs a **revised allowance** — it stays PENDING and does not block other work.

## Decisions / reviews
- [ ] Netlify site + plan decision (background functions may require a paid plan — Step 9/37).
- [ ] **Merge decision for the Stage A+B PR (2026-10-22).** The linked Netlify project already injects `VITE_REVIEW_ENDPOINT=/api/review` (production is in proxy mode). Merging ships the typed contract, which **fails safe** on a deploy until the spend ledger moves to Postgres — the deep audit would show "Could not reach the review service". Options: (a) merge and accept that until the `spend_ledger` table lands, (b) unset `VITE_REVIEW_ENDPOINT` in the project to fall back to browser-key mode, (c) hold the merge. Also confirm in Site configuration → Environment that `SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `OPENROUTER_API_KEY` are available to **functions** (not scoped to builds only) and that `ALLOWED_ORIGIN` lists the site's own origin.
- [ ] **Approve the `spend_ledger` migration** (atomic reserve/settle in Postgres under RLS; replaces `DATA_DIR/derived/ledger.jsonl` in production). It is DDL against the live database, so per the standing rule it will be written to `supabase/migrations/` and not applied without your go-ahead.
- [ ] Optional GitHub hardening once CI is green: branch protection on `main` requiring the `ci / verify` check — a repository setting, so it is yours to flip.
- [ ] Answer `knowledge/interview_questions.md`; fill `knowledge/the_line.md` (Step 15).
- [ ] Identify actual confidential TU assets for `knowledge/access_policy.md` (do not presume confidentiality from an old list).
- [ ] Grade review packets: tagging 50, comparables 10, audits 20 — human-graded targets stay **PENDING** until graded and are never marked passed without grades.
- [ ] Confirm or replace the authority line "Made by students who transferred into multiple Ivies"; review draft `#/privacy` and `#/terms`; **decide on Reddit / College-Confidential-derived data use for a paid product** (the corpus is scraped pseudonymous posts, some from minors).
- [ ] Approve deploy and live charging when ready (no deploy / no live charging under this work order).

## Notes
- Spec lineage: `docs/spec_v2.md` (first brief, 2026-10-06) → `docs/spec_v3.md` (master spec + PART 8 budget split) → **`docs/spec.md` (17 Oct 2026 launch prompt — current)**. Read `docs/progress.md` first in any new session.
- **Supabase free tier auto-pauses after ~7 idle days** and the project host drops out of DNS (NXDOMAIN), which surfaces as login "Failed to fetch". Happened 2026-10-07; the owner restored it from the dashboard. Before any live test: `nslookup nikfuakdulqmumsaisnn.supabase.co 1.1.1.1`. Keeping it awake, or moving to a paid plan, is an owner decision.
