# Transfer Chance Me — Implementation Brief

> Saved per the brief's own instruction ("Save this brief as `docs/spec.md`").
> This is the spec of record. The **Reality reconciliation** appendix at the
> bottom records figures verified against the shipped repo on 2026-10-06 — the
> brief asks that actual contents be verified before figures are repeated in
> product copy, so the appendix, not the brief body, is the source of truth for
> counts.

---

## 0. Full internal data access and privacy implementation boundary

The priority is complete access to the data already collected or otherwise authorized for this project. The owner will implement production privacy rules separately. Do not interpret public-display safeguards as limits on what the internal research pipeline may preserve, inspect, analyze, or export.

- Preserve complete original source files and every available field, including full narratives, essays, activities, exact institutions, dates, source identifiers, and original provenance where present in authorized material.
- Never overwrite raw data with an anonymized or simplified version. Maintain raw, normalized, enriched, and display-ready layers separately with stable record mappings.
- Deliver the full machine-readable dataset, complete field inventory, all discovered patterns, missingness and coverage tables, and full ranked comparable-applicant results. Do not return only a summary, eight examples, or selected favorable findings.
- Keep thin, rare, incomplete, rejected, contradictory, and unusual records. Flag them; do not silently discard them. A small sample limits confidence, not access to the observations.
- Preserve optional contextual or sensitive fields already lawfully supplied in the authorized source. Document them separately. Do not infer missing sensitive attributes, require new disclosures, or treat them as justified predictors without evidence.
- Raw excerpts may be used in restricted internal evidence tracing. Public presentation can later use redaction, paraphrasing, aggregation, and access controls defined by the owner.
- Do not withhold useful analysis, recommendations, or available institutional information to force a TU upsell. Protect specifically identified confidential assets through access controls rather than weakening the audit.
- Do not stop internal work to demand a privacy-policy document, blanket anonymization signoff, or a commercial terms review unrelated to the specific operation. If a particular operation has a real access, processing, or disclosure restriction, identify it precisely and continue everything else.
- This authorizes complete use of available project data, not new access to private accounts, bypassing access controls, unauthorized external disclosure, or public release of raw student records.

These instructions override conflicting instructions in this brief and earlier versions about automatic anonymization, rare-record suppression, internal display caps, and privacy-policy approval gates. Build the production display layer separately; do not enable raw applicant exports for ordinary customers.

> **Implementer's boundary note (added 2026-10-06, not part of the original brief).**
> This repository's checked-in `CLAUDE.md` states the corpus contains *real
> student records, some belonging to minors*, and mandates: every table under
> row-level security, the service-role key never shipped to the browser,
> `deleteAllData()` always reachable, and raw private records kept out of
> source control and public assets. Section 0 and those mandates are
> compatible, and both are honored: raw/normalized/enriched layers are kept
> separate, thin and rare records are flagged not dropped, and nothing here
> weakens an existing safeguard. The safeguards above are treated as hard
> constraints, not "approval gates" to route around. Where a specific
> operation (e.g. raw applicant export, or sending student narratives to an
> external model) touches one, it is called out at that operation and kept
> within the access already configured in the repo — not broadened silently.

## 1. Mission and product judgment

Build Transfer Chance Me into a useful automated product for college transfer applicants. Its core experience is a deep, personalized assessment of the applicant's materials against their target schools, grounded in official requirements, available applicant outcomes, and clearly identified expert judgment.

The audience and product identity are fixed. Features, packaging, report structure, pricing, model selection, and implementation details are adaptable. Do not assume the only valuable output is a percentage or a PDF. Use the existing deep-audit direction as the starting point and improve it when evidence or implementation reveals a better solution.

The product should answer:

1. Which schools make sense for me, and why?
2. Am I eligible, prepared, and on time for each school and intended major?
3. What helps or hurts my application, including individual activities, essays, awards, coursework, and transfer reasons?
4. How should my opportunities, responsibilities, and academic trajectory change the interpretation of my record?
5. Which recorded applicants are meaningfully comparable, and what happened to them?
6. What exactly should I change, in what order, before which deadlines?
7. What is known, estimated, missing, or worth verifying directly with a school?

Build for the applicant's decision, not for the appearance of analytical sophistication. A specific prerequisite warning can be more useful than an unreliable probability. A good audit should make a student understand their situation and act differently.

## 2. Autonomy and authority

- Inspect the repository, `CLAUDE.md`, relevant `.ai-codex/` instructions, branch, working changes, data, tools, environment, tests, and deployment setup before making assumptions. Never print secrets.
- This brief supersedes earlier product scope, session limits, and approval gates that conflict with it. Respect actual tool permissions, credential boundaries, and requirements protecting data or unrelated work. Report substantive conflicts; do not treat every old convention as a reason to stop.
- Continue through every stage that can be completed with available inputs. Do not stop after an arbitrary number of turns, at S2, or after writing a design document.
- Ask only for information or authorization genuinely required to proceed. Batch blocking questions and state a recommended default. Continue independent work while waiting.
- Make reversible implementation decisions yourself. Draft rubrics, select technical approaches, improve prompts, add dependencies when justified, and revise schemas without asking for routine approval.
- Integrate new user instructions into the active work. Record optional future ideas separately; do not automatically reject useful corrections as scope creep.
- Use short implementation notes where necessary. Avoid documentation rituals that delay working software.
- Preserve unrelated changes. Commit coherent verified work when repository instructions and available access permit it; never commit private applicant materials or credentials.
- Public launch, live charging, contacting people, and purchases require their own authorization. Build and test these paths now without waiting for launch approval.

## 3. Existing project: inspect and reuse

The earlier brief described the following components. Treat this as a map to verify, not guaranteed current state:

- React 19 and Vite SPA, hash routing in `src/App.tsx`, audit flow in `src/components/Audit.tsx`.
- Chance engine `src/engine.ts`; `src/lib/band.ts`, `blockers.ts`, `actionplan.ts`.
- Upload components `FileFlow.tsx`, `ImportPanel.tsx`; PDF parsing, extraction, essay and coursework helpers under `src/lib/`.
- Similar-profile search and `src/data/similar.json`, reportedly 856 people and 2,158 decisions.
- School intelligence, prompts, coursework data, official baselines, and IPEDS school search files under `src/data/` and `public/`.
- OpenRouter review proxy, JSON guards, cost logging, Netlify background functions and polling.
- Supabase authentication, RLS, deletion, and admin portal.
- Existing build scripts and roughly 260 Vitest tests.

The corpus is reportedly about 8,910 to 10,000 outcomes, not necessarily that many complete applications or distinct applicants. Verify actual contents and reconcile figures before repeating them in product copy.

Reuse working systems. Refactor where necessary, but do not rebuild the entire app to accommodate the specification. Netlify is the preferred deployment target if the current project still supports it. Archive obsolete provider wiring only after verifying it is unused. Preserve useful migration options until the replacement works.

Keep existing commands working where applicable: `npm run dev`, `npm run build`, `npm test`, `npm run typecheck:netlify`, `npm run export:signups`, and `python3 scripts/build_model.py`.

## 4. First priority: foundation defects

Investigate these reported issues and fix those still present:

1. Odds compression: GPA 3.04, CS, four-year public reportedly produces 14–26% for Sacramento State against a 92.6% overall rate and 13–26% for Cleveland State against 100%. Trace major adjustments, missing GPA data, logistic behavior, tier labels, and baseline applicability. An overall rate is not automatically a valid CS baseline. Do not force numerical agreement without relevant evidence. Add regression cases for legitimate high-admit and selective-school behavior.
2. Privacy copy that says writing stays in the browser when backend processing is active. Describe actual behavior accurately.
3. Profile completeness that shows "Fill in" despite required fields being present. Define required fields explicitly.
4. An intermittent cold-run test. Identify and fix the source of nondeterminism if reproducible.
5. Stale architecture instructions, model names, and backend claims. Update affected documentation.
6. Excessive initial bundle size. Measure it and lazy-load large datasets and expensive routes where worthwhile.

Existing discounts and multipliers are hypotheses unless justified. Preserve a previously mandated adjustment initially, document its effect, and flag contradictory evidence rather than silently treating it as statistically correct.

## 5. Data inventory and evidence

Inventory accessible local sources, including `../data/`, processed outcome CSVs, briefs, existing JSON datasets, and supplied expert material. Record rows, distinct applicants, decisions, schools, years, fields, missingness, duplicate risk, source provenance, and available narrative depth.

Produce a concise source catalog, data dictionary, and coverage grid. Then use the findings to adapt implementation and continue. Missing essays should limit essay-pattern claims, not prevent transcript extraction or the entire audit.

Separate:

- Official requirements and published institutional statistics.
- Observed counts and patterns in the recorded sample.
- Expert advice and unvalidated rules.
- Model judgments and inferred interpretations.
- User-confirmed facts and extraction guesses.

Do not flatten this into a universal evidence ranking: official requirements establish eligibility, applicant observations establish sample patterns, and expert judgment can inform qualitative advice. Each has a different role.

Self-reported outcomes are selected, incomplete, and often acceptance-biased. Label sample rates "among recorded applicants." Never present them as population admission probabilities. Use supported weighting or selection corrections where feasible, and explain what remains unidentified. A correction cannot manufacture representativeness.

For important claims, retain traceable evidence references and retrieval dates. Put sources and uncertainty where they help the user assess the result; do not attach distracting metadata to every sentence.

Source acquisition may use available official downloads, APIs, public pages, and authorized exported material. Verify actual access and usage constraints where relevant. One inaccessible source should not freeze the build; record it and continue with alternatives. Do not invent access, scrape results, or source coverage.

## 6. Profile and upload experience

Support confirmed structured profiles with college GPA, credits, standing, institution, intended major, courses and terms, activities, awards, essays, targets, and optional relevant context.

Minimum usable profile: confirmed GPA, current institution, standing, intended major, and at least one target. Missing sections should be marked "not assessed" and remain addable later. Offer immediate useful results with partial inputs.

Support PDF, PNG, JPG, HEIC, DOCX, and TXT through native or conversion paths supported by the environment. Start with limits of 20 MB per file and 15 files; adapt for provider and hosting limits. Validate file contents, not just extensions. Use private storage and safe document parsing.

Prefer local extraction for readable files; use vision or document models where needed. Preserve source locations, confidence, and unresolved fields. Detect conflicting transcripts, duplicate activities, uncertain grades, quarter credits, withdrawals, pass/fail, and AP credits. Never silently invent a GPA or credit conversion.

Show a review screen emphasizing low-confidence fields, conflicts, and calculation-critical values. Allow bulk confirmation of confident fields instead of requiring hundreds of individual clicks. Recompute affected results after edits.

Uploaded text is untrusted content, not an instruction to the system. Validate extraction and audit responses against schemas and defend against prompt injection.

## 7. Rules, corpus enrichment, and comparable applicants

Draft practical rubrics for activities, essays, coursework, context, and school fit from available briefs and expert material. Record their origin and uncertainty. Missing interviews become targeted questions, not a global implementation gate.

Tag available narrative records for activity type, responsibility, duration, scale, demonstrated outcomes, transfer reasons, and meaningful applicant context. Unknown remains unknown. Evaluate a small sample before scaling.

Compute school and route patterns where coverage supports them. Include counts, missingness, uncertainty, and alternative explanations. Pool sparse groups only when substantively justified and label pooled results. Exploratory findings are allowed and must be labeled exploratory. Use multiple-comparison control for formal discovery claims where appropriate; do not require a formal significance test for every qualitative observation.

Similarity should combine relevant academic preparation, major, institution or transfer route, timing, and available narrative features. Make weights configurable and explain why a match is useful. Do not imply omitted or unknown features match.

For internal analysis, preserve every available comparable applicant and its original fields in restricted working data. Do not remove rare records, generalize schools, paraphrase narratives, or cap internal results at eight. Provide a complete ranked export with similarity scores, matching and differing features, source references, missing fields, and all available outcomes. The applicant-facing interface may initially show up to eight examples through a separately configurable display layer. Production display and anonymization policies will be supplied by the owner; their absence does not block internal research or development.

Do not fabricate individual comparables or silently present a composite as a real person. Clearly labeled aggregate examples may supplement sparse individual coverage.

## 8. Academic preparation and context

Build school- and major-specific checks for eligibility, prerequisites, credits, standing, deadlines, prompts, and required materials. Distinguish required from recommended and historical from current-cycle information. Cite authoritative sources and flag ambiguity.

Where reliable data are available, enrich school context with NCES, CRDC, College Scorecard, and Census information. Record vintage and proxy limitations. ZIP income does not establish household income. A missing course record does not prove the student had access to that course.

Optional work, caregiving, income band, first-generation status, and applicant-supplied circumstances may inform qualitative interpretation. Do not require sensitive disclosures to receive useful advice or infer protected traits from names, images, or geography. Do not feed those traits into opaque probability or pricing adjustments.

Use accurate user corrections over erroneous lookups while retaining provenance. Missing context should reduce confidence, not block the product.

## 9. Odds and validation

Keep deterministic calculations separate from qualitative assessments. The model may explain odds and identify missing information; it must not arbitrarily change percentages based on persuasive prose.

Use the most relevant available official baseline: school, college, major, residency, or transfer route where supported. Do not double-count GPA or multiply correlated adjustments as if independent.

Evaluate meaningful model changes against simple baselines using held-out outcomes, calibration, Brier score, subgroup checks, and uncertainty. Split by applicant as well as time where possible; prevent the same person's decisions leaking across training and evaluation. Sparse cells and shifts across cycles require caution.

Held-out performance on a selected self-reported corpus does not establish real-world calibration. Say exactly what was tested. Do not promise the model will beat the baseline or suppress a failed comparison.

If individualized odds are not defensible, implement readiness and selectivity tiers, show relevant official rates separately, and expose experimental estimates only with suitable labeling or behind a feature flag. Continue building the useful parts. Never fake precision to satisfy an acceptance criterion.

## 10. Audit quality and commercial boundaries

Provide concrete advice. Analyze each supplied activity, essay, award, and course issue rather than producing generic praise. For important findings, explain the observed issue, why it matters, the proposed change, a concrete example, and relevant limits.

Activities: assess responsibility, continuity, impact, coherence, and presentation. Give specific description improvements grounded in the student's real accomplishments. Avoid inventing outcomes or encouraging fabricated projects.

Essays: assess prompt fit, transfer rationale, specificity, evidence, structure, voice, and school relevance. Quote relevant user-provided passages and give line edits, direction, and sample revised passages. Keep help faithful to the student's experiences. Do not add a universal full-rewrite ban; implement editing depth as a configurable product choice, beginning with diagnostics and examples.

Do not intentionally degrade advice to create an upsell. Preserve genuinely confidential TU documents and methods through a specific access policy when they are identified. That does not prohibit giving generally available admissions guidance or useful fixes. Offer TU help for execution, complex decisions, and human review, with the user's consent before sharing a summary.

Use clear, direct prose and useful comparisons. Follow verified brand guidance, but avoid arbitrary punctuation linting and unverified authority claims. "Made by students who transferred into multiple Ivies" may appear only if the claim is substantiated.

## 11. Architecture, performance, and cost

Prefer the existing React, Netlify, Supabase, and review infrastructure when suitable. Use deterministic code for eligibility, calculations, lookups, similarity, deadlines, and billing state. Use models for extraction and qualitative reasoning.

Make the corpus pipeline idempotent, cached, resumable, and runnable with one documented command, preferably `python3 -m pipeline run --stages <list>`. Maintain input hashes, model and prompt versions, provenance, checkpoints, and run summaries.

Use local inference only if the available machine and measured quality make it worthwhile. "Local" is not automatically cheap or accurate. Benchmark a small sample against API alternatives and select a practical approach.

Parallelize independent audit sections with bounded concurrency. Reuse extracted materials, retrieval results, and stable prompt blocks. Validate responses, retry selectively, handle partial failure, and update the UI as sections finish. Avoid repeated calls for the same unchanged material.

Targets: deterministic preview under one second; first useful audit section within 15 seconds of confirmed inputs; full audit around 90 seconds at p50 and 150 seconds at p90. Measure upload/extraction separately and report end-to-end timing too. Targets guide optimization and are not permission to pretend slow runs passed.

Start with a configurable $1 per-audit API target. Use any already authorized spending envelope for model tests and small runs; do not ask merely because a model name changes. When no paid allowance is established, prepare dry runs or mocks and request one concrete budget for the remaining paid work. Estimate large jobs before executing them and enforce actual authorized caps. Do not assume this brief authorizes unlimited spending.

## 12. Storage, privacy, and billing

The owner will implement production privacy, retention, anonymization, and applicant-facing disclosure policies. Do not invent additional privacy requirements or make their implementation a prerequisite for internal data collection, research, exports, or analysis. Preserve original authorized source material in restricted working storage and keep cleaned, tagged, and derived data as separate layers. Keep credentials server-side and raw private records out of public assets, source control, and unrestricted logs. Prepare interfaces for later access and deletion controls without claiming production readiness before those controls exist.

Document which processors and storage locations the implementation actually uses. Keep provider configuration explicit. Do not delete source material, redact internal exports, or send private materials to newly selected external processors merely because it is convenient. Source-preserving internal work proceeds now; external processing must remain within the actual authorization provided. Production retention and account-deletion policy is owner-defined and can be integrated later.

Implement free preview and paid access as configuration, not hard-coded product truth. Starting hypothesis: preview includes target overview, top risk, one activity assessment, and up to three comparables; full audit is $79 one-time. Keep pricing, preview depth, and packaging easy to change. Do not spend most paid-model cost before purchase unless the economics justify it.

Build Stripe in test mode with server-verified prices, webhook signature validation, idempotent fulfillment, ownership checks, and clear entitlement rules. Decide and document what one purchase includes, including reruns and edits. Browser redirects alone must not unlock paid content.

## 13. Output contract and interface

Adapt the existing schemas into an `AuditResult` with:

- Summary and the most consequential next action.
- Per-school eligibility, preparation, selectivity or supported estimates, strengths, concerns, evidence, deadlines, and recommendations.
- Individual activity assessments, concrete improvements, and truthful example descriptions.
- Essay diagnostics, referenced passages, school-specific prompt fit, and suggested edits.
- Coursework, grade trend, prerequisite and credit uncertainties.
- Awards and relevant context.
- Comparable recorded applicants or labeled aggregate evidence.
- Ordered actions with realistic dates and effort. Claim numerical admission lifts only when defensible.
- Optional TU handoff, with no forced sharing.
- Internal provenance, model versions, timing, costs, warnings, and section status.

Support progressive results, clear missing-data states, edits, accessible mobile layouts, and export. An incomplete report must say which sections failed or lack inputs. A polished screenshot is not a substitute for working user flows.

## 14. Delivery order and checks

Work in dependency order, overlapping independent tasks when practical:

1. Inspect, establish baseline, and fix foundation defects.
2. Inventory sources and adapt the design to actual coverage.
3. Draft rubrics and build clean corpus, patterns, and comparable search.
4. Build upload extraction, confirmation, eligibility, and context.
5. Build the audit engine, progressive interface, and exports.
6. Implement secure persistence, deletion, test checkout, entitlements, and admin handoff.
7. Verify integrated flows, quality, cost, speed, and documentation.

Begin with Cornell, Berkeley, and Michigan as contrasting evaluation cases if the data support them, then expand coverage. A pilot limits claims, not architecture or useful implementation elsewhere. Do not equate a prestige list with complete school coverage.

Use regression tests for real bugs; schema and fixture tests for extraction; checks for privacy, prompt injection, authorization, and payments; and end-to-end tests for critical applicant flows. Include scanned and rotated documents, multiple transcripts, quarter credits, withdrawals, pass/fail, and AP credit. Use synthetic fixtures in source control.

Run relevant tests after changes and one integrated suite at the end. Repeat suites when diagnosing instability or after material changes, not as a ritual after every stage.

Human evaluation targets: 50 tagging examples around 90% accuracy, at least 10 varied upload fixtures around 95% critical-field accuracy, 10 useful similarity matches with at least eight judged appropriate, and 20 audits with at least 16 judged client-ready. Define denominators and severity of mistakes. High aggregate accuracy cannot hide invented GPA or credits.

Prepare review samples and rubrics without waiting for the user to grade them. Automated checks can establish technical readiness; missing human review remains pending and does not block unrelated implementation. Do not label it passed.

Trace three worked school assessments back to official requirements and available corpus evidence. Investigate negative cases and unsupported recommendations, not only impressive examples.

## 15. Completion and handoff

Keep progressing until available authorized work is completed or a real dependency prevents further progress. Leave a resumable checkpoint for long jobs and context limits.

Report:

- Implemented behavior and where to review it.
- Tests actually run and material results.
- Verified corpus coverage, distinct applicants, and decisions.
- Representative reports and evidence traces.
- Measured costs, timing, and bundle changes.
- Remaining gaps, failed targets, and human reviews still pending.
- Exact minimal steps for missing credentials, data, or launch approval.

Collect opt-in future outcomes and human corrections for ongoing validation. Expert signoff improves quality but does not establish statistical causation. Do not mark a rule "confirmed" merely because 30 selected records support it. Track evidence strength and competing explanations.

Refresh requirements and deadlines when they change, official statistics when released, and corpus-derived outputs after new data or method changes. Distinguish new coverage from real-world changes.

Start now: inspect the actual project, state your main findings briefly, fix the highest-impact verified problems, and continue into the build. Do not return another plan and wait for permission to perform work this brief already authorizes.

---

## Appendix — Reality reconciliation (verified against the repo, 2026-10-06)

Figures the brief quotes "reportedly", checked against the shipped data. Use these, not the brief body, in any product copy.

| Claim in brief | Verified in repo | Notes |
|---|---|---|
| `../data/` sibling dir with processed CSVs | **Absent** | No sibling `../data/` exists from the worktree. `scripts/build_model.py` references `../data/processed` as its input; that input is not present here. The shipped `src/data/*.json` are the build outputs. |
| similar.json "856 people and 2,158 decisions" | **856 people, 2,158 records, 96 schools** (`meta`) | Confirmed. Per-person decision arrays are stored as admit/deny index lists (`a`/`d`), not a `decisions` field. |
| corpus "≈8,910–10,000 outcomes" | **model.json meta: 8,910 rows, 4,243 admits, 24 schools, 2011–2026** | The 8,910 is the T25 study rows behind model.json; distinct from the 856-author / 2,158-record outcome corpus in similar.json. Two different datasets — don't conflate. |
| "OpenRouter review proxy" | **Not present.** `api/review.ts` proxies the **Anthropic** Messages API; review model is `claude-sonnet-5`. | Stale provider name (defect #5). No OpenRouter wiring found. |
| Routes: "43 measured schools" | **208 school entries** total in `MODEL.schools` (24 study + 7 UC appended + 177 extra); **41 banded** (24 study + 17 observed), 167 unbanded. | `.ai-codex/routes.md` "43" and `lib.md`/`schema.md` "31" are both stale (defect #5). |
| "~260 Vitest tests" | **266 tests, 12 files** (after this change added `engine-odds.test.ts`). | — |
| Deployment: "Netlify preferred" | Configs present for **Netlify, Vercel, Cloudflare/Wrangler** simultaneously (`netlify.toml`, `vercel.json`, `wrangler.toml`, `CLOUDFLARE.md`). | Needs reconciliation — brief says archive obsolete provider wiring only after verifying unused. |

### Implementation log

- **2026-10-06 — Defect #1 (odds compression): FIXED & verified.** Root cause: the engine's positional heuristic (`src/engine.ts`) fabricated an elite admit-GPA distribution (median 3.95 / p25 3.83) for any non-UC school lacking published study percentiles, ignoring the observed corpus percentiles the display band already uses. A 3.04 CS applicant then scored ~9σ below an invented median. Fix: prefer `admitSignature()` observed percentiles, else scale the fabricated median off the official admit rate. Result: Sacramento State 17.7%→58.9%, Cleveland State 17.3%→85.0%; selective schools unchanged (UCLA 4.2%, MIT 0.5%). Regression tests in `tests/engine-odds.test.ts`. Full suite 266/266 green; `tsc -p tsconfig.app.json` clean; `npm run build` clean. The mandated CS discount was preserved (flagged as a hypothesis per §4).
- **2026-10-06 — Defect #2 (privacy copy): FIXED & verified.** The app has three data paths — on-device deterministic work, the deep AI review (sends application text to Anthropic whether or not signed in), and signed-in Supabase sync. The old copy ignored the review path and made a blanket "everything stays in your browser" claim (`Results.tsx`) and "never uploaded" claims (`EssayPanel`, `ImportPanel`) that the sync + review behaviour contradicts — the exact thing `CLAUDE.md` forbids. Fix: a single source of truth (`src/lib/privacy.ts`) now carries the accurate three-path wording, used in the Landing FAQ; the misleading inline strings were corrected; the stale `.ai-codex/schema.md` "nothing leaves the browser" note was updated. Guard + content tests in `tests/privacy-copy.test.ts`; verified rendered in the browser preview. Full suite 272/272.
- **2026-10-06 — Defect #3 (profile completeness "Fill in"): FIXED & verified.** `isProfileScorable()` in `Audit.tsx` tested whether GPA/major *differed from the defaults* (3.8 and "cs") as a proxy for "user filled this in", so a real 3.8 applicant or any CS applicant was told to "Fill in" a complete profile. Required fields are now defined explicitly in `src/lib/profile.ts` by presence/validity (valid GPA + institution + standing + major; the target is gated separately by the tracker count). `schoolName` was considered as an "engaged" signal but rejected — the Intake flow lets a user set `institution` via a toggle without `schoolName`, so requiring it would create a new false-negative. Unit tests in `tests/profile-scorable.test.ts`; suite 276/276; tsc clean. Note/tradeoff: an untouched default profile now reads "Ready" (its required fields are all present); a stricter "user-confirmed" gate would need a touched-flag on `Profile` — deferred as out of scope for a defect fix.
- **2026-10-06 — Defect #4 (intermittent cold-run test): FIXED & verified.** The flake was `tests/no-secrets-in-bundle.test.ts`: it scans the built `dist/` for leaked secrets, but `vitest run` does not build, so the result flipped on whether someone built first — green warm, red on a cold checkout / CI (confirmed: the very first suite run in this session failed it). Not RNG/time (three warm runs were stable; the admin-auth tests use real `Date.now()` but with minute-to-hour margins). Fix: a `beforeAll` builds the bundle on demand only when `dist/` is absent, so the security scan is deterministic cold or warm and never silently checks nothing. Verified by deleting `dist/` and running the file cold → green (it rebuilt in ~5s).
- **2026-10-06 — Defect #5 (stale docs/counts): FIXED (docs).** Corrected the `.ai-codex` counts to the verified reality: `routes.md` and `lib.md` said 31/43 "measured" schools, actually **208 modeled** (24 study + 7 UC + 177 `extra_schools.json`); `MARKS` is 208, `DEADLINES` is 157 (was "all 31"); `schema.md`'s `School.gpa` shape was `{p25,p50,p75}`, actually `{p10,p25,p50,p75,p90}`, and it omitted `extra_schools.json` entirely. Also synced `lib.md`'s engine description to the defect-#1 change (observed-corpus percentiles before the rate-scaled estimate) and fixed the `schema.md` privacy-storage note (done with defect #2). No "OpenRouter" references remain in docs; `api/review.ts` is Anthropic. Remaining doc work: none outstanding in `.ai-codex`; `README`/`DEPLOY`/deploy-config reconciliation still pending.
- **Measured (defect #6):** initial JS chunk `index-*.js` = ~1,150 kB (~357 kB gzip), over Vite's 500 kB warning. PDF.js is already split into its own lazy chunk. Candidate for dataset lazy-loading + route code-splitting.

### v3 execution log (now follows `docs/spec_v3.md`)

- **2026-10-07 — v3 spec adopted.** Saved `docs/spec_v3.md` (current execution reference) and `docs/manual_todo.md` (owner-only actions: OpenRouter/Supabase/Stripe keys, $25 budget, grading packets). Validated: `DATA_DIR=/Users/ajaysharma/claude chance me/data` (168 MB) is present and matches the spec (the earlier "no ../data" finding was the worktree); branch `claude/transfer-chance-me-impl-2a8520` clean. v3's D4 confirms my earlier defect-#3 fix was only half right — a default profile now reads "Ready" — to be completed under Step 7 (per-field confirmed tracking).
- **2026-10-07 — Step 2 / D1 (account isolation): FIXED & verified (logic + build).** Logout cleared only the session key, leaving `tcm.profile.v1` (essays/activities/awards), `tcm.list.v1`, `tcm.review.v1`, `tcm.appdocs.v1` in localStorage; and the login-sync effect pushed the in-memory profile into an empty cloud row — writing user A's materials (some from minors) into user B's account. New `src/lib/session.ts`: `clearUserLocalState()` wipes every per-user key (but keeps `tcm.users.v1`, the local-account registry — clearing it would lock users out — and `tcm.waitlist.v1`), plus an owner stamp (`tcm.owner.v1`) and a pure `loginSyncAction()` that returns adopt-cloud / push-local / **reset-local** so A's data is never pushed into B. Wired into `App.tsx` logout + sync effect. Tests: `tests/account-isolation.test.ts` (6, incl. the cross-account reset guard). Suite 282/282; tsc clean. Full App-effect E2E is Step 36 (no DOM harness yet).
- **NEW defect D14 (found during Step 2, not yet fixed):** "Delete my data (login stays)" in `Account.tsx` calls `deleteAllData()` on the cloud but does not clear local material or reset the in-memory profile, so the debounced push effect (`App.tsx`) re-uploads the just-deleted profile ~1.2 s later — the data comes back. Distinct from the D1 cross-account leak; needs App to reset the profile (material-only clear that keeps the session) on data deletion. Scheduled with the account-data hardening around Step 5.
