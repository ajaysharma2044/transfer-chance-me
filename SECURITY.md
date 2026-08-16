# Security audit — Transfer Chance Me

Audited: 2026-08-15. Scope: full repo (Vite + React + TS static app, hash-routed, no backend deployed). Each item is marked **OK**, **N/A (static site)**, or **needs backend**.

## Verdict summary

1. **The scariest asset in the app is the user's Anthropic API key in `localStorage`** (`tcm.apikey.v1`, set in `src/lib/review.ts`). There is no XSS today so it is not currently exfiltratable, but any future XSS or malicious browser extension gets it. The proxy in `api/review.ts` (see DEPLOY.md) removes browser-held keys entirely — deploy it.
2. **No XSS surface found** — zero `dangerouslySetInnerHTML` / `innerHTML` / `eval`; all user text and all LLM output render through React text nodes, which auto-escape. **OK.**
3. **App dependencies audit clean (0 vulnerabilities).** 10 advisories (7 high) exist only in `@vercel/node`'s dev-only transitive deps (`undici` ≤6.27.0, `smol-toml`) added for the backend work; they never ship to the browser bundle and Vercel's production runtime does not use this local-emulation chain. Low priority, track upstream.
4. **`.gitignore` did not cover `.env`** (only `*.local`). Fixed in this audit: `.env*` is now ignored, `.env.example` stays tracked. No real secrets were ever committed (see item 1 below).
5. **Local auth is honestly labeled but cryptographically weak by design** — single-round SHA-256, email-as-salt, hashes readable in `localStorage`. Acceptable *only* because it protects nothing beyond the device it lives on and the UI says so. Do not port this scheme to a backend.

---

## 1. Secrets in repo / git history — **OK**

- Grepped `src/`, `scripts/`, configs, and the raw `.git` object store for `sk-ant`, key-shaped strings, `api_key`, and tokens. Only hits: UI placeholder copy in `src/components/Review.tsx` (`placeholder="sk-ant-…"`) — not a secret.
- `.env.example` contains only an empty `VITE_GOOGLE_CLIENT_ID=` (a Google OAuth *client ID* is public-by-design anyway).
- **Fixed during audit:** `.gitignore` now includes `.env*` with `!.env.example`. Previously only `*.local` was covered, so a stray `.env` with a real key could have been committed.
- Reminder: any `VITE_*` variable is compiled into the public JS bundle. Never put a private key in a `VITE_*` var — the server-side key belongs in Vercel env vars (`ANTHROPIC_API_KEY`), which are not `VITE_`-prefixed.

## 2. npm audit — **OK (app), noted (dev tooling)**

- Before backend work: `npm audit` → **0 vulnerabilities** across all runtime deps (`react`, `react-dom`, `pdfjs-dist`, `@fontsource-variable/inter`).
- After adding `@vercel/node` (devDependency, required for typed serverless functions): 10 advisories (3 moderate, 7 high), **all** in its transitive dev-only chain — `undici` ≤6.27.0 (response desync, cookie/header injection, DoS) and `smol-toml` (DoS). These run only in local `vercel dev` emulation, never in the shipped bundle or in Vercel's production function runtime. Re-check with `npm audit` after `@vercel/node` upgrades; do not run `npm audit fix --force` blindly (it downgrades `@vercel/node` breakingly).

## 3. XSS surface — **OK**

- `grep -r "dangerouslySetInnerHTML\|innerHTML\|document.write\|eval("` over `src/`: zero hits.
- All user-supplied text (essays, activities, names, emails) and all **LLM-generated** review JSON (`grade`, `summary`, notes, per-school verdicts in `src/components/Review.tsx`) render as React text nodes/JSX interpolations, which HTML-escape automatically. Confirmed no HTML injection path.
- URL-ish sinks checked: favicon `<img src>` interpolates a school domain into `https://www.google.com/s2/favicons?domain=…` (`src/components/SchoolSearch.tsx`, `src/lib/schools.ts`). Domains come from the curated `public/schools.json` plus one user-entered domain stored locally; React attribute escaping prevents breaking out of the attribute, and the CSP in `vercel.json` restricts `img-src` anyway. Low risk.
- Google sign-in (`src/lib/googleAuth.ts`) decodes the ID-token JWT **without signature verification**. For a client-side-only trophy (displaying a name) that's tolerable; **needs backend** verification (audience + signature) the moment a session grants access to anything server-side.

## 4. File upload handling — **OK (fixed during audit)**

- `src/lib/pdf.ts` + `src/components/ImportPanel.tsx`: files are parsed entirely in the browser (pdfjs in a Web Worker), never uploaded. Accept filter `.pdf,.txt`; at most 6 files per drop.
- **Added during audit:** a 20 MB per-file cap in `ImportPanel.tsx` (`MAX_FILE_BYTES`); oversized files are skipped with a visible "skipped — over 20 MB" note. Previously a multi-GB file could hang the tab.
- pdfjs parses untrusted PDFs; keep `pdfjs-dist` current (v6.x in use — post-dates the 2024 `isEvalSupported` JS-execution advisory). Type sniffing is by MIME/extension only, which is fine because the file never crosses a trust boundary — it stays in the user's own browser.

## 5. localStorage data inventory — **OK, with one caveat (the API key)**

| Key | Written by | Contents | Sensitivity |
|---|---|---|---|
| `tcm.profile.v1` | `App.tsx` | GPA, school, major, courses, essay text, doc names | Personal-academic; moderate |
| `tcm.appdocs.v1` | `components/Review.tsx` | Personal statement + activities drafts | Personal; moderate |
| `tcm.review.v1` | `lib/review.ts` | Last AI review report | Derived from the above; moderate |
| `tcm.apikey.v1` | `lib/review.ts` | **Anthropic API key (plaintext)** | **High** — spendable credential; removed entirely in proxy mode |
| `tcm.users.v1` | `lib/auth.ts` | Local accounts: name, email, SHA-256(email-salted) password hash | Moderate — offline-crackable hashes; users may reuse passwords |
| `tcm.session.v1` | `lib/auth.ts` | Current session email + name | Low |
| `tcm.waitlist.v1` | `components/Pricing.tsx` | Waitlist emails + tier (never sent anywhere — it's a stub) | Low, but see labeling note below |
| `tcm.list.v1` | `components/Portal.tsx` | Saved school list | Low |
| `tcm.schooldomain.v1` | `components/SchoolSearch.tsx` | One school domain string | Low |

- Everything is same-origin `localStorage`: unencrypted at rest, readable by anyone with device access and by any future XSS. That is an acceptable model for a client-side-only app **except** the API key (see verdict #1).
- The Pricing "waitlist" stores emails locally and sends them nowhere. Users likely believe they joined a real waitlist. Not a security bug, but an honesty gap — **needs backend** (or clearer copy) to be real.

## 6. Local-auth model honest labeling — **OK**

- `src/components/Auth.tsx` states in the UI: "Beta note: accounts live only in this browser, on this device. Nothing is sent to any server… clearing your browser's data will remove your account." That matches the implementation in `src/lib/auth.ts` exactly. Good.
- Design caveats (fine locally, **needs backend** to ever be more): single-round SHA-256 with email as salt is not a password KDF (no per-user random salt, no work factor — GPU-crackable at billions/sec if the device is compromised); no rate limiting; "log in" grants nothing a visitor doesn't already have, since all data is device-local anyway. If real accounts ship, replace with a server using argon2id/bcrypt — the code comment in `auth.ts` already anticipates this swap.

## Items that need a backend (summarized)

- Server-held Anthropic key + rate limiting → **written, ready to deploy: `api/review.ts`** (see DEPLOY.md).
- Opt-in dataset contributions with consent gate + PII scrub → **written: `api/contribute.ts`** (must not be wired to UI until privacy copy is updated — see DEPLOY.md "Data & consent").
- Real accounts (password KDF, sessions), real waitlist storage, Google ID-token verification.
- Security headers/CSP → **written: `vercel.json`** (a static host must send these; they cannot be set client-side).
