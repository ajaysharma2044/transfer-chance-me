# Turning on real accounts

> **Status:** the live project is `nikfuakdulqmumsaisnn` (org "Transfer Chance Me",
> region West US North California). Both SQL files are applied and verified:
> six tables, RLS enabled on all six, and an anonymous key confirmed unable to
> read any row or grant itself a staff role. `.env.local` is written locally.
> Outstanding: Google provider, SMTP, and the service-role key for admin routes.

Fifteen minutes, all free tier. Until both env vars are set the app keeps
using local-device accounts, so nothing breaks while you work through this.

## 1. Create the project

1. Sign up at https://supabase.com and create a new project.
2. Pick a strong database password and keep it — you will not be shown it again.
3. Choose the region closest to your users (US West for a California-heavy
   audience).

## 2. Create the tables

Dashboard → **SQL Editor** → **New query** → paste the whole of
[`schema.sql`](./schema.sql) → **Run**.

This creates `profiles` and `documents`, switches on row-level security, and
adds a trigger that creates a profile row the moment someone signs up. It is
idempotent — running it twice is harmless.

Verify: Dashboard → **Table Editor** should list both tables, each showing
"RLS enabled". If either says RLS is disabled, stop and re-run the script —
without it, the anon key in the browser can read every user's transcripts.

## 3. Wire up the app

Dashboard → **Settings** → **API**, then copy into `.env.local`:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<the anon / public key>
```

Use the **anon** key, never the **service_role** key. The service_role key
ignores row-level security; in a browser bundle it would hand any visitor
every user's essays.

Restart `npm run dev`. The sign-up form now creates real accounts.

## 4. Google sign-in

1. Google Cloud console → **APIs & Services** → **Credentials** → **Create
   credentials** → **OAuth client ID** → **Web application**.
2. Under **Authorised redirect URIs**, add the callback shown in Supabase at
   **Authentication → Providers → Google** — it looks like
   `https://<your-project>.supabase.co/auth/v1/callback`.
3. Copy the client ID and client secret into that Supabase Google provider
   panel and enable it.
4. Supabase → **Authentication → URL Configuration** → set **Site URL** to
   your deployed origin, and add `http://localhost:5199` to **Redirect URLs**
   so it works in development too.

The "Continue with Google" button appears automatically once
`VITE_SUPABASE_URL` is set. Leave `VITE_GOOGLE_CLIENT_ID` empty — that is only
for the older browser-only button used when Supabase isn't configured.

## 5. Email confirmation

By default Supabase emails a confirmation link before the first login. During
testing you may want **Authentication → Providers → Email → Confirm email**
off; turn it back on before launch or anyone can sign up as anyone.

The built-in email sender is rate-limited and not meant for production — set
up SMTP (**Settings → Auth → SMTP**) before you launch.

## 6. Deploy

Add the same two `VITE_SUPABASE_*` vars in Vercel → Project → Settings →
Environment Variables (Production), then redeploy. They are build-time vars,
so a redeploy is required for them to take effect.

---

## ⚠️ Turned off for development — must go back on before launch

**"Confirm email" is currently DISABLED** (Authentication → Sign In / Providers →
User Signups). It was switched off on 2026-08-16 so sign-ups would work without
Supabase's built-in email sender, which is rate-limited to a few messages an
hour and is not a production mailer.

With it off, anyone can register using an email address they do not own — they
can take someone else's address, and nobody ever proves they can read that
inbox. That is acceptable with zero real users and unacceptable the moment
students sign up.

To fix properly, in this order:
1. Settings → Auth → SMTP: connect a real sender (Resend and SendGrid are both
   free at this volume).
2. Authentication → Sign In / Providers → switch **Confirm email** back on.
3. Sign up once with a real address and confirm the email actually arrives.

## Before you launch — this part is not optional

The app now stores transcripts, essays, activity descriptions and GPAs.
Many of these users are 17 or 18. That carries real duties:

- **Publish a privacy policy** that says what you collect, why, how long you
  keep it, and who it is shared with. It has to be accurate — the in-app copy
  was updated to match the current behaviour, and it must stay matched.
- **Let users delete their data.** `deleteAllData()` in `src/lib/sync.ts` does
  the work; it still needs a visible control in the portal.
- **Under-13 users need parental consent** (COPPA). If you don't intend to
  serve them, say so in the terms and don't market to them.
- **California users can request their data** (CCPA/CPRA) — you need a way to
  export it, not just delete it.
- **Turn on Point-in-Time Recovery** (paid tier) before real users depend on
  this, or a bad migration loses their work permanently.
- **Never paste the service_role key** into client code, a `VITE_` var, or a
  repo. Rotate it immediately if it is ever exposed.
