# Transfer Chance Me: Master Execution Spec v3

Save this file as `docs/spec_v3.md` and make it the current execution reference. It supersedes conflicting procedural instructions in `docs/spec_v2.md` and `docs/spec.md`; retain the latter as product background. Execute in real dependency order, using the numbered steps as a coverage checklist. Implement, verify, commit, and continue. Do not return a plan and wait.

## PART 0. Execution authority and complete internal data access

1. Own the outcome. Act as the senior engineer and admissions-product analyst responsible for the complete system. Find root causes, make the necessary changes, run the application, verify behavior, and continue until available authorized work is complete. No artificial stop after inventory, design, a phase boundary, a fixed number of turns, or a documentation milestone.
2. Make routine decisions. You may refactor, add justified dependencies, revise schemas, improve prompts, choose supported model providers, and change internal architecture when evidence shows a better solution. Do not request approval for ordinary reversible implementation. Explain consequential choices briefly and keep moving.
3. Resolve dependencies locally. Missing data, keys, human grades, or a platform feature block only the operations that require them. Complete adapters, synthetic fixtures, mocks, UI, migration files, and deterministic checks in parallel with resolving missing inputs. Record exact owner actions in `docs/manual_todo.md`; do not repeatedly ask the same question.
4. Complete internal data means complete data. Preserve every available field in the authorized project sources, including original narrative text, activities, essays, institutions, years, source identifiers, contextual fields, and outcomes. Maintain untouched raw sources and traceable normalized/enriched layers. Do not overwrite source material with anonymized summaries, suppress rare profiles, remove rejected applicants, or restrict internal ranked exports to eight examples.
5. Separate research from display. Deliver full internal machine-readable exports and complete evidence traces in restricted working storage. The owner will supply production privacy, retention, and display rules. Do not make policy drafting or anonymization approval a prerequisite for internal research. Build customer-facing output through an independent field allowlist; raw private records and credentials do not belong in git, public assets, client bundles, or ordinary logs. Internal access does not authorize public disclosure or unrelated private-account access.
6. Advice must be useful. Do not withhold ordinary admissions guidance or intentionally weaken diagnoses to create a TU upsell. Specifically identified confidential TU materials can use access controls. Do not presume a topic is confidential merely because an earlier draft placed it on a list. Ask the owner to identify actual restricted assets while continuing with available nonconfidential guidance.
7. Git and verification. Inspect the current worktree and branch before changing anything. Continue `claude/transfer-chance-me-impl-2a8520` if it is the intended active branch; preserve unrelated work. Commit coherent verified changes, not one arbitrary commit per numbered step. Use behavior-level regression tests for defects and appropriate checks for material changes. Record concise verification evidence rather than pasting enormous outputs after every minor edit. Run the full relevant suite at meaningful integration points; do not repeat unchanged passing suites as a ritual. Do not push or open a PR unless asked.
8. Instructions and style. Read `CLAUDE.md`, relevant `.ai-codex/` files, the background brief, and this execution spec. This spec overrides conflicting product-process restrictions; actual tool permissions and credential limits still apply. Update architecture documentation when it becomes inaccurate. Write specific plain-language copy. Punctuation preferences are editorial guidance, not build blockers. Verify factual authority claims rather than inventing credentials.
9. Models and budget. Use OpenRouter with `OPENROUTER_API_KEY` from the untracked environment; direct Anthropic is an explicitly configured fallback. Build fixture/mocked paths before live calls. The owner-authorized aggregate paid budget remains $25 across all providers and retries. Implement the ledger before ANY paid call, including tagging or model comparisons. Stop further paid calls after three real full audits or if any single audit exceeds $1. Continue all remaining mock and deterministic work. Any larger live evaluation requires a changed budget or test allowance from the owner; never disguise comparison runs as something other than paid audits.
10. External release boundary. Prepare deployment and Stripe test-mode flows completely, but do not deploy, activate live charging, delete original datasets, rewrite shared git history, or edit a live database under this work order. These are the owner's explicit operating decisions, not reasons to stop local implementation. Create migrations and exact rollout instructions now.
11. Evidence without paralysis. Investigate all available data, including exploratory and low-sample findings. Sample size limits confidence, not permission to inspect or export observations. Label estimates, gaps, contradictions, and exploratory patterns accurately. Do not fabricate outcomes, source access, test results, or statistical certainty to satisfy a checklist.

### Required execution-order corrections
- Move Step 20 (shared model client and atomic cost ledger) ahead of Step 16 and every live benchmark.
- Move Step 25 (profile schema and migration) before extraction contracts, confirmation UI, and section schemas depend on it.
- Build the signed-out deterministic funnel and its browser checks early; do not wait until the final phase to discover it fails.
- Treat architecture, libraries, weights, and schema fields below as concrete starting designs. Adapt them where runtime constraints, measured behavior, or data coverage justify a change.
- Resolve contradictory evaluation counts: no five-audit live comparison or 20-audit live packet within the three-audit allowance. Prepare 20 varied input cases, mocked integration outputs clearly labeled as mocks, and an owner grading framework; include at most the three authorized real audit outputs. Larger live evaluation remains pending without blocking other work.

## PART 1. Reported verified state: recheck on the active worktree

### Repo
- React 19 + Vite SPA, hash router (`src/App.tsx`), Supabase auth + RLS, Netlify functions (`netlify/functions/review.ts`, `review-background.ts`, `_jobs.ts`, `contribute.ts`), legacy Vercel handlers in `api/` (account delete, admin, review), Cloudflare copies in `functions/` + `wrangler.toml`.
- 276 tests pass; build and both typechecks pass; 1 lint warning (Portal.tsx:1271 exhaustive-deps).
- Main JS chunk 1,150 KB, pdf chunk 427 KB.
- You are in a git worktree, so `../data` does not resolve to the dataset.

### Dataset at `DATA_DIR=/Users/ajaysharma/claude chance me/data` (168 MB):
- `processed/t25/t25_applicants.csv`: 8,918 rows (the "8,910" headline). Columns and fill rates: record_id, source_subreddit, url, post_year, author_id 99%, school_name, term 15%, decision, college_gpa 40%, gpa_scale 3%, credits_completed 5%, sat 8%, act 4%, intended_major 56%, current_institution 21%, current_institution_type 41%, residency 12%, financial_aid 51%, demographics 15%, hooks 11%, extracurriculars 27%, work_experience 13%, awards 10%, essays_narrative 79%, extraction_confidence.
- `processed/outcomes.csv`: 4,180 rows, 1,750 distinct authors; decisions accepted 2,661, rejected 735, waitlisted 456, pending 207, enrolled 96, withdrawn 25. Columns: record_id, source_subreddit, url, post_date, post_year, author_id, post_type, current_institution_type 34%, college_gpa 73%, intended_major 82%, school_name, term, decision, decision_source, extraction_confidence, school_canon.
- `processed/cc_outcomes_all.csv`: 3,964 rows, same schema minus school_canon (College Confidential).
- `processed/analysis/ACTIVITY_INVENTORY.csv` (+ part1/part2): 4,087 structured activity rows: record_id, author_id, gpa, admitted_schools, rejected_schools, category, specific_activity, organization 20%, role 48%, field 42%, scope (often "unclear"), output 11%.
- `processed/analysis/`: ADMIT_SIGNATURES.md, TRADITIONAL_SIGNATURES.md, signature/SIG_<School>.md (per-school "who they take"), signature_trad/, ec_correlation_by_school.csv, ec_overall.csv, activity_trends_by_school.csv, school_advice.json, school_archetypes.csv, cohort_link.csv, dashboard_data.json, T25_Transfer_Study_Report.pdf, T25_Transfer_Analysis.xlsx.
- `processed/t25/`: admitted_profiles.csv (25 schools), official_rates.csv, official_part_1..5.csv, coadmit_pairs.csv, t25_school_year_summary.csv, t25_scorecard.csv, summary.csv, by_school/, by_year/, shards/ (163 act_items parts).
- `processed/context/`: cds_<School>.csv and cds_c_<School>.csv for the T25, plus long-form markdown briefs (combined_*, cc_transfer_richest_20_*).
- `processed/threads.jsonl` (269), cc_candidates.jsonl (159), trends_by_year.csv, shards/.
- `raw/`: arctic_posts.jsonl (77 MB), reddit_all_raw.jsonl, reddit_pilot_raw.jsonl, cc_threads_all.jsonl, cc_threads_raw.jsonl, cc_topics.json, CDS folders (berkeley, cornell, rice, ucla, vanderbilt), drive_aug15/.
- Unverified: overlap between t25_applicants, outcomes and cc_outcomes_all (same posts appear in several). Reconcile in Step 13 before quoting any count.

### Defects found by testing the branch (verified unless marked)
- D1 Logout leaves tcm.profile.v1 (essays, activities, awards), tcm.list.v1, tcm.users.v1 in localStorage. With Supabase on, user B signing in with an empty cloud row triggers pushProfile(profile) (App.tsx ~line 208) and writes user A's material into B's account.
- D2 Account deletion and admin are Vercel-only; netlify.toml sends every other /api/* to a 404. "Delete my account" fails on Netlify; Account.tsx shows a wrong "runs on the deployed site" message.
- D3 Mobile overflow: nav.mastnav is 34 px wider than a 390 px viewport on every route. Audit step tabs (01 Upload to 05 Feedback) overflow at 1280 px.
- D4 A brand-new empty account shows Profile "Ready" (defaults counted as entered).
- D5 Bundle 1,150 KB main chunk.
- D6 Google favicon URLs redirect to *.gstatic.com, not allowed by CSP img-src; some return 404. Two CSPs exist (netlify.toml, public/_headers) and differ.
- D7 (code review) /api/review accepts anonymous calls; only a 5/min per-IP limit. Background worker accepts writes for any well-formed job id.
- D8 (code review) Client stops polling at 180 s; worker budget 600 s with one retry, so a slow review is billed but shown as failed, inviting a paid rerun. Job expiry differs (review.ts 900 s vs _jobs.ts 3600 s).
- D9 (code review) netlify.toml rewrites /api/review to /.netlify/functions/review while the function also declares config.path; possible double-routing 404. Background functions may need a paid Netlify plan.
- D10 (code review) admin_alerts view lacks security_invoker (readable with anon key under default grants). has_consent() is security definer and answers for any uuid. pushDoc appends duplicates on every review run. consents never written by the client.
- D11 .env.example missing ALLOWED_ORIGIN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, Upstash vars; VITE_REVIEW_ENDPOINT must be required in production or visitors are asked for their own key.
- D12 Upload copy says "Parsing and scoring both run on this device" next to copy saying signed-in files sync; upload accepts only .pdf,.txt.
- D13 Signed-out "Check my chances" lands on a login wall (#/check gated).
- Not yet tested end to end: deep review against a live model, Netlify deploy, live Supabase.

## PART 2. The product you are building

### User journey (target)
1. Landing: "Check my chances" starts intake without an account.
2. Quick profile (GPA, current school, standing, major, targets) gives an instant deterministic preview: odds or readiness tier per target, top blocker, 3 comparable applicants. Account required to save or go deeper.
3. Upload everything: transcript(s), last year's Common App PDF or screenshots, activities list, essays, awards, resume. PDF, PNG, JPG, HEIC, DOCX, TXT; phone camera on mobile.
4. Extraction fills a structured profile with per-field confidence and source location. A review screen highlights low-confidence and conflicting fields; bulk-confirm the rest.
5. Context step (optional): high school (search by name, auto-fills public data), work hours, caregiving, first-gen, income band.
6. Free preview: target overview, top risk, one full activity assessment, up to 3 comparables.
7. Paid full audit ($79 one-time, config): streamed sections, first within 15 s, all within about 90 s.
8. Report: summary and most consequential next action; per-school read; one card per activity; essay diagnostics with quoted passages and suggested edits; coursework and prerequisites; awards; context; comparable applicants; dated action plan; export to PDF.
9. Optional "Work on this with TransferringUp" handoff with explicit consent to share a summary.
10. After decisions, opt-in outcome reporting.

Free vs paid are config (`config/product.yaml`), not code paths.

## PART 3. Starting architecture and concrete contracts

### 3.1 Layout
```
config/            models.yaml, product.yaml, budgets.yaml, similarity.yaml, odds.yaml
knowledge/         rubrics/*.md, schools/<School>.md, the_line.md, interview_questions.md
pipeline/          python package: __main__.py, stages/*.py, tests/
DATA_DIR/derived/  (outside repo) normalized.duckdb, enriched.parquet, comparables_full.parquet, runs/<date>/
src/data/generated/  display-safe JSON the app ships (comparables_display.json, patterns_display.json, hs_context index shards)
netlify/functions/ extract-*, audit-*, stripe-*, account-delete, admin-*, review*
supabase/migrations/ numbered SQL files
tests/             vitest unit + schema; e2e/ Playwright; fixtures/uploads/ synthetic only
docs/              spec.md, spec_v2.md, source_catalog.md, data_dictionary.md, coverage.md, DESIGN.md, DEPLOY_NETLIFY.md, manual_todo.md, handoff_<date>.md
```

### 3.2 Data layers (pipeline)
- raw: untouched files in DATA_DIR, referenced by path + sha256, never modified.
- normalized: one DuckDB file with tables applicants (source-scoped identity with confidence; unknown authors receive record-scoped identities rather than being merged), decisions (one canonical decision episode per applicant x school x term, with cycle/program distinctions where present and retained decision-status history), activities, narratives, sources (source file/hash, url where present, retrieval, record ids, mapping confidence). Stable record_id mapping back to raw.
- enriched: tags (activity type, responsibility, duration, scale, outcome, transfer reason, story tags, context signals) with model id, prompt version, confidence.
- display: what the app ships; built by an explicit allowlist of fields; separate from internal exports.

### 3.3 Database (Supabase migrations, all with RLS user_id = auth.uid() unless noted)
- uploads(id, user_id, storage_path, filename, mime, sha256, bytes, kind, status, created_at)
- extractions(id, upload_id, user_id, fields jsonb, confidence jsonb, conflicts jsonb, model, cost_usd, created_at)
- audits(id, user_id, profile_hash, tier 'preview'|'full', status, result jsonb, sections_done int, sections_total int, cost_usd, timings jsonb, created_at)
- audit_sections(id, audit_id, user_id, key, status, payload jsonb, error, model, cost_usd, ms) with realtime enabled
- entitlements(id, user_id, product, stripe_session_id unique, audits_remaining, created_at); written only by service role
- spend_ledger with request/job/audit ids, task kind, provider/model, reservation, actual or uncertain charge state, tokens, timestamps, and user attribution; service role only; atomic aggregate budget accounting and restart-safe reconciliation
- reported_outcomes(id, user_id, school, decision, term, consent_at)
- Storage bucket uploads private, path <user_id>/<upload_id>, policies by owner.

### 3.4 Model routing (config/models.yaml)
- extract: fast vision-capable model on OpenRouter. Benchmark a small set of supported candidates on the fixtures in Step 22, within the global reservation budget and record the winner with accuracy, latency, cost.
- audit_section: strong reasoning model (start from the repo default anthropic/claude-sonnet-4.5; verify actual provider model identifiers and compare supported candidates within the three-full-audit total allowance; use prepared graded inputs and section tests where appropriate, accounting for every paid call; select on measured quality, latency, and cost).
- tagging: cheapest model that passes the 90% tagging gate on 50 samples (local Ollama allowed if it passes and the Mac can run it).
- All calls go through one server module netlify/functions/_llm.ts that: enforces allowlisted models, prompt caching for stable blocks, timeouts, 2 retries max, JSON schema validation, prompt-injection fencing of user content, and writes every call to spend_ledger. It refuses calls once the global budget in config/budgets.yaml is spent.

### 3.5 Output contract (src/lib/audit/types.ts)
```ts
type Evidence = { kind: 'official'|'observed'|'rubric'|'model'|'user'; label: string; n?: number; source?: string; year?: string };
type Confidence = 'high'|'medium'|'low';

interface AuditResult {
  id: string; tier: 'preview'|'full'; generatedAt: string;
  summary: { headline: string; overall: string; nextAction: { what: string; why: string; by?: string } };
  schools: Array<{
    school: string; major?: string;
    eligibility: { status: 'eligible'|'at_risk'|'ineligible'|'unknown'; items: Array<{ requirement: string; met: boolean|null; note: string; source: string }> };
    odds: { lo: number; hi: number; tier: string; basis: string } | { tier: string; basis: string; experimental: true };
    read: string; strengths: string[]; concerns: string[]; moves: string[];
    deadline?: { date: string; note?: string }; evidence: Evidence[]; confidence: Confidence;
  }>;
  activities: Array<{
    index: number; title: string; signals: string; scale: 'campus'|'local'|'regional'|'national'|'unclear';
    strength: 1|2|3|4|5; perSchool: Array<{ school: string; read: string }>;
    issues: Array<{ issue: string; why: string; fix: string }>;
    exampleRewrite?: string; evidence: Evidence[];
  }>;
  essays: Array<{
    title: string; grade: string; promptFit: Array<{ school: string; fit: string }>;
    notes: Array<{ quote: string; issue: string; fix: string; sample?: string }>; direction: string;
  }>;
  coursework: { trend: string; gaps: Array<{ school: string; missing: string[]; source: string }>; uncertain: string[] };
  awards: Array<{ title: string; read: string; fix?: string }>;
  context: { facts: Array<{ fact: string; source: string; vintage?: string; proxy?: boolean }>; interpretation: string };
  comparables: Array<{ id: string; why: string; differs: string; gpa?: number; major?: string; route?: string; year?: number; admitted: string[]; denied: string[]; waitlisted: string[] }>;
  actions: Array<{ order: number; what: string; by?: string; effort: string; lift?: string }>;
  handoff: Array<{ gap: string; offer: string }>;
  missing: string[];
  meta: { models: Record<string,string>; promptVersions: Record<string,string>; costUsd: number; ms: number; sectionStatus: Record<string,'ok'|'failed'|'skipped'>; warnings: string[] };
}
```
Validate with a runtime schema (zod or the existing _guard.ts style) on the server for every section and on the client before render.

### 3.6 Audit section plan (parallel, bounded concurrency 6)
Sections: summary (runs last, consumes others), context, one school:<name> per target, one activity:<i> per activity, one essay:<i> per essay, coursework, awards, actions (after schools). Each section prompt = stable cached block (rubric + school pattern file + output schema) + small dynamic block (relevant profile slice + top comparables + deterministic odds). Comparables, odds, eligibility and deadlines are computed in code and passed in; the model explains, it never changes the numbers.

### 3.7 Similarity (config/similarity.yaml, PRIOR weights)
Starting PRIOR weights: GPA 0.30 (Gaussian, sigma 0.15), major family 0.20, institution 0.10 (exact or type-based partial similarity, not two additive dimensions), state/region 0.07, transfer route 0.10, target overlap 0.05, activity tags 0.10, story tags 0.08. Normalize comparable observed dimensions explicitly. Report evidence coverage separately so a candidate matching one known feature cannot outrank a substantially supported match through missingness alone. Unknown features are "not compared," never inferred matches. Return score, coverage, component contributions, matched/differing/missing features, confidence, and source references. Validate and tune rather than treating these priors as learned admissions effects.

## PART 4. Step-by-step execution

Each step defines required behavior and verification. Adapt file boundaries and dependency order as needed. Commit coherent changes with clear messages. "Done when" means verified for the claimed environment; mocked or unrun checks remain explicitly distinguished.

### Phase A. Ship-blockers
**Step 1. Config for data path and env template.** Do: add config/paths.ts and pipeline/config.py reading DATA_DIR with default /Users/ajaysharma/claude chance me/data; point scripts/build_model.py, build_similar_corpus.py, build_schools_db.py at it. Rewrite .env.example documenting every env var the code reads, grouped client (VITE_*) vs server, required vs optional, with production notes (D11). Done when: python3 scripts/build_model.py --dry-run (add the flag) finds the data; a test asserts every process.env.X and import.meta.env.X in the code appears in .env.example.

**Step 2. Logout and account-switch isolation (D1).** Do: central clearUserLocalState() in src/lib/session.ts removing every per-user tcm.* key and resetting React state; call it on logout and account deletion. Stamp local profile with ownerId; on login push local data to cloud only when ownerId matches or local data is anonymous and the user explicitly chooses "keep what I entered". Done when: vitest covers (a) logout leaves no per-user keys, (b) user B login never receives A's essays, (c) anonymous intake then signup keeps the data after confirmation.

**Step 3. Netlify ports of account deletion and admin (D2).** Do: netlify/functions/account-delete.ts, admin-*.ts reusing api/_admin.ts logic (server-verified token, role from staff_roles, MFA, assignment scoping) via a shared module. Deletion removes auth user, profiles, documents, consents, uploads rows and storage objects, audits, billing/audit accounting retention is documented, with only necessary de-identified fields retained; choose deletion/pseudonymization deliberately and do not assume nulling user_id removes every identifying field. Fix Account.tsx messaging. Route via config.path only. Done when: unit tests with a mocked Supabase client cover authorized, unauthorized, non-staff and cross-user cases; netlify.toml no longer 404s these paths.

**Step 4. Lock down the review endpoint (D7, D8, D9).** Do: require a valid Supabase session token on every start; per-user daily cap from config/budgets.yaml (default 5) plus the existing per-IP limit; worker accepts only persisted jobs minted by the authenticated start endpoint, with verified owner, valid state/deadline, and authenticated internal dispatch (HMAC or equivalent); signed syntax alone is not proof of job existence or authorization; client polls until the job's server deadline, shows progress, and blocks a second paid run while one is in flight; one expiry constant; one routing mechanism. Done when: tests for anonymous rejection, cap exceeded, forged job id rejected, client continues past 180 s with a fake clock.

**Step 5. Supabase hardening (D10).** Do: migration supabase/migrations/0001_hardening.sql: admin_alerts with security_invoker = true and revoked from anon; has_consent restricted to auth.uid() or staff; unique key so pushDoc upserts; consents written only following the actual corresponding user choice, with purpose/version/time; account creation is not blanket consent to contribution or TU sharing. Done when: migration applies against disposable Postgres/Supabase using the installed supported tooling; real policy checks verify owner, other-user, anon, and staff access. Formatting and mocked client tests may supplement but never substitute for database policy verification. If no database runtime is available, prepare executable integration tests and mark database execution pending.

**Step 6. Layout fixes (D3).** Do: fix nav.mastnav at narrow widths (collapse into a menu) and make audit step tabs scroll or wrap. Done when: Playwright check passes on every route at 390 px and 1440 px: scrollWidth <= innerWidth, no console errors.

**Step 7. Profile readiness (D4).** Do: track confirmed per field; defaults never count. Ready = GPA, current institution, standing, intended major and at least one target confirmed. Done when: tests for empty account (not ready), partial, complete.

**Step 8. CSP (D6).** Do: one CSP source of truth (generate public/_headers from a single definition or keep only netlify.toml); allow https://*.gstatic.com in img-src; keep monogram fallback. Done when: test compares the full policy across files; favicons load in Playwright.

**Step 9. Bundle (D5).** Do: React.lazy + Suspense for Review, SchoolPage, CollegePage, SchoolsIndex, FileFlow, admin, Pricing; lazy-load similar.json, majors.json, intel.json. Leave extra_schools.json for Step 19 if the engine needs it synchronously. Done when: main chunk size reported before/after; landing and signed-out intake work, deterministic preview remains functional, and eager imports do not defeat splitting.

**Step 10. Copy accuracy (D12) and signed-out funnel (D13).** Do: upload copy reflects real behavior per signed-in state; allow signed-out users to start intake and see the deterministic preview; account required to save, upload, or run the audit. Done when: privacy-copy tests updated; Playwright: signed-out visitor reaches a preview.

**Step 11. Phase A gate.** Full suite + Playwright. Update .ai-codex/. Write docs/handoff_phaseA.md.

### Phase B. Data foundation
**Step 12. Pipeline skeleton.** Do: python3 -m pipeline run --stages inventory,normalize,enrich,patterns,comparables,display with idempotent stages, input sha256 caching, checkpoints, DATA_DIR/derived/runs/<date>/manifest.json (git sha, config hash, models, prompt versions, counts, timings). Dependencies: pandas, duckdb, pyarrow, pytest (pin in pipeline/requirements.txt). Done when: python3 -m pipeline run --stages inventory runs twice and the second run is a cache hit.

**Step 13. Inventory and reconciliation.** Do: profile every file in DATA_DIR (rows, columns, fill rates, years, schools, sources, narrative depth, PII-bearing fields, duplicates). Reconcile t25_applicants vs outcomes vs cc_outcomes_all vs ACTIVITY_INVENTORY by record_id and author_id; report distinct applicants, distinct decisions, overlap matrix. Output: docs/source_catalog.md, docs/data_dictionary.md, docs/coverage.md (field x school x year grid), DATA_DIR/derived/runs/<date>/inventory.json. Done when: counts reconcile or every gap is explained; the product's "8,910" and "4,243 admits" claims are confirmed or corrected in copy.

**Step 14. Normalize.** Do: build normalized.duckdb per 3.2. Canonicalize school names (reuse school_canon and the alias map in scripts/build_similar_corpus.py), majors to families, institution types, GPA scale. Keep every row, flag thin, contradictory, or low-confidence ones. Done when: pytest checks row conservation (every raw record maps to normalized or to a logged exclusion with reason), duplicate observations map to canonical decision episodes without erasing status transitions or distinct program/cycle decisions, 10 random rows traced back to raw.

**Step 15. Knowledge files and rubrics.** Do: from ADMIT_SIGNATURES.md, signature/SIG_*.md, TRADITIONAL_SIGNATURES.md, school_advice.json, ec_correlation_by_school.csv, context/ briefs, src/data/intel.json, playbook.json, and the DATASET_FINDINGS block in src/lib/review.ts, write knowledge/rubrics/{activities,essays,coursework,context,school_fit}.md and knowledge/schools/<School>.md. Every rule carries origin (official / observed with n / expert / model) and status (hypothesis, partially_confirmed, confirmed, refuted). Write knowledge/interview_questions.md with the specific questions only Ajay can answer, grouped by rubric. Write knowledge/access_policy.md for specifically owner-identified confidential assets. Do not automatically classify generic credit strategies, school research, or essay guidance as withheld methods. Preserve complete internal analysis and useful user-facing advice; enforce genuine document access restrictions separately. Done when: each rubric has scoring criteria, strong/weak examples, and concrete fixes; supported schools have grounded knowledge files. Missing/thin schools carry explicit coverage states. Do not generate invented school-specific expertise simply to populate every filename.

**Step 16. Enrichment (tagging).** Do: tag activities (from extracurriculars, work_experience, awards, ACTIVITY_INVENTORY) and narratives (essays_narrative, hooks) for: activity type, role/responsibility, duration, scale, counted outcome, field; transfer reason; story tags (athlete, veteran, returning adult, first-gen, caregiver, international, CC route, comeback); context signals present in text. Run on 50 samples with 2 candidate models (or Ollama), produce docs/review_packets/tagging_50.md for Ajay to grade, auto-check agreement between models, pick the best, then run the rest only if the estimated cost is within budget (print estimate first; cap per run). Done when: tags cached per record with model and prompt version; unknown stays unknown; agreement and error stats reported; human assessment stays PENDING until graded. Agreement between models is not ground-truth accuracy and does not justify full-corpus paid execution by itself.

**Step 17. Patterns.** Do: per school, per route, per major family, per year: admit vs deny counts, GPA distributions, activity-pattern shares, story-tag shares, with n, missingness, Wilson intervals, and a "thin" flag under n=30. Label everything "among recorded applicants". Exploratory flags allowed and labeled; formal claims use Benjamini-Hochberg. Output: DATA_DIR/derived/patterns.parquet, src/data/generated/patterns_display.json (allowlisted fields). Done when: 3 worked traces (Cornell, UC Berkeley, Michigan) from a displayed pattern back to raw records in docs/coverage.md.

**Step 18. Comparables.** Do: implement 3.7 in Python (internal, full ranked export comparables_full.parquet with all fields and source refs) and in TS for the app (display index comparables_display.json, allowlisted fields, no usernames or URLs). App returns top 8 by default (config), each with why, differs, not-compared. Done when: determinism test; 10 sample matches written to docs/review_packets/comparables_10.md for grading (PENDING); app shows comparables for a test profile.

**Step 19. Odds validation.** Do: hold out by author and by year (train through 2023, test 2024 to 2026). Compare engine vs official-rate baseline: Brier, calibration buckets, subgroup checks (CC vs 4yr, CS vs non-CS, UC vs private). Document the CS discount's measured effect. If individualized odds are not defensible for a school, show readiness and selectivity tiers with official rates and mark estimates experimental behind a flag. Lazy-load extra_schools.json if the engine can be made async. Done when: docs/DESIGN.md (written before running) + docs/odds_validation.md with results, including failures.

### Phase C. Model infrastructure
**Step 20. _llm.ts and the cost ledger.** Do: per 3.4. Mock provider for tests (deterministic fixtures). Global budget and per-audit cap from config; refuses when exceeded. Done when: tests for budget refusal, schema rejection + one retry, injection fencing (uploaded text saying "ignore previous instructions" has no effect on output schema or tools), timeout handling.

### Phase D. Upload and extraction
**Step 21. Storage and upload API.** Do: Supabase Storage bucket and policies (migration), signed upload URLs, content sniffing (magic bytes), 20 MB per file and 15 files (config), sha256 dedupe. HEIC converted server-side or via a client library; DOCX via mammoth; PDF text via existing pdf.ts; scanned PDFs rasterized for vision. Done when: tests for wrong extension, oversize, duplicate, other user's path rejected.

**Step 22. Fixtures.** Do: generate synthetic fixtures in tests/fixtures/uploads/: clean transcript PDF, phone-photo transcript (skewed, shadowed), rotated scan, two transcripts from different schools, quarter-system credits, W and pass/fail grades, AP credit lines, Common App PDF with 10 activities, activities screenshot, essay DOCX, resume. Each with an expected JSON.

**Step 23. Extraction functions.** Do: extract-start (auth, enqueue) and extract-background (local text first, vision model when needed) returning fields per the Profile schema with per-field confidence and source location (page, bbox or line). Detect conflicts (two GPAs, duplicate activities), unit systems, uncertain grades. Never invent GPA or credit conversions: compute only when the rule is known, else mark unresolved. Done when: mock-mode tests pass on all fixtures; live mode (budget permitting) benchmark of 2 to 3 models: critical-field accuracy (GPA, credits, institution, courses+grades) at least 95% on fixtures, with zero invented GPA or credits; results in docs/extraction_benchmark.md.

**Step 24. Confirm screen.** Do: review UI grouped by section, low-confidence and conflicts first, "confirm all high-confidence" bulk action, inline edit, source preview snippet. Edits recompute odds and comparables instantly. Done when: Playwright: upload fixture, fix one conflict, confirm, profile Ready.

**Step 25. Profile model expansion.** Do: extend Profile with structured activities[] (role, org, description, hours/week, weeks/year, years, scale, outcome), essays[], awards[], courses[] (code, title, grade, units, term, school), highSchool (name, NCES id), context fields, per-field confirmed. Migrate old localStorage and cloud rows forward. Done when: migration tests for old shapes.

### Phase E. Eligibility and context
**Step 26. Eligibility and prerequisites.** Do: per school and major: required vs recommended courses, minimum credits, standing limits, residency rules, deadlines and required materials, from coursespine.json, deadlines.ts, prompts.json, CDS context files, uc_data.json, with source and cycle. Unknown stays unknown with a "verify with the school" note. Done when: tests for UC TAG, a CS prerequisite gap, a standing limit, an unknown.

**Step 27. Context layer.** Do: download NCES CCD (public high schools: FRPL, Title I, enrollment), Private School Survey, CRDC (AP/IB/dual enrollment), College Scorecard (institution context), ACS 5-year ZCTA median income. Build a compact high school search index (src/data/generated/hs_index/*, sharded and lazy-loaded) and a context lookup. Label vintage and proxies (ZIP income is not household income; missing AP data is not proof of no access). Done when: 10 known high schools match source values; missing ones show unknown; record any source access failure in docs/source_catalog.md and continue.

### Phase F. Audit engine
**Step 28. Prompts.** Do: one prompt file per section type in netlify/functions/prompts/, versioned, each with: role, rubric excerpt, school knowledge excerpt, deterministic facts, comparables summary, user materials fenced as data, output schema, rules (quote the student's words, never invent achievements, say what is unknown, give a concrete fix and an example). scripts/preview_prompt.ts renders any section for a fixture profile. Done when: snapshot tests of rendered prompts; token counts logged per section.

**Step 29. Orchestrator.** Do: audit-start (auth, entitlement check for full tier, profile hash, create audit + sections), audit-section-background workers with bounded concurrency, partial-failure handling (retry a failed section once, then mark failed and continue), summary and actions after dependencies, realtime or 2 s polling from audit_sections. Reuse cached sections when the relevant profile slice is unchanged. Done when: mock-mode e2e produces a full valid AuditResult; a forced section failure yields a report that names the failed section.

**Step 30. Live calibration (budget-gated).** Do: run 3 full audits on fixture profiles (Cornell, UC Berkeley, Michigan contrasting cases), report cost per audit and raw timings (first useful section and completion), accounting for extraction/retries separately and in total; allocate the three runs deliberately if comparing two models; describe the limited comparison and do not claim p90 or statistical calibration from three examples. Stop additional paid calls after the three-authorized-audit limit or cost trigger, report results, and continue unpaid development. Prepare 20 varied evaluation inputs and grading sheets, clearly separating authorized real outputs from synthetic/mocked integration outputs. Do not generate 20 paid audits without a revised allowance. Human quality evaluation remains PENDING. Done when: measured numbers recorded in docs/audit_benchmark.md.

### Phase G. Interface
**Step 31. Report UI.** Do: progressive report page: skeletons per section, sections fill as they finish, summary card on top, per-school tabs, activity cards, essay notes with quoted passage and suggested edit, comparables table with why/differs, action plan with dates, missing-data states, failed-section states, export to PDF (extend existing Report). Mobile first. Done when: Playwright screenshots at 390 and 1440 px for preview, full, partial-failure, and empty states; no overflow; keyboard navigable.

**Step 32. Upload UI.** Do: drag and drop, mobile camera capture, per-file progress and status, retry, remove; then the confirm screen from Step 24. Done when: Playwright flow from landing to confirmed profile with fixtures.

### Phase H. Money, persistence, handoff
**Step 33. Stripe test mode.** Do: stripe-checkout (server-side price from config, user id in metadata), stripe-webhook (signature verification, idempotent on event id, writes entitlements), entitlement rules documented in docs/entitlements.md (one purchase = one full audit plus reruns after edits within 30 days, configurable). Browser redirect never unlocks content. Done when: tests with Stripe's webhook fixtures and signature; replayed event does not double-grant; Playwright test-mode checkout path with mocked Stripe.

**Step 34. TU handoff and outcomes.** Do: handoff button on handoff[] gaps and on the summary; consent dialog showing exactly what is shared; creates a case in the admin portal. Outcome reporting prompt after deadlines with consent. Done when: tests for consent required, admin sees the case, user can withdraw.

**Step 35. Pricing page and preview gating.** Do: replace Plus/Counselor waitlists with free preview vs $79 full audit from config/product.yaml; preview shows real value (target overview, top risk, one activity, 3 comparables). Done when: Playwright: free user sees preview and locked sections; entitled user sees full.

### Phase I. Verify and hand off
**Step 36. End-to-end suite.** Do: Playwright against vite preview + netlify dev (or mocked functions): signed-out preview, signup, upload fixtures, confirm, context, free preview, mocked checkout, full audit (mock), export, TU handoff, logout leaves no local data, account deletion, every route at 390 and 1440 px with zero console errors. Done when: integrated critical flows pass; repeat when diagnosing instability or after material changes, not solely to satisfy a repetition count.

**Step 37. Deploy readiness (no deploy).** Do: docs/DEPLOY_NETLIFY.md: env vars, Supabase Site URL and redirect URLs, migrations order, storage bucket, Stripe webhook endpoint, Netlify plan requirement for background functions, post-deploy smoke checks (curl each function, one test audit). Archive functions/ and wrangler.toml to archive/ once Netlify ports pass; keep api/ until the Netlify deploy is verified by Ajay. Draft #/privacy and #/terms marked "DRAFT: owner review required" describing actual processors (Supabase, Netlify, OpenRouter and the actual configured processors, Stripe), storage, and deletion. Done when: a fresh clone following the doc builds and passes tests.

**Step 38. Final report (docs/handoff_<date>.md and in chat):**
- Implemented behavior and where to review it (routes, files).
- Tests run with results; bundle before/after.
- Verified corpus coverage, distinct applicants, and decisions.
- Representative outputs: 3 audits with evidence traces back to official data and raw records.
- Measured generation-only and end-to-end costs, including extraction/retries, raw timings, remaining/reserved budget, and unresolved provider charges.
- Odds validation results vs baseline, including what failed.
- Human assessments and their status (tagging 50, extraction fixtures, comparables 10, planned audit evaluation 20 with only authorized real outputs). Pending grading does not block unrelated implementation.
- Remaining gaps and exact steps for Ajay.

## PART 5. Acceptance targets

| Area | Target |
|---|---|
| Deterministic preview | under 1 s |
| Per-file extraction | under 20 s |
| First audit section | under 15 s after confirm |
| Full audit | about 90 s p50, 150 s p90 |
| Cost | under $1 per full audit (target), measured |
| Extraction | 95%+ critical fields on fixtures, zero invented GPA or credits |
| Tagging | about 90% on 50 graded |
| Comparables | 8 of 10 judged appropriate |
| Audits | 16 of 20 judged client-ready |
| Layout | no horizontal overflow at 390 and 1440 px, zero console errors |
| Security | anonymous calls to paid endpoints rejected; RLS on every table; webhook verified; no secrets in bundle |

Human-graded targets stay PENDING until Ajay grades; they do not block other steps and are never marked passed without grades.

## PART 6. What only Ajay can provide (track in docs/manual_todo.md)
1. OPENROUTER_API_KEY in the worktree .env (needed from Step 23 live mode on).
2. Supabase project URL, anon key, service role key (server only) for live testing; run migrations.
3. Stripe test keys and webhook secret (Step 33 live test).
4. Netlify site and plan decision (background functions).
5. Answers to knowledge/interview_questions.md; fill knowledge/the_line.md.
6. Grade review packets: tagging 50, comparables 10, audits 20.
7. Confirm or replace the authority line; review draft privacy and terms; decide on Reddit-derived data use for a paid product.
8. Approve deploy and live charging when ready.

## PART 7. Stronger implementation and evidence requirements

### Identity and asynchronous safety
Centralize account-owned state. Clear persistent data, memory, queued sync, previews, and active subscriptions on logout/deletion. Stamp ownership at request dispatch and verify it before applying a response. A late response from A cannot repopulate B. Cover empty-cloud-row login, guest draft adoption, existing-cloud-row login, token refresh, multiple tabs, and abandoned requests. Server-side ownership enforcement remains necessary even when the browser disables a button.

### Jobs, quotas, and costs
Use durable atomic per-user quota checks and active-job idempotency. A double click, reload, reconnect, two tabs, or repeated start request must not create a second paid job for the same in-flight operation. Signed worker requests require an existing authorized job and valid transition. Polling/results are owner-scoped.
Define one lifecycle configuration for attempt timeout, retry allowance, total server deadline, polling, and result retention. Client waiting must reflect the server deadline. Preserve section results through reconnects. Treat transient poll failure differently from terminal failure.
The ledger must reserve conservative worst-case cost BEFORE a paid request, including concurrent calls and retry exposure. Reconcile to actual provider usage; uncertain charges stay reserved until resolved. Persist across restarts and all fallback providers. Refuse unaffordable dispatches; do not merely log spending after the budget has already been exceeded. Define per-audit cost as generation plus related extraction/retries and also report components. The $1 breach cannot be undone after provider execution, so use preflight ceilings to reduce overshoot.

### Multi-format extraction quality
Every supported extension needs a functioning local/vision/conversion path, not merely an expanded HTML accept attribute. Check hosting runtime support for native HEIC conversion, PDF rasterization, memory, execution time, and payload limits. Use signed private object references rather than oversized inline requests where needed. Missing converters get an explicit unsupported/fallback state rather than a false success.
Keep extraction proposals separate from confirmed profile values. Preserve field provenance and conflicts. Do not recompute credits or GPA using an assumed grading/unit scheme. Validate wrong-extension files, corrupt documents, rotated scans, two institutions, quarter units, withdrawals, pass/fail, AP lines, and duplicated uploads.

### Corpus integrity and complete outputs
Source-scoped author ids may represent usernames, hashes, or extraction artifacts; verify semantics before treating them as people. Unknown authors must not collapse into a single applicant. Do not merge different platforms without grounded identity evidence. Distinguish source observations, applicant identities, decision episodes, and status history.
Narrative text may be a summary of a post rather than the applicant's actual essay. Label that distinction before building essay claims. Inspect upstream analysis methodology instead of repeating signatures and correlations as facts. Report overlap, contradictions, uncertainty, and sampling selection.
Provide complete restricted internal exports for records, tags, patterns, and ranked comparable results, with raw-reference mappings. Provide concise previews in chat and exact output locations; do not substitute ten sample rows for the dataset. Do not put raw identifying evidence into committed docs. Use restricted evidence packets plus public-safe trace ids.

### Analytics without fabricated confidence
Allow exploratory hypotheses and specific expert advice. Distinguish them from population claims and causal effects. Held-out results on an acceptance-biased corpus do not establish population calibration. Avoid GPA double counting, dependent multiplier stacking, and claiming predictive benefit from statistical significance alone.
A rubric's "confirmed" status requires meaningful validation, not an arbitrary support count. Formal comparisons should consider selection, missingness, multiple testing, and appropriate holdouts. Report failures and alternative explanations. Useful readiness checks and honest qualitative recommendations continue even if the odds model is weak.

### Production contracts and user experience
Runtime schemas must permit missing/failed/skipped sections and distinguish selectivity, readiness, experimental estimates, and validated probability ranges. The static type above is a starting contract, not a mandate to fill unknown values with empty claims. Summary/actions must work with partial evidence and must not wait indefinitely on a failed dependency.
Serve a deterministic guest preview without exposing the raw internal corpus. Keep signed-out drafts separate from prior-account data. Authentication gates must preserve the visitor's work through explicit adoption. Explain loading, progress, failure, quota, and edit consequences in product language.
Entitlements need server-side ownership and an atomic usage/rerun rule, including concurrent requests and changed profiles. Verify Stripe price, currency, payment state, webhook authenticity, event/session idempotency, and user matching. A client redirect or browser tier flag cannot grant access. Reruns within 30 days are a configurable starting offer; define valid scope and measured cost exposure.

### Verification coverage
For each ship blocker, add a test that would fail if the defect returns. Database formatting is not RLS testing, mocked Stripe is not a real test-mode transaction, mocked functions are not deployed routing verification, and mocked model output is not audit quality evidence. State what each check establishes.
Playwright must cover every actual route and important empty/populated/error/loading state, at 390 and 1440 pixels, plus the reported 1280-pixel tab failure. Assert document width, capture unhandled errors and relevant failed requests, and exercise critical user actions. Fix layout causes instead of hiding overflow globally.
Measure initial and deferred JS raw/compressed sizes with consistent build settings. Confirm route lazy-loading under production preview and inspect network waterfalls for accidental eager chunk requests. Handle lazy chunk failures with useful recovery.

### Delivery cadence
Report concise progress at natural boundaries: concrete behavior implemented, commits, commands/results, unresolved dependencies, measured cost, and next work already proceeding. Do not request permission to continue the same authorized assignment. Mark pending reviews honestly and continue.
Finish with a matrix of every numbered step: implemented/verified, implemented but integration pending, mocked only, or blocked with exact owner action. Deliver code, migrations, tests, runbooks, source-backed analysis, full internal exports, and representative reports. Never call the entire system production-ready while deployed checks, live policy tests, or owner legal review remain unperformed.
Begin immediately by validating the worktree and runtime, fixing account isolation and paid-endpoint ownership, and establishing the dependency-safe implementation sequence. Do the work rather than rewriting this brief again.

## PART 8. Overrides and corrections (these win over anything above)

1. Paid budget split ($25 total, enforced by the ledger): extraction benchmark up to $3; tagging sample (50 records, up to 2 models) up to $4; three real full audits up to $3 plus retries; remaining ~$15 held in reserve and not spent without owner approval. Full-corpus tagging is out of scope under this budget; prepare it with a cost estimate in docs/manual_todo.md.
2. Execution order is: Steps 1-11, 12-14, 20 (ledger + model client), 25 (profile schema), 15, 16, 17, 18, 19, 21-24, 26-38. This order overrides the numbering.
3. Resume protocol: maintain docs/progress.md with the step matrix (status: verified / implemented-integration-pending / mocked-only / blocked + owner action), last commit, budget spent and reserved, and the next action. Update it with every commit. A new session reads it first and continues from it.
4. Data sent to any external model excludes author_id, usernames, URLs, and post ids. Use a local join key and merge results back locally.
5. Corrections: PART 5 audit-quality and p90 targets are PENDING owner evaluation and cannot be claimed from 3 runs. PART 6 item 1 (OpenRouter key) is now provided via .env.local. The confidential-asset file is knowledge/access_policy.md, not the_line.md.
6. If Docker or the Supabase CLI is unavailable, write executable RLS integration tests, mark database execution PENDING, and continue.
