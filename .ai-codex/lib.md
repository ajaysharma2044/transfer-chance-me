# Library signatures

## src/engine.ts — the chance engine (heart of the product)
- `MODEL: { meta, schools: School[] }` — model.json (24) + 7 UC campuses from `src/data/uc_data.json` + 177 CDS-researched schools from `src/data/extra_schools.json`, all appended at module load (**208 schools total**)
- `TAG_CAMPUSES: Record<string, number>` — UC TAG min GPAs (Davis 3.2, Irvine 3.4, Merced 2.8, Riverside 2.7, Santa Barbara 3.4, Santa Cruz 3.0)
- `estimate(profile: Profile, s: School): Estimate` — baseline = official rate × logistic GPA-position factor × multipliers (CA-CC→UC ×1.5, IGETC ×1.15, UC junior gate ×0.25, CS/eng: ×0.35 at UCs / ×0.55–0.65 at rate<15 schools / ×0.75 elsewhere (reporting-bias discount — CS success stories over-reported vs actual seats; user-mandated, keep harsh), business ×0.4 UC / ×0.75, veteran hooks, essay named ×1.3, PTK ×1.12, honors ×1.08, gpaTrend ×1.08/×0.9, ecLevel campus ×1.05 / national ×1.08). TAG early-return: CA-CC junior meeting min GPA → p=0.95, tier "TAG guarantee". Schools with no published study GPA range take observed admit percentiles from the outcome corpus (`admitSignature`, ≥8 admits) when available, else estimate position from the official admit rate (UCs keep their own rate-scaled estimate); only the rate-scaled fallback is labeled "estimated". `src/data/extra_schools.json` (CDS-researched additions) appends after the UC loop — same null-GPA shape.
- `estimateAll(profile): Estimate[]` — sorted descending by p
- `fmtPct(x: number): string`

## src/lib/review.ts — deep-review mode + key
- `REVIEW_ENDPOINT`, `proxyMode: boolean` — true when `VITE_REVIEW_ENDPOINT` set; else browser-direct with user key
- `getApiKey() / setApiKey(k)` — localStorage `tcm.apikey.v1`
- re-exports `intelLines(name)` from `src/lib/intel.ts` (T25 field notes per school; Node-safe, used by the worker too)

## src/lib/panel.ts — the review panel (4 specialists + lead)
- `SPECIALISTS`, `runPanel(input, onProgress?, signal?, transport?) → PanelResult` (cached `tcm.panel.v1`); one `auditId` per run; `toAuditProfile(profile)` strips Profile to the wire fields; `defaultTransport()` = proxy (POST → 202 → poll, Supabase bearer) or direct (user key)

## src/lib/audit/ — the typed audit contract (docs/spec.md §5; shared with netlify/functions)
- `schema.ts` — `AuditRequest` (schemaVersion 1, kind specialist|lead, structured `AuditInput`; never a prompt), `parseAuditRequest(body)` (size caps, 1..MAX_INCLUDED_TARGETS targets, optional UUID `auditId`), `validateSection(kind, json)`, `pickSection`, `parseModelJson`, `LIMITS`
- `prompts.ts` — `buildSectionPrompt(req, fence)`: brief built by whoever runs the model; applicant text is the one fenced block; odds from `buildPlan` (engine), never model-set; `untrustedText(req)` for injection screening; `SECTION_MAX_TOKENS`
- `client.ts` — `proxyTransport({endpoint, getToken})`, `directTransport(getKey)`, `AuditError{code: auth|config|rate|server|invalid|expired|aborted}`

## src/lib/extract.ts
- `extractProfile(raw: string): Extraction` — regex extraction from transcript/app text: GPA, SAT, credits→standing, institution (CA-CC name roster first), PTK, honors, IGETC, veteran, major, courses

## src/lib/essay.ts
- `analyzeEssay(raw: string): EssayAnalysis` — word-boundary school/program token matching, professor mentions, fit-vs-complaint scoring, verdict

## src/lib/auth.ts
- `signUp / logIn / getSession / setSession` — local-device accounts, SHA-256 salted (`tcm-v1:${email}:${password}`) via crypto.subtle; stores `tcm.users.v1`, `tcm.session.v1`

## src/lib/googleAuth.ts
- `googleEnabled: boolean` (gated on `VITE_GOOGLE_CLIENT_ID`); `mountGoogleButton(el, onSession)` — Google Identity Services

## src/lib/schools.ts
- `MARKS: Record<name, SchoolMark>` — color/mono/word/domain for all 208 modeled schools
- `logoUrl(name, size=64)` — Google favicon service (`s2/favicons?domain=`); never ship trademarked logo files
- `markOf(name): SchoolMark` — with monogram fallback

## src/lib/directory.ts
- `loadDirectory(): Promise<DirSchool[]>` — cached fetch of `/schools.json` (4,025 rows)
- `searchDirectory(all, q, limit=12)`; `KIND_LABEL`, `SIZE_LABEL`

## src/lib/deadlines.ts
- `DEADLINES: Record<school, {month, day, note?}>` — 157 schools (UCs Nov 30, TAG Sep 30 notes)
- `countdown(school, from?): Countdown | null` — next-occurrence day math

## src/lib/pdf.ts
- `fileToText(file: File): Promise<string>` — lazy-loads pdfjs-dist; 20MB cap enforced by ImportPanel

## src/hooks/useReveal.ts
- `useReveal(deps?)` — IntersectionObserver adds `.in` to `.reveal` elements (threshold 0.15)
