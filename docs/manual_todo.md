# Manual TODO — actions only Ajay can do

Tracked per `docs/spec_v3.md` Part 6. Claude records blockers here instead of re-asking.
Last updated 2026-10-07.

## Credentials / env (put in the worktree's untracked `.env` — never pasted in chat)
- [ ] `OPENROUTER_API_KEY` — needed from Step 23 (extraction) and Step 30 (audits) live mode on. Until present, **all model work runs against mocks/fixtures**. Direct Anthropic `ANTHROPIC_API_KEY` is the configured fallback.
- [ ] Supabase for live testing: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and server-only `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Then run migrations (`supabase/migrations/`).
- [ ] Stripe **test** keys + webhook secret (Step 33 live test).

## Budget (authorized envelope — enforced by the ledger, Step 20)
- Aggregate paid budget: **$25** across all providers + retries.
- Hard stops: after **3 real full audits**, or if any single audit exceeds **$1**. Ledger reserves worst-case cost *before* each paid call and refuses unaffordable dispatch.
- Larger live evaluation (e.g. the 20-audit grading packet) needs a **revised allowance** — it stays PENDING and does not block other work.

## Decisions / reviews
- [ ] Netlify site + plan decision (background functions may require a paid plan — Step 9/37).
- [ ] Answer `knowledge/interview_questions.md`; fill `knowledge/the_line.md` (Step 15).
- [ ] Identify actual confidential TU assets for `knowledge/access_policy.md` (do not presume confidentiality from an old list).
- [ ] Grade review packets: tagging 50, comparables 10, audits 20 — human-graded targets stay **PENDING** until graded and are never marked passed without grades.
- [ ] Confirm or replace the authority line "Made by students who transferred into multiple Ivies"; review draft `#/privacy` and `#/terms`; **decide on Reddit / College-Confidential-derived data use for a paid product** (the corpus is scraped pseudonymous posts, some from minors).
- [ ] Approve deploy and live charging when ready (no deploy / no live charging under this work order).

## Notes
- Earlier background brief is `docs/spec.md`. v3 references it as "spec_v2.md"; there is no separate spec_v2.md — `spec.md` is that background and is retained. `spec_v3.md` is the current execution reference.
