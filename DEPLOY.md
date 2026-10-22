# Deploying to Vercel (static app + contributions only)

**The deep-audit proxy is not on Vercel.** `/api/review` lives in
`netlify/functions/` (see `NETLIFY.md`): it needs a background function with a
15-minute budget, a job store, and Supabase-session authentication, none of
which a synchronous Vercel function provides. The old `api/review.ts` — one
prompt, one reply, with the model asked to set per-school odds — was retired
with the typed audit contract (`docs/spec.md` §5).

A Vercel deployment therefore serves the static app in **browser-key mode**
(each visitor's own Anthropic key, straight from the browser) plus
`api/contribute.ts`. Leave `VITE_REVIEW_ENDPOINT` unset here; setting it would
point the app at an endpoint this host does not have.

## 1. One-time setup

1. Create a free Vercel account (Hobby is enough).
2. From this project directory:
   ```sh
   npx vercel
   ```
   Accept the defaults (Vite is auto-detected: build `npm run build`, output `dist`).
3. Production:
   ```sh
   npx vercel --prod
   ```

## 2. Environment variables

Server-side, never `VITE_`-prefixed (anything `VITE_*` is compiled into public JS;
`tests/no-secrets-in-bundle.test.ts` fails the build if a key reaches `dist/`):

| Var | Required | Used by |
|---|---|---|
| `ALLOWED_ORIGIN` | yes in prod (comma-separated, no trailing slash) | `api/contribute.ts` origin allow-list |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | optional | contribution store (`api/contribute.ts` returns 501 without one) |

Build-time (compiled into the bundle, public by design): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` (safe only because every table is under row-level
security), optionally `VITE_GOOGLE_CLIENT_ID`.

Redeploy after env changes: `npx vercel --prod`.

## 3. Privacy copy

What the app does and what it says must change in the same commit. The single
source of truth for the wording is `src/lib/privacy.ts`, pinned by
`tests/privacy-copy.test.ts`: signed out, parsing and scoring stay in the
browser; signed in, the profile, school list and written/uploaded material sync
to the user's account; the deep audit sends materials to the model provider (in
proxy mode through our server, on the user's account).

`api/contribute.ts` must only ever be called from a UI control the user actively
ticked (it hard-rejects anything without `consent: true` and scrubs email/phone
patterns before storage — scrubbing is not anonymity). No such UI exists yet;
build the checkbox, consent copy and privacy policy before wiring it up.

## 4. Headers

`vercel.json` carries the CSP and security headers. `tests/csp.test.ts` fails the
build if it drifts from `netlify.toml` / `public/_headers`.
