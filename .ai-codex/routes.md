# Routes

Hash-based SPA router in `src/App.tsx` (`viewFromHash()` parses `location.hash`, `nav(route)` navigates). No react-router.

## Client routes

| Hash | View | Component | Notes |
|---|---|---|---|
| `#/` | landing | `Landing` | Marketing page |
| `#/check` | check | `Intake` | 3-step profile intake |
| `#/results` | results | `Results` | Chance estimates for all 31 measured schools |
| `#/pricing` | pricing | `Pricing` | Free / Plus $9 / Counselor $49 (waitlists) |
| `#/login` | login | `Auth` | Local accounts + optional Google sign-in |
| `#/portal` | portal | `Portal` | Signed-in dashboard (redirects to login if no session) |
| `#/review` | review | `Review` | Claude-powered deep application review |
| `#/browse` | browse | `SchoolsIndex` | Directory index of all 4,025 IPEDS schools |
| `#/college/<idx>` | college | `CollegePage` | Profile for any directory school (`idx` = row index in `public/schools.json`); redirects to `#/schools/<id>` when the school is one of the 31 measured (alias map `featuredIdFor`) |
| `#/schools/<id>` | school | `SchoolPage` | Deep page for a measured school (`id` = `School.id` from model.json) |

## Serverless API (Vercel, optional — app runs fully client-side without it)

| Route | File | Purpose |
|---|---|---|
| `POST /api/review` | `api/review.ts` | Proxy for Anthropic Messages API; used when `VITE_REVIEW_ENDPOINT` is set at build time (otherwise the browser calls Anthropic directly with the user's own key) |
| `POST /api/contribute` | `api/contribute.ts` | Opt-in outcome contribution; hard-rejects any payload without `consent: true` |

CSP and headers in `vercel.json` (img-src includes `upload.wikimedia.org` + google favicon service; connect-src includes `en.wikipedia.org`, `api.anthropic.com`).
