# Deploying Transfer Chance Me to Vercel

The repo now ships two serverless functions (`api/review.ts`, `api/contribute.ts`) and a `vercel.json` with security headers. Nothing is deployed yet — these are the exact steps.

## 1. One-time setup

1. Create a free Vercel account at https://vercel.com/signup (the Hobby plan is enough).
2. From this project directory, run:
   ```sh
   npx vercel
   ```
   Accept the defaults when prompted (it auto-detects Vite: build command `npm run build`, output `dist`). This creates the project and gives you a preview URL.
3. Deploy to production:
   ```sh
   npx vercel --prod
   ```

## 2. Environment variables (Vercel dashboard → Project → Settings → Environment Variables, or CLI)

4. Set the server-side Anthropic key (get one at console.anthropic.com → API Keys):
   ```sh
   npx vercel env add ANTHROPIC_API_KEY production
   ```
   Paste the `sk-ant-…` key when prompted. **This is a server env var — it is never sent to the browser.** Do not prefix it with `VITE_` (anything `VITE_*` gets compiled into public JS).
5. Set the allowed origin to your production URL (no trailing slash):
   ```sh
   npx vercel env add ALLOWED_ORIGIN production
   # e.g. https://transfer-chance-me.vercel.app  (or your custom domain, step 7)
   ```
   `api/review.ts` and `api/contribute.ts` reject requests from other origins.
6. **Optional — contribution storage.** `api/contribute.ts` returns 501 until you connect Upstash Redis (free tier: Vercel dashboard → Storage → Marketplace → Upstash for Redis, or upstash.com directly), then set:
   ```sh
   npx vercel env add UPSTASH_REDIS_REST_URL production
   npx vercel env add UPSTASH_REDIS_REST_TOKEN production
   ```
   Do **not** enable this until the "Data & consent" work below is done.
7. **Optional — custom domain.** Project → Settings → Domains → add your domain, then point its DNS at Vercel (CNAME `cname.vercel-dns.com`, or the A record Vercel shows). Update `ALLOWED_ORIGIN` to match.
8. Redeploy after env changes: `npx vercel --prod`.

## 3. Switching the frontend from browser-key mode to proxy mode

Today the deep review runs in **browser-key mode**: each user pastes their own Anthropic key (stored in their `localStorage`, sent straight to Anthropic). The proxy removes that.

9. Set the build-time flag so the app POSTs prompts to the proxy instead:
   - Vercel dashboard: add env var `VITE_REVIEW_ENDPOINT` = `/api/review` (Production), then redeploy — Vercel injects it at build time.
   - Or locally: `VITE_REVIEW_ENDPOINT=/api/review npm run build`.

   How it works (`src/lib/review.ts`): when `import.meta.env.VITE_REVIEW_ENDPOINT` is set, `runReview()` POSTs `{ prompt }` to that endpoint with **no `x-api-key` header** and no key requirement; when it is absent, the original browser-key path runs unchanged as the fallback. The proxy returns the raw Anthropic Messages response, so the client parser is identical in both modes.

10. **Known follow-up (one small UI edit, deliberately not made in this pass):** `src/components/Review.tsx` still shows the "One-time setup: your AI key" card and disables the Run button until a key is saved (`disabled={busy || !key}`). In proxy mode neither is needed. `src/lib/review.ts` now exports `proxyMode: boolean` for exactly this — change the gate to `disabled={busy || (!proxyMode && !key)}` and wrap the key card in `{!proxyMode && !key && …}`.

11. Verify after deploy:
    - `curl -X POST https://<your-domain>/api/review -H 'content-type: application/json' -d '{"prompt":"Say ok."}'` → JSON with `content[0].text`.
    - `curl -X POST https://<your-domain>/api/review -H 'content-type: application/json' -H 'origin: https://evil.example' -d '{"prompt":"x"}'` → 403.
    - Repeat the first curl 6+ times quickly → 429 (note: the per-IP token bucket is in-memory per function instance, so cold starts reset it — see the comment in `api/review.ts`; use Upstash/WAF rules for a hard limit).

## 4. Data & consent — required before enabling the proxy or contributions

The site currently promises **client-side-only processing** in these exact places. The moment `VITE_REVIEW_ENDPOINT` is set, materials flow through *your* server (still not stored, but the promise as worded becomes false), and `api/contribute.ts` stores materials outright. Update every string below and publish a privacy policy first.

| File | Location | Current promise |
|---|---|---|
| `src/components/ImportPanel.tsx` | line ~8 (comment) and line ~83 (UI copy) | "All parsing happens on-device; files are never uploaded anywhere." / "Parsed on your device; never uploaded." |
| `src/components/EssayPanel.tsx` | line ~27 (textarea placeholder) | "analyzed on your device, never uploaded" |
| `src/components/Portal.tsx` | line ~177 (empty-state copy) | "parsed on your device, never uploaded" |
| `src/components/Landing.tsx` | line ~175 | "Parsed on your device — your file never leaves the browser." |
| `src/components/Landing.tsx` | line ~301 (hero aside) | "Free · takes 2 minutes · nothing leaves your browser" |
| `README.md` | line ~5 | "Everything runs client-side — nothing leaves the browser." |
| `src/components/Review.tsx` | line ~89 (page dek) and lines ~10–12 (comment) | "Your materials go directly from your browser to the AI — never to us." / "straight from the browser to Anthropic — no middleman server" |
| `src/lib/review.ts` | lines 1–3 (comment) | "requests go directly to Anthropic; no other server ever sees the application" |
| `src/components/Review.tsx` | line ~100 (key card) | "It's stored only in this browser and sent only to Anthropic." (moot in proxy mode — remove with the key card, step 10) |
| `src/lib/pdf.ts` | line 1 (comment) | "Documents never leave the browser." (still true — PDF parsing stays client-side — but keep it accurate if that ever changes) |

Notes:
- The PDF-parsing promises (ImportPanel/EssayPanel/Portal/Landing/pdf.ts) remain **true** under the proxy — files are still parsed in the browser; only the assembled review *prompt* (profile summary + pasted essays) goes to `/api/review`. Reword them to say that precisely rather than deleting them.
- The Review-page promises ("never to us", "no middleman server") become **false** in proxy mode — rewrite to: materials are sent to our server, forwarded to Anthropic, and never stored or logged. Then make `api/review.ts` keep that promise (it currently stores nothing and logs nothing — keep it that way).
- `api/contribute.ts` must only ever be called from a UI checkbox the user actively ticked (it hard-rejects anything without `consent: true`, and scrubs email/phone patterns before storage — but scrubbing is not anonymity; essays identify people). No such UI exists yet; build the checkbox + consent copy + privacy policy before wiring it up.
- The local-auth beta note in `src/components/Auth.tsx` ("accounts live only in this browser") stays true until you add real accounts — leave it until then.
