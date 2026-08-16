# Deploying Transfer Chance Me to Cloudflare Pages

This replaces the Vercel path in `DEPLOY.md`. Same app, same API contracts — the
two serverless handlers in `api/*.ts` are re-implemented as Cloudflare Pages
Functions in `functions/api/*.ts`, and the security headers move from
`vercel.json` into `public/_headers`.

**Nothing in `src/` has to change to deploy on Cloudflare.** `src/lib/review.ts`
still POSTs `{ prompt }` to `/api/review` and still reads `data.content[0].text`.

---

## 0. What you are deploying

| Piece | Where it runs | Source |
|---|---|---|
| The React SPA | Cloudflare's CDN, static | `dist/` (built by `npm run build`) |
| `POST /api/review` | Cloudflare Worker, on demand | `functions/api/review.ts` |
| `POST /api/contribute` | Cloudflare Worker, on demand | `functions/api/contribute.ts` |
| CSP + security headers | Cloudflare's CDN | `public/_headers` → `dist/_headers` |
| SPA fallback | Cloudflare's CDN | `public/_redirects` → `dist/_redirects` |

Two structural rules that are easy to get wrong:

- **`functions/` lives at the repo root.** Cloudflare compiles it automatically;
  it is not part of the Vite build and never enters `dist/`.
- **`_headers` and `_redirects` live in `public/`, not the repo root.**
  Cloudflare reads them from the *build output*. Vite copies `public/*` into
  `dist/` verbatim, so `public/_headers` is the only correct home. A `_headers`
  at the repo root is silently ignored — you get no CSP and no warning.

---

## 1. Add the files

Create these (contents supplied alongside this document):

```
functions/api/_shared.ts          CORS, rate limit, body cap, env types
functions/api/review.ts           POST /api/review
functions/api/contribute.ts       POST /api/contribute
public/_headers                   CSP + security + cache headers
public/_redirects                 SPA fallback
wrangler.toml                     local dev + optional bindings
.nvmrc                            pins Node 22 for the Pages build
scripts/check-bundle-secrets.sh   post-build secret leak check
```

`functions/api/_shared.ts` is imported by the other two and is **not** an HTTP
route: Cloudflare only creates a route for a module that exports an `onRequest*`
handler, and `_shared.ts` exports none.

## 2. Add `.dev.vars` to `.gitignore` — do this before anything else

The current `.gitignore` ignores `.env*` but **not** `.dev.vars`, which is the
file Wrangler uses for local secrets. Append:

```gitignore
# Cloudflare local secrets and build cache — never commit
.dev.vars
.dev.vars.*
.wrangler/
```

If you skip this you will eventually commit your Anthropic key.

---

## 3. Create the Pages project

1. Go to <https://dash.cloudflare.com> and sign in.
2. In the left sidebar open **Workers & Pages** (newer accounts nest this under
   **Compute**).
3. Click **Create application** → the **Pages** tab → **Connect to Git**.
4. Authorise GitHub if prompted, then pick **`ajaysharma2044/transfer-chance-me`**
   and click **Begin setup**.
5. Fill in the build settings exactly:

   | Field | Value |
   |---|---|
   | Project name | `transfer-chance-me` |
   | Production branch | `main` |
   | Framework preset | **Vite** |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory (advanced) | leave blank |

6. Still on this screen, expand **Environment variables (advanced)** and add
   **`NODE_VERSION` = `22`**. Vite 8 and TypeScript 6 do not run on the older
   Node that some Pages projects default to; the committed `.nvmrc` covers this
   too, and setting both is belt-and-braces.
7. Click **Save and Deploy**. The first build takes 1–2 minutes and gives you
   `https://transfer-chance-me.pages.dev`.

At this point the site works in **browser-key mode** — exactly today's behaviour,
each visitor supplying their own Anthropic key. Nothing below is required for
that; the app degrades cleanly with zero cloud config.

---

## 4. Environment variables and secrets

**Project → Settings → Variables and secrets → Production → Add.**

Each entry has a **Type**: `Text` or `Secret`. Choose `Secret` for anything
sensitive — it is encrypted at rest and masked in the dashboard.

### The one rule that keeps secrets out of the browser

Vite inlines **only** variables prefixed `VITE_` into the public JS bundle.
Anything else is invisible to the browser and readable only inside `functions/`
via the `Env` binding.

> Cloudflare Pages injects variables into **both** the build environment and the
> Functions runtime — unlike Vercel, there is no separate "build only" scope. The
> `VITE_` prefix rule, not the dashboard scope, is what stops a key from reaching
> the bundle. **Never prefix a server secret with `VITE_`.**

### Build-time — compiled into public JS, treat as public

| Name | Type | Value | Notes |
|---|---|---|---|
| `NODE_VERSION` | Text | `22` | Build toolchain only |
| `VITE_REVIEW_ENDPOINT` | Text | `/api/review` | Switches the app into proxy mode. Omit to stay in browser-key mode. |
| `VITE_GOOGLE_CLIENT_ID` | Text | `…apps.googleusercontent.com` | Public by design (OAuth client IDs are) |
| `VITE_SUPABASE_URL` | Text | `https://<ref>.supabase.co` | Public |
| `VITE_SUPABASE_ANON_KEY` | Text | `eyJ…` | Public **by design** — it is safe only because Row Level Security is on. Ship it with RLS enabled on every table. |

### Runtime — Functions only, never reaches the browser

| Name | Type | Value | Required for |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **Secret** | `sk-ant-…` | `/api/review` |
| `ALLOWED_ORIGIN` | Text | `https://transfer-chance-me.pages.dev` | both endpoints |
| `SUPABASE_URL` | Text | `https://<ref>.supabase.co` | `/api/contribute` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | `eyJ…` | `/api/contribute` |
| `UPSTASH_REDIS_REST_URL` | Text | optional | legacy contribution store |
| `UPSTASH_REDIS_REST_TOKEN` | **Secret** | optional | legacy contribution store |

`SUPABASE_URL` is deliberately duplicated (`VITE_SUPABASE_URL` for the browser,
plain for the Worker) — the browser copy is public, the Worker copy is not, and
keeping them separate stops anyone from "simplifying" by adding `VITE_` to the
service-role pair.

`ALLOWED_ORIGIN` accepts a comma-separated list, which you will want because
Pages always gives you at least two hostnames:

```
https://transferchance.me,https://transfer-chance-me.pages.dev
```

Add the Preview environment separately (**Settings → Variables and secrets →
Preview**) if you want preview deployments to work; preview builds get their own
`*.pages.dev` subdomain per branch, so either list them or leave `ALLOWED_ORIGIN`
unset there.

8. After adding variables, redeploy: **Deployments → the latest one → ⋯ →
   Retry deployment**. Pages does not apply new variables to an existing build.

---

## 5. Turn on proxy mode (optional but recommended)

Setting `VITE_REVIEW_ENDPOINT=/api/review` moves the Anthropic key off your
visitors' machines and onto your server. Two things follow from that, and neither
is optional:

- **The UI still asks for a key.** `src/components/Review.tsx` shows the "One-time
  setup: your AI key" card and disables the Run button until a key is saved.
  `src/lib/review.ts` already exports `proxyMode` for exactly this: change the
  gate to `disabled={busy || (!proxyMode && !key)}` and wrap the key card in
  `{!proxyMode && !key && …}`. See `DEPLOY.md` step 10.
- **Several on-page promises become false.** The Review page says materials go
  "never to us" and there is "no middleman server". In proxy mode they pass
  through your Worker. `DEPLOY.md` §4 has the exact file/line table. The
  PDF-parsing promises stay true (parsing is still client-side; only the
  assembled prompt is sent) — reword them precisely rather than deleting them.
  `functions/api/review.ts` stores nothing and logs nothing; keep it that way and
  the corrected wording stays honest.

---

## 6. Optional: contribution storage in Supabase

`/api/contribute` returns **501** until a store is configured, so you can leave
this until the consent UI exists. When you are ready, run this in the Supabase
SQL editor:

```sql
create table if not exists public.contributions (
  id              uuid primary key default gen_random_uuid(),
  payload         jsonb       not null,
  consent_version text,
  created_at      timestamptz not null default now()
);

-- RLS on, and DELIBERATELY no policies. With RLS enabled and zero policies, the
-- anon and authenticated roles can do nothing at all. service_role bypasses RLS,
-- so the only writer is the Pages Function holding SUPABASE_SERVICE_ROLE_KEY.
alter table public.contributions enable row level security;
revoke all on public.contributions from anon, authenticated;
```

Then set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (step 4) and redeploy.

**Do not wire this to any UI until the consent checkbox, the corrected copy, and
a published privacy policy all exist.** The endpoint hard-rejects anything
without a literal `consent: true`, but that check protects you from accidents,
not from shipping a flow that collects transcripts without saying so.

### Consent is not yet revocable — a known gap

The stored record contains no user id, which is good for minimisation and bad for
revocation: with nothing linking a row to a person, you cannot honour "delete my
contribution". Closing that means storing a Supabase `auth.uid()` alongside the
payload — which re-links an essay to a named account and raises the stakes on the
table above. Decide that deliberately before launching contributions; the handler
accepts an optional `consentVersion` string today so you can at least record
*which* consent text a person agreed to.

---

## 7. Optional: a real rate limit

The functions ship with an in-memory token bucket (5 requests/minute per IP).
Be clear-eyed about it: Cloudflare runs many isolates across many locations, so
the effective global limit is *(5 × number of live isolates)*. It stops one
client hammering one location and nothing more.

Two upgrades, in increasing order of strength:

- **KV-backed counter (code already supports it).** Create the namespace, then
  bind it in **Settings → Bindings → Add → KV namespace**, variable name
  `RATE_LIMIT`. Global, but eventually consistent, so a simultaneous burst across
  regions can still overshoot.
  ```sh
  npx wrangler kv namespace create RATE_LIMIT
  ```
- **Cloudflare WAF rate-limiting rules** (dashboard, no code): your domain →
  **Security → WAF → Rate limiting rules**, matching `URI Path starts with
  /api/`. This runs before your Worker, so blocked requests cost nothing, and it
  is the only option here that is actually a hard limit.

---

## 8. Custom domain

**Project → Custom domains → Set up a domain.** If the domain is already on
Cloudflare, DNS is created for you; otherwise follow the CNAME instructions
shown. Afterwards update `ALLOWED_ORIGIN` to include the new origin and redeploy.

---

## 9. Verify the deployment

Replace `<host>` with your Pages URL.

```sh
# 1. Security headers are present (proves _headers landed in dist/, not the root)
curl -sI https://<host>/ | grep -i 'content-security-policy'

# 2. Proxy works end to end -> JSON containing content[0].text
curl -s -X POST https://<host>/api/review \
  -H 'content-type: application/json' \
  -d '{"prompt":"Say ok."}'

# 3. A disallowed origin is refused -> 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<host>/api/review \
  -H 'content-type: application/json' -H 'origin: https://evil.example' \
  -d '{"prompt":"x"}'

# 4. Rate limit trips -> a 429 within the first several calls
for i in $(seq 1 8); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST https://<host>/api/review \
    -H 'content-type: application/json' -d '{"prompt":"Say ok."}'
done; echo

# 5. Contribute refuses without consent -> 403
curl -s -X POST https://<host>/api/contribute \
  -H 'content-type: application/json' \
  -d '{"profile":{},"materials":{}}'

# 6. SPA fallback -> 200 and HTML
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/some/deep/path
```

Then, in a real browser with devtools open:

- **Upload a PDF transcript.** The CSP in `vercel.json` has never actually run in
  production (nothing was deployed), so this is the first time it is being
  exercised. pdf.js loads its worker from a same-origin bundled URL, which
  `worker-src 'self'` covers — but verify rather than assume.
- **Click Sign in with Google**, if `VITE_GOOGLE_CLIENT_ID` is set.
- **Confirm the console has zero CSP violation errors.** Any `Refused to …`
  message names the exact directive to widen in `public/_headers`.

---

## 10. Local development

```sh
# Closest to production: build, then serve dist/ + functions/ together on :8788
npm run build
npx wrangler pages dev

# Secrets for local runs go in .dev.vars (gitignored, never committed):
cat > .dev.vars <<'EOF'
ANTHROPIC_API_KEY=sk-ant-…
ALLOWED_ORIGIN=http://localhost:8788
EOF
```

`wrangler pages dev` serves the built output, so there is no HMR — rebuild to see
changes. For UI work keep using `npm run dev` on port 5199 (which has no
`/api/*`, so the app falls back to browser-key mode, exactly as intended) and
switch to `wrangler pages dev` when you need to exercise the Functions.

### Optional: type-checking `functions/`

`npm run build` runs `tsc -b`, which only covers `src` and `vite.config.ts`, so
`functions/` is **not** type-checked today. Wrangler bundles it with esbuild,
which strips types without checking them — a type error there ships silently. To
close that:

```sh
npm i -D @cloudflare/workers-types
```

Add `tsconfig.functions.json`:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["functions"]
}
```

then reference it from `tsconfig.json` alongside the existing two. If you do
this, delete the locally-declared `EventContext` / `KVNamespaceLike` types at the
top of `_shared.ts` and import Cloudflare's instead. Until then the local types
are what keep `functions/` dependency-free and the build unaffected.

---

## 11. Vercel and Cloudflare coexistence — pick one

If you add the Cloudflare files without removing the Vercel ones, the repo ends
up with two deployment systems and, more dangerously, **two copies of the CSP**
that will drift. Concretely:

| File | Cloudflare | Vercel |
|---|---|---|
| `functions/api/*.ts` | the live API | ignored |
| `api/*.ts` | ignored | the live API |
| `public/_headers`, `public/_redirects` | the live config | copied into `dist/` and served as public text files |
| `vercel.json` | ignored | the live config |

Neither ignored file breaks the other platform, and `_headers` contains no
secrets — but a CSP fix applied in one place and not the other is a real bug that
only shows up in production on one host.

**Recommended — clean cut.** Once the Cloudflare deployment is verified:

```sh
git rm -r api vercel.json
```

and replace `DEPLOY.md` with a one-line pointer to this file. The `@vercel/node`
devDependency can go too:

```sh
npm uninstall @vercel/node
```

**If you must keep both** (e.g. Vercel as a fallback during migration), write the
rule down in `CLAUDE.md`: *`public/_headers` is the source of truth for the CSP;
`vercel.json` is regenerated from it by hand and must never be edited alone.*
Also keep `api/*.ts` and `functions/api/*.ts` behaviourally identical or the two
hosts will answer the same request differently.

---

## 12. Caveats you should know before launch

1. **Long reviews may hit Cloudflare's edge timeout.** A 6000-token review can
   take 60–90 seconds, and Cloudflare gives up on a request that has produced no
   response in roughly 100 seconds (HTTP 524). The Function aborts upstream at 85
   seconds and returns its own readable 504 first, so you get a real error rather
   than a Cloudflare error page — but if timeouts show up in practice, the fix is
   to stream: ask Anthropic for `stream: true`, pass the SSE through, and
   accumulate in `src/lib/review.ts`. That is a client change, so it is out of
   scope here, but it is the actual solution. Lowering `MAX_TOKENS` buys time
   cheaply in the meantime. *(The Vercel path had the same problem, worse — Hobby
   functions cap at 10s.)*

2. **The origin allow-list is not authentication.** CORS is enforced by browsers.
   `curl` can omit or forge `Origin` at will, so `ALLOWED_ORIGIN` raises the bar
   against your endpoint being embedded on someone else's site; it does not stop
   a determined person spending your Anthropic credit. The real controls are the
   WAF rule in step 7 and, best, requiring a verified Supabase session JWT in
   `functions/api/review.ts` once Supabase auth is live.

3. **Free-plan limits.** Cloudflare Pages Functions on the free plan allow
   100,000 invocations/day, and each invocation has a CPU-time budget (waiting on
   `fetch` does not count against it). The proxy is nearly all I/O, so it is well
   inside budget; the PII scrub in `/api/contribute` is the CPU-heaviest thing
   here. If you ever see error 1102, lower `MAX_BODY_BYTES` in `contribute.ts` or
   move to the paid plan.

4. **The model is pinned in two places.** `functions/api/review.ts` and
   `src/lib/review.ts` both name `claude-sonnet-5`. Change both together or proxy
   mode and browser-key mode will silently produce different results at different
   cost.

5. **Supabase custom domains bypass the CSP.** `https://*.supabase.co` does not
   match a custom Supabase domain. If you configure one, add it to `connect-src`
   in `public/_headers`. Note also that `wss://*.supabase.co` is listed
   separately on purpose — an `https://` source does **not** authorise a
   WebSocket connection, so Supabase Realtime needs its own entry.

6. **Check every build for leaked secrets.**
   ```sh
   npm run build && ./scripts/check-bundle-secrets.sh
   ```
   Consider adding it to `package.json` as `"build": "tsc -b && vite build &&
   ./scripts/check-bundle-secrets.sh"` so it cannot be forgotten. It greps `dist/`
   for Anthropic key prefixes and service-role references and fails the build if
   it finds any.

7. **Unknown `/api/*` paths return `index.html` with status 200.** The SPA
   catch-all in `_redirects` is reached only after Functions and static assets
   miss, so real endpoints are unaffected — but a typo'd API path gets HTML
   instead of a JSON 404. Cosmetic; worth knowing when debugging a client fetch
   that "succeeded" but returned HTML.
