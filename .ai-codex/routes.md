# Routes

Hash-based SPA router in `src/App.tsx` (`viewFromHash()` parses `location.hash`, `nav(route)` navigates). No react-router.

## Client routes

| Hash | View | Component | Notes |
|---|---|---|---|
| `#/` | landing | `Landing` | Marketing page |
| `#/check` | check | `Intake` | 3-step profile intake |
| `#/results` | results | `Results` | Chance estimates for all 208 modeled schools. **Gated**: no session → `ResultsGate` (blurred teaser + create-account card); signup stores `tcm.next.v1` = "results" so `handleAuth` returns here instead of the portal |
| `#/pricing` | pricing | `Pricing` | Free / Plus $9 / Counselor $49 (waitlists) |
| `#/login` | login | `Auth` | Local accounts + optional Google sign-in |
| `#/portal` | portal | `Portal` | Signed-in dashboard (redirects to login if no session) |
| `#/review` | review | `Review` | Claude-powered deep application review |
| `#/browse` | browse | `SchoolsIndex` | Directory index of all 4,025 IPEDS schools |
| `#/college/<idx>` | college | `CollegePage` | Profile for any directory school (`idx` = row index in `public/schools.json`); redirects to `#/schools/<id>` when the school is one of the 208 modeled (alias map `featuredIdFor`) |
| `#/schools/<id>` | school | `SchoolPage` | Deep page for a measured school (`id` = `School.id` from model.json) |

## Serverless API (Netlify functions in `netlify/functions/` — the app runs fully client-side without them)

| Route | File | Purpose |
|---|---|---|
| `POST /api/review` | `review.ts` | Start one audit section. Supabase bearer required (`_auth.ts`); body is a typed `AuditRequest` (`src/lib/audit/schema.ts`), never a prompt; answers 202 `{jobId, pollAfterMs, expiresInMs}`. Worker `review-background.ts` claims the job (Blobs conditional write, `_jobs.ts`), builds the prompt server-side, calls the model through the cost ledger (`_llm.ts` / `_ledger.ts`), validates per section, stores the picked fields. Used when `VITE_REVIEW_ENDPOINT` is set at build time; otherwise the browser calls Anthropic directly with the user's own key. |
| `GET /api/review?job=<uuid>` | `review.ts` | `pending` / `done {kind, section}` / `error` — owner only; anyone else gets 404 |
| `POST /api/contribute` | `contribute.ts` (Vercel `api/contribute.ts`, Cloudflare `functions/api/contribute.ts` are ports) | Opt-in outcome contribution; hard-rejects any payload without `consent: true` |

Vercel and Cloudflare deployments have **no** review proxy (retired with the typed contract) — browser-key mode only there. CSP and headers in `netlify.toml` / `vercel.json` / `public/_headers`, kept identical by `tests/csp.test.ts`.
