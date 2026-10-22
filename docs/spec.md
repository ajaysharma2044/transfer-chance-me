# Transfer Chance Me — repository-grounded implementation and launch prompt

> Saved verbatim per §1 ("Save this prompt as docs/spec.md") on 2026-10-17.
> **Lineage:** `docs/spec_v2.md` (first brief, 2026-10-06, carries the early implementation log) → `docs/spec_v3.md` (master execution spec + PART 8 budget split/overrides) → **this file (current execution reference)**. Where they conflict, this file governs; spec_v3 PART 8 still records the owner-authorized paid budget ($25 split) and the external-model field exclusions.
> **Reconciliation:** this review examined `main` @ `538dcb7`; the active branch `claude/transfer-chance-me-impl-2a8520` carries commits beyond it. Finding-by-finding status against the current code is in `docs/repo-audit.md`; live step status in `docs/progress.md` (read first in any new session).

Prepared 17 October 2026. Repository reviewed: https://github.com/ajaysharma2044/transfer-chance-me
Reviewed branch: main. Reviewed commit: 538dcb7874e52111703cd207caab2897c8296101.
This file is the prompt. Give the entire file to the implementation agent with access to the actual repository, configured services, and authorized research data. The assignment below is to implement and verify the product. This review itself did not change application code, deploy anything, charge anyone, or verify the live backend.

## 1. Assignment and execution authority

Take the existing Transfer Chance Me application from its actual current state to a release candidate that real transfer applicants can reliably use. Inspect the checkout first, reconcile changes since the reviewed commit, preserve working features, implement missing functionality, and demonstrate the complete applicant journey on a production-equivalent preview.

Save this prompt as docs/spec.md. Follow CLAUDE.md and .ai-codex/ for repository conventions, except where this brief explicitly replaces outdated product behavior or inaccurate claims. Do not return another specification and stop. Complete all authorized reversible implementation and verification work; commit coherent verified stages without committing credentials, private applicant data, or unrelated changes.

This brief authorizes development, migrations prepared and tested against an isolated environment, synthetic test accounts, test-mode billing, local/browser testing, and release preparation. It does not itself authorize a public production launch, live charges, purchases, unsolicited outreach, or unlimited model spending. Prepare the exact release candidate before asking for any final deployment or commercial approval that is still required. Reuse an existing authorized budget; otherwise prepare mocks and request one concrete capped budget for paid validation. Continue independent work while blocked.

Do not stop after 15 turns or at an arbitrary stage. Maintain a resumable checkpoint when context or runtime limits require it. Ask only genuinely blocking questions, batched with a recommended default. Missing research sources must not stop unrelated product work. New optional ideas belong in docs/ideas.md unless the owner explicitly changes scope.

## 2. What was actually found

Treat these as findings at the reviewed commit, not promises about another branch or live deployment.

| Area | Verified repository state | Consequence |
|---|---|---|
| Stack | React 19, Vite 8, TypeScript 6, handwritten CSS, hash router, Supabase SDK; Netlify, Vercel, and Cloudflare code coexist | Extend the existing app; use Netlify as the release target unless actual deployment evidence supports changing it |
| Main user flow | App.tsx routes into Audit.tsx, which mounts FileFlow, Portal, and Review | Repair this integrated journey rather than building another disconnected intake/report flow |
| Profile gate | Audit.tsx:isProfileScorable requires GPA and major to differ from DEFAULT_PROFILE; actual defaults are 3.8 and cs, despite its comment saying 3.0 | A confirmed 3.8 GPA or CS major can keep an otherwise valid applicant locked out |
| Target list | Audit.tsx counts the tracker list; Review.tsx initializes separate targets from essay mentions or Cornell/UCLA/Michigan | The user can unlock using one list and receive analysis for another |
| Actual AI entry point | Review.tsx:go calls runPanel from src/lib/panel.ts | The older runReview implementation is not the primary execution path |
| Panel transport | panel.ts:callModel treats a successful response as immediate Anthropic-shaped content; it does not follow Netlify's 202 job/poll contract | Queued responses yield empty model text rather than a completed specialist report |
| Worker output contract | review-background.ts calls validateReview, which requires the older full review shape, including strengths and perSchool | Specialist and lead shapes in panel.ts do not satisfy the worker's validator |
| Job authorization | Netlify review POST accepts a browser-composed prompt; GET retrieves by UUID; no account verification or owner association is implemented in those handlers | A UUID is a bearer capability, not account authorization; paid compute and student report access need explicit ownership checks |
| Job concurrency | _jobs.ts reads and deletes prompts; comments acknowledge non-atomic counters and claim races | Duplicate workers, quota consumption, and paid fulfillment need transactional protection |
| Persistence | Supabase schema has profiles and documents; review/panel caches use global localStorage keys; sync errors are often swallowed | There is no durable versioned applicant report history or dependable saved-state UX |
| Authentication | Supabase auth, email confirmation/recovery and Google paths exist, with a local-account fallback | Real production auth must be required by configuration, and live isolation/recovery must be verified |
| Hosting mismatch | Netlify publishes review and contribute only; /api/* falls through to a 404. Account deletion and admin handlers live as Vercel-style api/ functions | Account deletion/admin cannot be assumed to work on Netlify; port or adapt them explicitly |
| Admin gaps | src/components/admin/api.ts explicitly documents missing staff-roster and internal-notes endpoints and no notes table | Complete only essential support paths; hide unfinished controls or implement them truthfully |
| Billing | Pricing.tsx advertises free plus $9/$49 coming-soon waitlists; emails stay on the device; no Stripe implementation in the reviewed tree | No real checkout, payment fulfillment, entitlement, or owner-accessible waitlist exists |
| Uploads | ImportPanel.tsx accepts PDF/TXT, caps at six files and 20 MB each; pdf.ts extracts PDF text and otherwise calls file.text() | Scans, image formats, DOCX and HEIC are not working upload paths just because the brief requests them |
| Upload integrity | Parsed fields are applied directly; awards/school name receive limited overwrite protection; files are saved as transcript text | Add extraction review, typed document kinds, conflicts, and field-level provenance |
| Privacy wording | Some newer views distinguish sync/proxy behavior, but ImportPanel.tsx still says parsed material is never uploaded while calling pushDoc; README says everything stays client-side | Audit every reachable route and align claims with actual processing and storage |
| Probability engine | Fitted path covers 24 school intercepts; heuristic path handles others. Missing non-UC GPA percentiles fall back to median 3.95 | Broad-access schools can receive implausible penalties and text describing an invented median as observed |
| Guarantees | TAG path returns 95% and a "TAG guarantee" after a small subset of checks | Eligibility cannot be certified from GPA, institution type, residency, and standing alone |
| Model judgments | Older review prompt allows the model to adjust numeric odds; prompts contain categorical claims about essays/activities and misuse a high-school/college-GPA correlation | Remove unsupported probability changes and overstatements; preserve useful qualitative advice |
| Corpus | model.json metadata states 8,910 outcomes, 4,243 admits, 24 schools, 2011–2026 | These are artifact metadata; underlying raw counts were not independently reconstructed in this review |
| Comparables | similar.json actually contains 856 compressed people and 2,158 accept/deny entries across 96 school names | This is not 8,910 complete application files, essays, or distinct students |
| Comparable fields | Shipped person fields are only a,d,f,g,i,m,y | No original narratives, stable source IDs, exact source institution, or complete evidence references can be reconstructed from this JSON |
| Model coverage | Runtime assembles 208 school records; extra_schools has 177 entries. intel.json has 21 school entries plus metadata; prompts.json has 14 entries | A searchable school or estimated rate is not a fully researched school/major/cycle |
| Reproducibility | Builders expect sibling ../data/processed, absent from this review checkout; engine.ts references a scripts/fit_admit_model.py absent from the tree | Do not pretend original corpus enrichment or model fitting is reproducible from the repo alone |
| Tests | npm run build passed; npm run typecheck:netlify passed; 260 tests in 11 files passed after build | Existing tests do not establish a working integrated panel, live RLS, billing, or production deployment |
| Clean test prerequisite | Running tests before the build failed because the bundle-secret test requires dist | This observed failure is deterministic missing setup, not proof of an intermittent cold-run defect |
| Lint | Exit 0 with an exhaustive-deps warning at Portal.tsx around line 1271 | Resolve if touched; do not claim a warning-free baseline |
| Bundle | Main JS approximately 1,149.30 kB / 356.09 kB gzip; CSS 184.18 kB / 34.34 kB gzip. PDF chunk and worker are already separate | Measure initial-route loading and split expensive routes/data; do not propose redoing PDF lazy loading as if absent |

The attached historical note reports successful live Supabase login and session persistence after resuming a paused project. Treat that as historical operator evidence only. This repository review did not verify current service health, credentials, migrations, deployment, isolation, or paid-model output.

## 3. Product definition and release boundaries

The product helps a transfer applicant decide where to apply, identify eligibility and preparation gaps, improve actual materials, compare relevant recorded outcomes, and leave with an ordered plan. A useful application audit is the primary output. Percentages are optional where defensible; unsupported numerical precision is not a launch requirement.

The first release must support these jobs:
1. Create an account and return later without losing work.
2. Enter a profile manually or import supported documents and confirm important fields.
3. Select target schools, intended programs, entry terms and cycles once, using one shared target list.
4. Receive an immediate preparation/selectivity preview with explicit coverage and missing inputs.
5. Purchase the configured full audit in test mode and receive access only after server verification.
6. Run a grounded audit with visible progress, meaningful partial results, and recoverable failures.
7. Reopen the exact saved audit, edit inputs, see what is outdated, and rerun within published purchase limits.
8. Export an applicant-safe report, manage account data, and request optional human help through an explicit opt-in.

Separate three milestones: internal implementation complete, limited beta ready, and paid public launch ready. A pending owner policy must not block restricted internal research; unresolved production access controls, misleading claims, failed checkout, or broken reports do block public launch. A free beta may launch without live billing only if all paid CTAs are disabled and its scope is explicit. Do not call that the paid launch.

Default packaging is configurable: free deterministic preview; full audit at $79 one-time. Replace conflicting $9/$49 placeholders. Start with six target programs per purchase, one successful full audit and two user-requested revision reruns within 30 days. This is an editable commercial default, not a research finding. System retries and failed runs never consume a successful-run allowance. State the rules before checkout and enforce them server-side. More targets can be saved, but clearly identify which six are included. Do not silently omit paid targets. Change these defaults if owner instructions already establish different terms.

## 4. Stage A — establish and repair the actual foundation

Read repository instructions, current HEAD, working changes, runtime versions, scripts, data inventory and deployment configuration. Inspect credential presence without printing values. Check whether the available data lives outside the repository before declaring it missing globally. Record external datasets as dependencies without copying private records into git.

Run baseline checks in the correct dependency order: install from lockfile, build, then tests; Netlify typecheck and lint can run independently once dependencies exist. Use npm run build or referenced project typechecks, not bare tsc --noEmit against the empty root config. Add a documented aggregate npm run verify that builds before bundle tests. Preserve existing commands, and repair/document export:signups if its vite-node runtime dependency is unavailable from a clean lockfile install.

Create a short docs/repo-audit.md: verified behavior, file references, reproduced bugs, tests, active host, source availability, unknowns and launch blockers. Recheck all findings above against current code; mark fixed items rather than blindly reimplementing them.

Replace default-value comparisons with explicit field presence/confirmation. Valid 3.8, CS, junior standing or any other legitimate default-valued choice must work. Minimum usable profile: confirmed college GPA and scale, current institution identity/type, standing, intended major or an explicitly chosen undecided pathway, and one target. Optional material remains "not provided," never a zero grade. Migrate old profiles without inventing confirmation; offer one review/confirm action rather than erasing them.

Make the target list shared between tracker, preview, audit, purchase scope and export. Use stable school IDs and per-target college/program/major/term/cycle fields. Remove default Cornell/UCLA/Michigan targets unless explicitly selected by the applicant. Normalize aliases without merging distinct programs such as Columbia GS versus Columbia College or Cornell Dyson versus another college.

Acceptance: browser flow with confirmed GPA 3.8 and major CS unlocks; GPA changes do not silently change confirmation of unrelated fields; zero targets stays locked with a clear explanation; refresh preserves selected targets; audit request contains exactly the displayed purchase targets.

## 5. Stage B — one typed audit execution contract

Repair the panel/worker integration first. Choose one coherent path and retire duplicate production behavior only after the replacement works. Prefer one applicant-facing parent audit job with server-side section scheduling, bounded specialist concurrency, a final synthesis, and durable status. Reuse the existing worker and polling infrastructure where practical. Keeping a monolithic first release is acceptable only if it delivers the required material-level coverage and partial failure handling; a five-call panel is not inherently better.

Do not submit browser-authored system prompts to a publicly funded model proxy. The browser submits structured, schema-validated applicant inputs or a confirmed snapshot ID. The server resolves ownership, target coverage, evidence, entitlement and prompt version, then constructs the trusted instructions. Applicant text, retrieved text, uploaded files and specialist outputs remain untrusted data. Never let documents choose model providers, tool calls, system rules, scores or access privileges.

Define request/result schemas shared by server, client and tests. The worker must validate the actual requested section shape, not require every specialist to return the legacy full ReviewResult. Validate arrays, enums, lengths, school IDs, quote references, numeric bounds and result size. Reject unsupported schema versions. Parse JSON safely; do not cast arbitrary objects to interfaces and declare them valid.

Use a contract along these lines, adapting names to current conventions:

```ts
type SectionState = 'queued' | 'running' | 'complete' | 'not_provided'
  | 'unsupported' | 'failed' | 'cancelled';

type EvidenceKind = 'official_requirement' | 'official_statistic'
  | 'recorded_sample' | 'expert_judgment' | 'model_interpretation'
  | 'user_confirmed' | 'extraction_candidate';

interface AuditSnapshot {
  id: string;
  ownerId: string;
  schemaVersion: string;
  profileVersion: number;
  targetVersion: number;
  materialVersionIds: string[];
  contentHash: string;
  createdAt: string;
}

interface AuditResult {
  id: string;
  snapshotId: string;
  schemaVersion: string;
  status: 'queued' | 'running' | 'complete' | 'partial' | 'failed' | 'cancelled';
  summary: { assessment: string; nextAction: string } | null;
  sections: Record<string, { status: SectionState; errorCode?: string; updatedAt: string }>;
  schools: SchoolAssessment[];
  activities: ActivityAssessment[];
  essays: EssayAssessment[];
  coursework: CourseworkAssessment | null;
  awards: AwardAssessment[];
  comparables: ComparableDisplay[];
  actions: ActionItem[];
  warnings: string[];
  generatedAt: string | null;
}
```

Define the referenced types in code. School assessment includes scope/cycle coverage, eligibility state (meets_checked_requirements, does_not_meet, conditional, unknown), preparation, separate official rates, optional supported estimate, strengths, concerns, source IDs and next actions. Material assessments reference stable input IDs. Actions carry priority, target school if relevant, source finding, realistic due date, effort estimate and dependencies. Store sensitive internal execution metadata separately from applicant-visible payloads.

Create/poll behavior: authorized POST returns 202 with parent job ID and polling hints; authorized GET returns typed status plus completed sections. Persist the job ID so refresh resumes. Support a polling deadline, exponential backoff with jitter and Retry-After, cancellation, retrying only failed sections, and clear terminal errors. A queued response must never be parsed as model output. Render sections as they finish, not only progress labels. Lead failure must not hide completed specialists. A missing essay is not_provided; it is not a failed worker.

Timeouts and retries live in configuration. Distinguish provider rejection, malformed output, configuration absence, network failure, user cancellation and exhausted budget. A single bounded schema-repair retry may be appropriate; avoid overlapping browser, worker and platform retries that multiply charges. Sanitize upstream errors before rendering. Validate the configured provider/model with a small authorized smoke request rather than assuming hard-coded model names still work.

Acceptance: actual deployed Netlify 202 → polling → specialist result → final result flow; malformed specialist result fails only that section; provider timeout yields a recoverable partial report; closing/reopening the tab resumes; duplicate starts do not duplicate billing or successful-run consumption.

## 6. Stage C — identity, persistence, concurrency and deletion

Require verified Supabase authentication for production private operations. The local session mirror is UI state, never authority. Production builds missing backend/model configuration must show a clear unavailable state and fail release configuration checks; never silently substitute a fake local account or require customers to bring an API key. Retain local mode only as an explicitly labeled development mode if useful.

Authenticate review start, poll, retry, cancel, report read/export, upload signing, checkout and account actions. Associate jobs and reports with verified auth.uid(). Guessed or leaked UUIDs must not grant another account access. Return a consistent not-found response for inaccessible resources where appropriate. Keep CORS as a browser control, not authentication.

Use Postgres transactions/RPCs or another already approved durable mechanism for exact job claims, allowance reservations, entitlement creation and idempotency. Current Blobs read/delete is not an atomic claim. Workers must acquire a lease/claim; only the winning attempt may write the authoritative result. Expired worker leases need a documented recovery rule. Authenticate worker invocation and bind it to a known pending job; a replayed worker request must not launch fresh paid calls or overwrite a completed report with an error. Bound the number of simultaneous model calls across a parent job and per account.

Extend schema through numbered migrations, preserving existing profiles, documents, staff roles and audit logs. Suggested logical entities: profile/material versions or immutable snapshots, targets, audits, sections/jobs, purchases, webhook events, entitlements/run reservations, deletion tasks and consent/handoff records. Every applicant-owned row needs RLS and an ownership-preserving write policy; billing entitlements must not be writable by the browser. Raw uploads live in a private bucket, under validated owner prefixes. Staff access must follow existing assigned-case roles and audit semantics.

Persist complete results and immutable input snapshots server-side. Keep enough model/prompt/data version metadata to reproduce why an old report said something. Never silently rewrite historical reports when school data or prompts change. Mark results outdated after material input changes and offer a permitted rerun. Cache only using owner + snapshot/input hash + relevant model/prompt/evidence versions. Prevent cross-account cache reuse.

Fix local/cloud races: complete identity hydration before account-specific writes; do not push account A's local profile into a new account B with no cloud data. Namespace or clear profile, target, document, review, panel, job and API-key caches on account changes. Invalidate pending debounce callbacks on logout/deletion. Show saved/saving/offline/failed status and retry; do not claim "saved to account" after swallowing a failed write. Preserve an unsaved draft safely rather than losing it on a failed sync.

Port existing Vercel-style account deletion and essential admin APIs into Netlify-compatible handlers or add a verified compatibility adapter. Enumerate actual routes and test each through the host router; unit-tested source under api/ is not a deployed Netlify function. Preserve server-side staff verification, recent-auth requirements, assignment restrictions and audit-log protections. Do not weaken them to simplify porting.

Implement two explicit operations: delete applicant data while retaining login, and delete account. Cover documents, private uploads, profiles, targets, snapshots, reports, queued jobs, caches and contributions where applicable to the owner's retention policy. Prevent a running worker or delayed autosave from recreating deleted data. Retry partial failures and explain retained operational/payment records according to the configured policy; do not promise literal deletion of every payment record. Preserve required staff audit history without breaking self-service deletion for ordinary applicants.

Current Blobs expiry is enforced on read and deletion is opportunistic. Add actual scheduled cleanup for abandoned prompts/results if Blobs remains in the architecture; a one-hour timestamp is not proof of physical erasure. Cancel/revoke access promptly and verify eventual cleanup.

Acceptance: account A versus B isolation through UI, API and direct anon-key/RLS probes; expired/forged JWTs; refresh/login/logout; slow hydration versus edits; cross-tab account changes; deletion during an active audit; no data reappears after refresh; storage listing is private; no service credentials in bundle/logs.

## 7. Stage D — import, extraction and confirmation

Use the existing text/PDF extraction before adding new processors. Implement PDF, TXT and DOCX plus PNG/JPG and scanned PDFs through a tested OCR/vision path. Add HEIC only through an actually supported conversion path. If a conversion cannot be shipped in the deployment environment, disable that format visibly with a useful alternative; never accept binary bytes as text or advertise nonexistent support. Do not call the full requested upload scope complete until the supported path works.

Defaults: 20 MB per file, 15 files per profile, configurable total storage/page/pixel/decompression limits. Validate content signatures and MIME; reject corrupt, encrypted, oversize or unsafe inputs with per-file errors. Avoid sending large base64 uploads through function request limits. Use signed private uploads when server processing is necessary. Preserve original authorized files separately from extracted/normalized data. Deduplicate by owner/content hash while allowing intentional versions.

Classify document kind. Do not save every upload as transcript. Track file ID/hash, kind, parser version, pages/locations, extraction confidence, warnings and typed candidates. Preserve candidates separately from confirmed values. Critical fields include institution, term, course/grade/credits, GPA and scale, credit system, academic standing and dates. Handle semester versus quarter units, withdrawals, incompletes, pass/fail, AP/IB/dual enrollment, repeated courses, multiple institutions, A+ scales and cumulative versus term GPA. Transferable-credit totals require school-specific review; do not assume every earned credit transfers.

Present one review screen emphasizing conflicts, low-confidence fields and calculation-critical items. Permit bulk confirmation of unambiguous fields. User-confirmed corrections outrank extraction guesses without overwriting the original evidence. Conflicting transcripts must not be resolved by upload order. Show affected calculations before accepting a change. Unknown stays unknown; calculations must expose assumptions and must not invent grades or a GPA.

Treat uploaded instructions as data. No model may execute embedded requests, reveal other students, change scores on demand or request additional access. Validate output against schema and confirm quoted snippets/locations exist. Do not silently truncate long documents: chunk them or state exactly what was not assessed. Preserve manual entry as a complete working route when extraction fails.

Acceptance fixtures: readable PDF, rotated/scanned transcript, photo with poor lighting, DOCX, TXT, supported HEIC, corrupt file, password-protected PDF, conflicting transcripts, quarter units, P/F/W/AP/repeats, 4.33 scale, document with prompt injection, oversized file, duplicate upload and interrupted upload. Report critical-field accuracy by field and severity; no invented grade/GPA is acceptable even if aggregate accuracy looks high.

## 8. Stage E — school requirements and honest estimates

Build a school/program/entry-term/cycle coverage registry. Distinguish searchable directory coverage, official transfer-rate coverage, verified requirements, current prompts, prerequisite mapping, narrative intelligence and comparable sample coverage. The current 208 engine records, 96 comparable schools, 21 intelligence entries and 14 prompt entries are different denominators.

Store requirements and statistics as versioned structured facts: school/program ID, requirement type, required/recommended, threshold/value, applicability conditions, cycle, source URL, relevant quote/location, retrieved/verified dates, and status. Current official school/program instructions govern current eligibility. Self-reported samples inform sample patterns; expert rubrics inform qualitative interpretation. These roles cannot be substituted for each other.

Prioritize Cornell, Berkeley and Michigan as contrasting full assessments, plus Sacramento State and Cleveland State as broad-access regression cases. Architecture must support other schools; the interface must identify limited coverage rather than inventing full major-level research for all 208. Never charge for six supposedly complete assessments if only three have useful evidence; disclose the available depth before purchase and provide an honest unsupported state.

Replace evergreen month/day countdowns with actual cycles, entry terms, dates, timezone and deadline type. Handle priority versus final, school versus program, rolling versus firm, separate materials dates, deadlines already passed and unannounced cycles. Do not move a missed deadline into next year automatically and imply the current application remains open. Verify current-cycle deadlines and prompts from official sources; if inaccessible, mark unverified and provide a direct official link. Separate source retrieval date from the cycle it describes.

Repair missing-GPA fallback in engine.ts. Non-UC schools with no GPA sample currently inherit 3.95 and can be described as having observed percentiles. Unknown percentiles must remain unknown. Do not make a GPA distribution from selectivity and call it observed. Reproduce the supplied 3.04 GPA / CS / four-year public Sacramento State and Cleveland State scenarios, trace each term, and compare against relevant official rate scope. Do not force a CS individual estimate to equal the overall school rate.

Keep deterministic eligibility, calculations and numeric estimates separate from generative feedback. Remove LLM adjustment of chance percentages and any action plan that claims unsupported percentage-point lifts. All fitted coefficients, heuristic multipliers, caps, tier thresholds and interval construction need documented meaning. In particular, a 45% threshold labeled "Likely" needs replacement or clear reconsideration. A heuristic spread is not a statistical confidence interval.

Review double-counted GPA/major/feeder effects. Preserve an old mandated adjustment as an identified experimental configuration while assessing evidence; do not present it as validated. Default production output to readiness/selectivity tiers plus separately labeled official historical rates when individual calibration is unsupported. Allow experimental numeric estimates only behind an explicit flag with method, scope and limitations.

Fix TAG/other guarantees. California residency is not interchangeable with California community college attendance. Check current approved institution/pathway, entry year, actual major exclusions, credit/subject requirements, prerequisites, deadlines, application steps and continuing conditions. If not all are verified, say "potential pathway; requirements still to verify." Do not turn a partly checked guarantee into a 95% modeled prediction.

Validate meaningful model changes against simple baselines using held-out outcomes, Brier/calibration/discrimination measures and subgroup checks where sample permits. Group by applicant/source and time to prevent a person's different decisions leaking across splits. Reproduce existing fitted model metrics only if training code/data are actually available. Existing JSON metadata is not a rerun. Report failures and selection bias. Prior correction does not establish representativeness or individualized calibration.

Acceptance: three worked school assessments trace to official requirements and available corpus evidence; broad-access schools do not show invented 3.95 observed medians; no LLM changes numeric estimates; unknown prerequisites remain unknown; a passed cycle deadline is shown as passed; TAG cannot be labeled confirmed with unchecked conditions.

## 9. Stage F — authorized corpus, patterns and comparables

Inventory every actually accessible authorized research source, including sibling datasets, supplied exports and expert briefs. Count raw rows, distinct source records, pseudonymous applicants, applicant-cycles, decisions, schools, years, narrative fields, missingness, conflicting records and duplicates. Preserve complete original authorized source data in restricted storage. Keep raw, normalized, enriched and applicant-display layers separate with stable mappings. Never overwrite raw material with anonymized display output.

The repo-only compressed corpus cannot supply missing essays or original citations. Document missing data and exact import steps; do not regenerate narratives, source URLs or identifiers. Do not claim the full 8,910 outcomes were inspected because their count appears in metadata. Distinguish global research corpus from the 856-person display subset and fitted model's 2,891-row training metadata.

Review build_similar_corpus.py carefully: it groups by author, takes median GPA across records, picks modal major/institution, uses most recent year and pools decisions. This can combine distinct application cycles into a synthetic profile. Preserve per-cycle/applicant facts and decision-level provenance; flag uncertain links and contradictions. Keep source namespaces when grouping author IDs. Missing GPA, major, international status, long major names, unresolved school aliases or rare outcomes must not cause silent loss from the internal dataset. Record exclusions from a specific analysis separately from preservation of the source record.

Build an idempotent/resumable pipeline with one documented entry point, configurable input paths and stages, content hashes, versions, checkpoints, exclusion logs and coverage deltas. Keep the existing builder commands as compatible aliases where practical. Fix the absent model-fitting-script reference or restore the actual authorized implementation; never fabricate an equivalent model and report it as the original.

Derive narrative tags only where narratives exist: role, responsibility, duration, scale, observed outcomes, activity type, transfer reasons and supplied context. Draft rubrics before bulk tagging and evaluate a small sample. Unknown is not a negative. Compute patterns with counts, denominators, missingness and alternatives. State "among recorded applicants" rather than population probability. An admit-only activity mix cannot establish which activities cause admission. A near-zero high-school/college-GPA correlation does not demonstrate that high-school results cannot predict admission conditional on other facts.

Similarity must expose matching and differing features, missing fields, cycle, original outcomes, shared targets, similarity method and source references where available. Use configurable meaningful weights; do not call a score calibrated confidence. Current fallback to the whole corpus when strict matches are scarce must be labeled "broader comparison," with discrepancies shown. Best-of-returned score normalization must not imply the top weak match is a perfect match.

Provide an owner/staff-authorized complete ranked export without an arbitrary eight-record internal cap. Export all authorized original fields with stable links to source records and matching explanations. Applicant display is a separate safe projection: default up to eight appropriate examples, no raw private identities/narratives or source links that defeat the owner's display policy. Inspect even compressed public tuples for re-identification risk before continuing public bundling. The owner's production display policy can be integrated independently while restricted research proceeds. Ordinary customers cannot call internal exports.

Acceptance: reproducible count reconciliation; no silent exclusions; applicant-cycle separation test; missingness/export reports; ten similarity review examples with at least eight judged substantively appropriate; empty/sparse cohorts render honestly; no fabricated individual comparables.

## 10. Stage G — audit quality and applicant interface

An audit must analyze the user's actual materials and each purchased target. Do not fill space with generalized praise or repeat the same advice across four specialties. Each major finding explains: observed evidence, why it matters, concrete change, truthful example, confidence/limits and source where relevant.

Activities: assess every supplied activity's responsibility, duration, contribution, coherence and presentation. Use stable activity IDs and show original plus suggested description. Keep work and caregiving meaningful. Use existing real numbers; when details are missing, ask for them or use labeled placeholders. Never fabricate impact, hours, leadership or accomplishments to make an activity look stronger. Do not assume campus involvement always dominates outside achievement merely because it is more common in a selected corpus.

Essays: assess the correct school/term prompt, word/character limit, transfer rationale, specificity, evidence, structure, voice and fit. Reference actual passages and verify literal quotes. Suggest edits/revised examples faithful to supplied experiences. Separate a proposed research lead from a verified school offering. Do not invent professors, resources, student history or program availability. Treat editing depth as configurable; start with diagnostics and examples, permitting deeper editing if the product supports it.

Academics: show confirmed GPA/scale, grade trend only when the underlying sequence supports it, earned versus potentially transferable credits, requirement matches, unresolved equivalencies and school-specific prep. An absent course list means "not assessed," not "missing every prerequisite." Awards should receive individual comments where supplied. Optional context may explain time/opportunity constraints; never infer protected characteristics from names, images or ZIP codes or use them for hidden price/probability changes.

Summary: one clear overall assessment and most consequential next action. School cards: eligibility/prep, separate official historical statistics, selectivity or supported estimates, reasons, concerns and realistic actions. Action plan: ordered by eligibility, deadline and material impact; concrete dates and dependencies, not invented admission lifts. Surface conflicting specialist advice and resolve it against verified facts rather than silently averaging grades.

Build on current light minimal SaaS design, Inter and brand colors. Reuse school tiles and shared components. Keep one clear flow; avoid asking for the same essay/list in multiple places. Support keyboard and screen-reader operation, focus management after errors, sensible labels, responsive layouts around 375/768/1440 px, reduced motion, readable report text and actionable empty/error states. Do not require optional essays before showing deterministic eligibility/prep output.

Applicant report history must display scope, generated date, inputs version, outdated status, completed/missing/failed sections and rerun allowance. Implement print/PDF export with selectable text, proper pagination, sources and honest missing-data states. Keep internal prompts, costs, raw private records and staff notes out of applicant exports. JSON account export should include only the user's own authorized data.

Optional TU handoff asks permission, previews the exact summary/materials to share, and records consent. Do not intentionally weaken the audit to upsell human help. Do not make unsupported authority claims; the repository's mandated "multiple Ivies" line must be substantiated before public display or changed with owner resolution. The build should continue while that marketing claim is pending.

Quality evaluation: prepare 20 varied synthetic or explicitly authorized audits across GPA/major/institution/data-completeness combinations, aiming for at least 16 client-ready in human review. Include weak/contradictory applications and sparse schools, not only impressive files. Provide a rubric and samples without waiting for the owner to create them. Mark human judgment pending until actually reviewed; automated schema success is not human-quality approval.

## 11. Stage H — checkout, entitlements and abuse controls

Implement Stripe test mode behind configuration. Browser requests a server-created Checkout Session using an allowed product/price configuration. Never trust amount, currency, owner ID, allowance count or price from the browser. Bind checkout to a verified user and immutable purchase scope. Block duplicate simultaneous sessions/purchases or explain intentional separate purchases.

Verify webhook signatures on raw request bytes. Store event IDs uniquely and process idempotently. Handle asynchronous payment completion/failure, duplicate/out-of-order events, abandoned checkout, session expiry, refunds and disputes. Grant access from verified payment state; redirect query strings, localStorage or a Checkout success page must not unlock anything. Use a transaction to create entitlement and reserve a successful-run allowance. Resolve the case where payment succeeds before the browser returns and where the browser returns before webhook delivery.

Failed work releases or preserves allowance according to one documented state machine. Concurrent clicks cannot spend the same entitlement twice or produce unlimited paid calls. Persist purchase/entitlement/report associations. Refund and dispute behavior should be explicit and reversible where possible; do not delete student data merely because a payment changes state.

Free preview runs only bounded low-cost work. Server-enforce free allowances and per-user/IP abuse controls with atomic accounting where exactness matters. IP counters alone are insufficient and can penalize shared-campus networks. Put actual hard provider spending limits and account/job cost caps in place. Do not run four full specialists before asking the user to purchase unless measured conversion economics justify it.

Test matrix: completed payment; cancellation; declined/pending payment; forged webhook; forged price; wrong account; duplicate event; out-of-order refund; simultaneous starts; expired session; authenticated access after refresh; failure before/after allowance reservation. No live charges in these tests.

Replace device-only waitlists with an owner-readable durable opt-in record if retaining a waitlist, or remove them. Do not say "we'll email you" if nobody can access the submission. Creating an email record does not authorize unsolicited campaigns.

## 12. Stage I — operations, performance and release

Use one active Netlify deployment path with explicit route mapping and correct environment scopes. Keep useful alternate-host code until the active path works, then document or retire it to avoid contradictory contracts. Essential admin functions: authenticated case/report lookup under existing permissions, job/failure status, audited retry/entitlement repair, consented handoff, and minimal model cost/latency visibility. Hide unfinished notes/roster features or implement schema/endpoints and role tests. Do not build a large CRM as a launch dependency.

Add structured operational events keyed by non-identifying job/correlation IDs: stage timing, provider/model, token usage, estimated versus billed cost when available, retries, failures and queue age. Never log raw essay/transcript text, secrets, student emails or model outputs containing private quotes. Analytics events may include signup, profile confirmation, targets saved, preview shown, checkout started/completed, audit started/partial/complete and export, with duplicate event handling. Keep these separate from model training/marketing consent.

Measure the complete parent audit, not a single specialist. API cost includes extraction/OCR, all specialists, synthesis, retries and failed runs. Start with configurable target of $1 per complete audit. Enforce authorized test/batch budgets. Cache extraction and unchanged section results with correct version keys; do not reuse outdated school requirements. Skip irrelevant specialists rather than requesting a generic missing-material report from a paid model.

Performance targets: deterministic preview under one second once required data is available; first useful AI section within 15 seconds after confirmed inputs; full audit about 90 seconds p50 and 150 seconds p90. Report sample size, input-size distribution, provider, warm/cold conditions and upload/extraction separately. A tiny smoke test cannot establish p90. Record missed targets honestly; use bounded concurrency, smaller scoped prompts and resume/retry before switching providers or adding infrastructure.

Reduce initial JS from the measured ~356 kB gzip baseline. Initial target: under 250 kB gzip for initial-route JS if attainable without compromising working features. Lazy-load admin, audit/report routes and large datasets where beneficial; keep navigation/loading/error fallbacks. PDF is already lazy-loaded. Measure actual network-loaded initial chunks, not just renaming one big file. Avoid unnecessary font subsets. Recheck CSP and worker/OAuth/upload/payment requirements using actual response headers; comments claiming a CSP conflict are not evidence of a present conflict. Test checkout redirects and Supabase connectivity under the deployed policy.

Add CI with clean install → lint/typechecks → build → unit/integration/bundle checks → critical browser E2E. Use synthetic fixtures in git; use server secrets only in protected integration environments. Deployment smoke checks must verify expected API content types/statuses, not accept a 200 HTML SPA as a working endpoint. Add non-sensitive service health checks, uptime/failure alerts, schema migration instructions, backup/restore evidence for persisted student reports and a release rollback procedure.

Create concise operational docs: environment variable names/scopes, active host, migrations, initial owner setup, auth callback URLs, provider/model selection, test/live billing separation, storage/bucket policies, cleanup schedule, budget limits, common failure recovery, release and rollback steps. Update stale README and .ai-codex/ maps to actual behavior. Keep processor/storage descriptions accurate: current review jobs use Netlify Blobs, contribution code separately references Upstash, profiles/documents use Supabase, and models may use OpenRouter or Anthropic. Verify enabled paths before publishing that list; don't introduce a new processor for private records without actual authorization.

## 13. Required verification and launch gates

The following are acceptance requirements, not claims that they already pass.

| Gate | Evidence required |
|---|---|
| Clean checkout | Documented install/verify commands pass from a fresh checkout; build prerequisite is automatic |
| Core applicant flow | Real browser signup/confirmation or equivalent configured test identity → confirmed profile → selected targets → preview → test payment → audit → saved history → export |
| Panel integration | Deployed 202/poll flow and actual section schemas work; no legacy full-review validator mismatch |
| Account integrity | A/B isolation, direct RLS probes, logout/account switch, slow hydration and active-job deletion pass |
| Uploads | Declared formats work; conflict review works; critical fields trace to source; manual fallback remains usable |
| Data claims | Corpus counts/coverage reconcile where inputs exist; missing sources and unreproduced metrics are explicit |
| School facts | Three worked assessments with current official requirements and scoped historical rates; stale dates and unknowns handled |
| Probability honesty | No invented observed percentile, unverified guarantee, model-edited percentage or mislabeled confidence interval |
| Billing | Signed/idempotent webhooks, server price, ownership and concurrent allowance tests pass in test mode |
| Deployment | Account deletion and essential admin functions actually deployed on Netlify, not merely present under api/ |
| Quality | Review samples and grading rubric prepared; required human results recorded honestly; no invented accomplishments or quotes |
| Security/cleanup | Secrets/bundle checks; private storage; report ownership; prompt-injection fixtures; expired-job cleanup and deletion race tests |
| Reliability | Refresh/resume, timeout, provider outage, partial result, retry, duplicate delivery and failed-save recovery work |
| Performance/cost | Actual measured parent-job timing and costs with sample size; targets/misses reported |
| UX | Mobile/desktop and keyboard checks; no dead CTAs, sample target leakage, fake saved state, false privacy copy or raw internal exports |
| Owner readiness | Support path, display/retention policy and commercial terms resolved for public launch; test/live credentials and final deployment approval explicit |

Use meaningful regression and integration tests for the actual defects. Add browser E2E tests because none of the existing 260 unit/integration tests proves the complete paid applicant journey. Do not pad coverage with tests mirroring trivial implementation details. Run the integrated suite after material changes and once at release; rerun further only when a failure or new change warrants it.

Prepare human review sets: 50 available narrative tags with a target near 90% agreement where narrative data exists; at least 10 varied upload fixtures near 95% critical-field accuracy with zero fabricated critical academic values; ten similarity examples with at least eight appropriate; 20 audits with at least 16 client-ready. Define denominators and severity. If required source data is absent, mark that evaluation unavailable and avoid shipping claims dependent on it; continue evaluating the functioning product.

## 14. Execution sequence and final handoff

Implement in dependency order:
1. Baseline, explicit completeness, shared targets and integration regression tests.
2. Typed server-built audit contract, authenticated jobs, durable ownership and atomic claims.
3. Reliable snapshots/sync/history, Netlify route parity and deletion lifecycle.
4. Upload confirmation and school requirement/coverage registry; probability/guarantee corrections.
5. Source-preserving corpus pipeline and honest comparable search as available data permits.
6. Material-level audit quality, progressive UI and applicant-safe export.
7. Test billing, entitlements, quota/cost controls and optional handoff.
8. Full browser integration, operational readiness, measured speed/cost, documentation and release candidate.

Independent reads/checks can be batched. Do not let a corpus rebuild delay fixing broken transport or a missing credential delay writing tests. Do not redesign the landing page before the core flow works. Do not replace the stack or add microservices absent a concrete measured need.

At completion provide:
- Reviewable preview/release candidate and exact commit(s).
- What now works end to end, tied to actual evidence.
- Test commands/results, browser journeys verified and integration environment used.
- Corpus/coverage counts with distinction between metadata and reconstructed data.
- Three sample school assessments and representative complete/partial reports.
- Measured whole-audit cost/latency and initial bundle changes.
- Missing credentials, human evaluations, policies, failed targets and remaining launch blockers.
- Exact minimal owner steps to release, including any required final public deployment/live billing approval.
- A resumable handoff with migrations, commands, versions, checkpoint locations and rollback steps.

Never claim "fully ready" while a launch-critical gate is untested or failing. Never relabel a mock payment, mocked provider, localhost auth test or polished screenshot as a verified production journey. Keep implementing everything the available authorization and inputs permit; bring the owner a concrete release candidate and a precise remaining-dependency list.
