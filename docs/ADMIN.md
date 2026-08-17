# Running the admin portal

Operations runbook for staff access to applicant records. This describes what
the code in `api/_admin.ts`, `api/admin/*.ts` and `supabase/admin.sql` actually
does today — not what it should eventually do. Where the two differ, the gap is
stated in the section it affects and again in
[Known gaps](#known-gaps-read-this-before-you-rely-on-anything-above).

Read [`supabase/SETUP.md`](../supabase/SETUP.md) first: it covers creating the
project and applying the schema. This document starts from the point where both
SQL files are applied.

**What you are handling.** These records are transcripts, essays, GPAs and
personal statements. Many belong to 17- and 18-year-olds. Every procedure below
assumes that opening one of these files is a real act with a real subject, and
that it should be as easy to explain afterwards as it was to do.

---

## The model in four sentences

1. A role lives **only** in `public.staff_roles`. It is never read from a JWT,
   from `user_metadata`, or from anything else a browser can influence.
2. No client key can write `staff_roles` — the table has RLS on and no
   insert/update/delete policy at all, so those statements are denied for
   every anon and user token. Only the secret (service-role) key can write it.
3. `requireStaff()` in `api/_admin.ts` re-reads the table on **every request**
   and caches nothing, so a revocation takes effect on the next call.
4. Every allow and every deny is written to the append-only `admin_audit`
   table *before* the handler returns data. If the log write fails, the request
   fails — no log, no access.

Hiding the admin link in the UI is not part of this model. Assume anyone who
wants to can find the routes.

---

## 0. Before you start

Three things must be true or nothing below works.

**The server env vars are set where the functions run.** `api/_admin.ts` reads:

| Variable | Notes |
|---|---|
| `SUPABASE_URL` | Falls back to `VITE_SUPABASE_URL` if unset. |
| `SUPABASE_SERVICE_ROLE_KEY` | **No fallback.** Missing → every admin route returns `500 Admin API is not configured.` |

Neither may ever be `VITE_`-prefixed. Vite compiles `VITE_*` into the public
bundle; a secret key there hands every visitor every user's transcripts.
`tests/no-secrets-in-bundle.test.ts` checks the built output for exactly this.
`.gitignore` covers `.env*` (with `.env.example` kept tracked), so a local
`.env.local` holding the secret key for `vercel dev` is safe from a commit —
but it is still a secret on your disk, so treat the laptop accordingly.

**Both SQL files are applied.** `supabase/schema.sql` then `supabase/admin.sql`,
in that order, in the Supabase SQL editor. Both are idempotent.

Everything staff can do runs through one of these, and every one of them calls
`requireStaff()` first:

| Route | Minimum role | Does |
|---|---|---|
| `GET /api/admin/cases` | reviewer (scoped to assignments) | The case list |
| `GET /api/admin/case?id=` | reviewer (scoped) | One applicant, metadata only |
| `POST /api/admin/document` | reviewer (scoped) | Open one document, 120s signed URL |
| `POST /api/admin/assign` | administrator | Assign or release a reviewer |
| `POST /api/admin/export` | administrator, recent auth | Everything held about one person |
| `GET /api/admin/audit` | administrator | Search the access log |
| `GET /api/admin/alerts` | administrator | Unusual staff behaviour |
| `POST /api/admin/role` | owner, recent auth | Grant or revoke a staff role |

**You accept two current blockers.** Neither is subtle and both are covered in
detail later:

- There is **no MFA enrolment UI in the app**, and `requireStaff()` refuses any
  staff session that has not reached `aal2`. Until enrolment exists, staff must
  be enrolled out-of-band (§2) or the portal is unusable by anyone.
- **Email confirmation is currently disabled** in the Supabase project (see the
  warning at the bottom of `supabase/SETUP.md`). Supabase stamps
  `email_confirmed_at` at sign-up when confirmation is off, so the
  confirmed-email checks in `requireStaff()` and `api/admin/role.ts` are
  satisfied by addresses nobody has ever proved they can read. Verify staff
  identity by some other means until SMTP is connected and confirmation is
  switched back on.

---

## 1. Creating the first owner

There is deliberately no default admin account, no bootstrap password, and no
"first user becomes owner" rule. The first owner is seeded by hand, in the SQL
editor, against a real account that already exists.

### Why it cannot be done from the app

The cycle is intentional:

- `public.staff_roles` has RLS enabled and exactly one policy — `read own staff
  row`, a `SELECT`. With RLS on and no permissive write policy, inserts and
  updates are denied for anon and authenticated keys. There is no "grant
  yourself a role" path to close because there is no path.
- The only code that writes the table is `api/admin/role.ts`, and its first
  line is `requireStaff(req, { min: "owner", sensitive: true })`. It needs an
  owner to make an owner.

So the first grant has to come from outside the application entirely. The
Supabase SQL editor connects as the database owner, which is not subject to
RLS. That connection is gated by your Supabase dashboard login — which is now
the most privileged credential in the whole system, and should carry MFA and
the smallest possible list of org members.

### The steps

**a. Create the account normally.** Sign up through the app (`#/login`) with
the address that will hold the role, or Dashboard → Authentication → Users →
Add user. Do not use a shared mailbox.

**b. Find its user id and confirm the account is real.**

```sql
select id, email, email_confirmed_at, created_at, last_sign_in_at
from auth.users
where email = 'owner@yourdomain.example';
```

Copy the `id`. Note that with email confirmation disabled,
`email_confirmed_at` being non-null proves nothing about inbox control — check
in person or by a channel you already trust.

**c. Grant owner.**

```sql
insert into public.staff_roles (user_id, role, granted_by, note)
values (
  '00000000-0000-0000-0000-000000000000',   -- the id from step b
  'owner',
  null,                                      -- nobody granted this; it was seeded
  'Bootstrap owner, seeded from the SQL editor on 2026-08-16'
)
on conflict (user_id) do update
  set role       = 'owner',
      revoked_at = null,
      granted_at = now(),
      note       = excluded.note;
```

`granted_by` is null on purpose. A null there means "seeded out of band", and
it is the one row in the table that will ever legitimately look like that.
Write the date and the reason into `note` — it is the only context the row
will carry a year from now.

**d. Verify, and verify that nothing else got in.**

```sql
select u.email, s.role, s.granted_at, s.granted_by, s.revoked_at, s.note
from public.staff_roles s
join auth.users u on u.id = s.user_id
order by s.granted_at;
```

Exactly one active row, role `owner`, the address you expect. If anything else
appears, stop and work out why before going further.

**e. Enrol MFA before signing in to anything.** See §2 — without it this owner
cannot use a single admin route.

Seed **one** owner. Add the second through the app once §2 and §3 work, so that
the normal path is exercised and audited at least once before you need it.

---

## 2. Multi-factor: not optional, and not yet wired up

`requireStaff()` reads the `aal` claim from the verified access token and
refuses anything that is not `aal2`:

```
403 Multi-factor authentication is required for staff accounts.
```

Supabase reports `aal2` only when a second factor has been **used in this
session** — an enrolled-but-unchallenged factor still yields `aal1`. So the
sign-in flow has to complete the TOTP challenge, not merely have a factor on
file.

**The gap.** There is no `mfa.enroll` / `mfa.challenge` / `mfa.verify` call
anywhere in `src/`, and the Supabase dashboard can show and remove factors but
cannot enrol one on a user's behalf. Today, therefore, nobody can pass
`requireStaff()` through the app at all. Two ways forward, and you need the
first eventually regardless:

1. **Build enrolment and challenge into the sign-in flow** (`src/lib/auth.ts` +
   `src/components/Auth.tsx`): enrol on first staff sign-in, challenge on every
   subsequent one. This is the real fix.
2. **Interim: enrol out of band** with a throwaway script, below.

### Interim enrolment script

Save as `mfa-enrol.mjs` in the repo root, run it, then delete it. It uses only
`@supabase/supabase-js`, already a dependency, and the public anon key. Node 22
(`.nvmrc`) supports `--env-file`.

```js
// mfa-enrol.mjs — temporary. Enrols a TOTP factor for one staff account.
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);

const email = await rl.question("email: ");
const password = await rl.question("password: ");
const { error: e1 } = await sb.auth.signInWithPassword({ email, password });
if (e1) throw e1;

const { data: f, error: e2 } = await sb.auth.mfa.enroll({
  factorType: "totp",
  friendlyName: `staff-${email}`,
});
if (e2) throw e2;

console.log("\nSecret — type this into your authenticator app:\n", f.totp.secret);
console.log("\n(or open f.totp.qr_code, an SVG data URI, in a browser)\n");

const { data: c, error: e3 } = await sb.auth.mfa.challenge({ factorId: f.id });
if (e3) throw e3;
const code = await rl.question("6-digit code from the app: ");
const { error: e4 } = await sb.auth.mfa.verify({
  factorId: f.id, challengeId: c.id, code,
});
if (e4) throw e4;

const { data: s } = await sb.auth.getSession();
console.log("\nEnrolled. Factor:", f.id);
console.log("aal2 access token (expires within the hour — do not paste it anywhere):");
console.log(s.session.access_token);
await rl.close();
```

```sh
node --env-file=.env.local mfa-enrol.mjs
```

Type the password at the prompt; do not pass it as an argument, where it lands
in shell history and `ps`. The printed access token is what you use as the
bearer for the `curl` calls in §3 — it is a live credential for the whole
session, so keep it in the terminal and let it expire.

Delete the script when you are done. Do not commit it.

### Checking enrolment across the team

```sql
select u.email, s.role, f.friendly_name, f.factor_type, f.status, f.created_at
from public.staff_roles s
join auth.users u on u.id = s.user_id
left join auth.mfa_factors f on f.user_id = s.user_id
where s.revoked_at is null
order by u.email;
```

Any active staff row with no `verified` factor is a person who cannot work and,
more importantly, a person whose password alone would be enough if the aal2
check were ever relaxed. `auth.mfa_factors` belongs to Supabase's own auth
schema rather than to this repo's SQL — if your project version names it
differently, the Table Editor's `auth` schema will show you.

---

## 3. Adding staff

**One account per person. Never a shared one.** Not a house style — three
mechanisms depend on it:

- `admin_audit.actor_id` is the only record of who opened a student's file. A
  shared login turns every entry into "someone".
- `api/admin/role.ts` blocks changing *your own* role, which is what stops
  self-promotion and the "revoke every other owner" move. Two people behind one
  account defeat it.
- Revocation is per user id. You cannot remove one person from a shared
  account without locking out everyone else on it.

Same rule for the Supabase dashboard: individual org members, no shared
dashboard login. That login can bypass every control in this document.

### Granting a role

The person needs an account (§1a) and a verified TOTP factor (§2) first. Then
an owner calls:

```sh
curl -sS -X POST "https://<your-domain>/api/admin/role" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"userId":"<their uuid>","role":"reviewer","reason":"Contract signed 2026-09-01"}'
```

`$TOKEN` is an aal2 access token belonging to an **owner**, issued in the last
15 minutes (the route is `sensitive: true`). What the route enforces:

- owner only — administrators cannot create staff
- recent authentication, so an unattended session cannot escalate
- you cannot change your own role in either direction
- the target must exist and have a non-null `email_confirmed_at`
- the last remaining active owner cannot be revoked
- grant, revoke and every refusal are audited as `change_role`

`reason` is truncated to 300 characters and stored in both `staff_roles.note`
and the audit row. Write something a stranger could read later.

### Choosing the role

Give the smallest role that lets the person do their actual job. Roles rank
`reviewer < administrator < owner`.

| Role | Can | Cannot | Use it for |
|---|---|---|---|
| `reviewer` | List and open **only** cases currently assigned to them (`api/admin/cases.ts` filters by `case_assignments` before any other filter; `canViewCase()` re-checks on every document open) | Read the audit log at all — including their own rows. Read any unassigned case. Change roles. | Everyone who reads student work. This should be almost all of your staff. |
| `administrator` | Everything a reviewer can, on **any** case without assignment. Read `admin_audit` and `admin_alerts`. | Grant or revoke roles. | The one or two people who triage incoming cases, assign reviewers and read the log. |
| `owner` | Everything, plus `POST /api/admin/role`. | Change their own role; revoke the last owner. | Two people. Not one — the last-owner protection means a single owner who loses their factor leaves you in the SQL editor. Not five. |

An administrator's read of any case is unrestricted **but individually
audited**; that is the trade. Reviewer scoping is enforced server-side from the
role read out of the table, so a reviewer calling `/api/admin/cases` directly
with a crafted query string still receives only their own assignments.

---

## 4. Assigning cases

Least privilege for reviewers is the assignment: a reviewer with no rows in
`case_assignments` sees an empty list and can open nothing. Assignment is
therefore the act that widens someone's reach, and it is administrator-and-above
only.

```sh
# put a reviewer on a case
curl -sS -X POST "https://<your-domain>/api/admin/assign" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"subjectId":"<applicant uuid>","reviewerId":"<reviewer uuid>","reason":"Plus review, queued 2026-09-02"}'

# take them off it
curl -sS -X POST "https://<your-domain>/api/admin/assign" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"subjectId":"<applicant uuid>","reviewerId":"<reviewer uuid>","release":true,"reason":"Review delivered"}'
```

What `api/admin/assign.ts` enforces:

- administrator or owner; a reviewer cannot widen their own reach
- the subject must be a real row in `profiles` — you cannot assign a case that
  is not a case
- the reviewer must hold an **active staff role**, read from `staff_roles`, so
  a member of the public cannot be handed a file by putting their id in the body
- at most 200 open cases per reviewer, at most 10 reviewers per case: a
  scripted loop cannot quietly hand one account the whole product
- release writes `released_at`, never a delete, so "who could see this file in
  March" stays answerable
- both directions are audited as `assign_case` / `release_case`, with the
  reviewer id and your reason, including every refusal

Re-assigning after a release reopens the same row — `unique (subject_id,
reviewer_id)` in the schema, handled by an upsert in the route. Release takes
effect immediately: `canViewCase()` and the case list both filter on
`released_at is null` at query time.

Read-only queries for review (the SQL editor; these change nothing):

```sql
-- who holds what right now
select r.email as reviewer, count(*) as open_cases, max(a.assigned_at) as latest
from public.case_assignments a
join auth.users r on r.id = a.reviewer_id
where a.released_at is null
group by 1 order by 2 desc;

-- everyone who has ever been able to see one applicant's file
select r.email, a.assigned_at, a.released_at, g.email as assigned_by
from public.case_assignments a
join auth.users r on r.id = a.reviewer_id
left join auth.users g on g.id = a.assigned_by
where a.subject_id = '<applicant uuid>'
order by a.assigned_at;
```

Writing to `case_assignments` directly in the SQL editor also works and is
sometimes the only option in an incident — but it bypasses every check above
**and writes no audit row**, so prefer the route and note it in your incident
log when you cannot.

Assign what the work needs and release when it is done. An assignment left open
after a review is finished is standing access to a student's file for no
reason, and it silently comes back if the reviewer's role is ever re-granted.

---

## 5. Emergency revocation

Use this when a staff account may be compromised, when someone leaves, or when
you are not sure and would rather find out with their access off.

### Normal path — an owner, through the API

```sh
curl -sS -X POST "https://<your-domain>/api/admin/role" \
  -H "authorization: Bearer $OWNER_TOKEN" \
  -H "content-type: application/json" \
  -d '{"userId":"<uuid>","revoke":true,"reason":"Suspected credential compromise 2026-08-16"}'
```

This sets `revoked_at`, attempts a global sign-out, and writes a `change_role`
audit row carrying the previous role.

Releasing their assignments is a separate call per case
(`POST /api/admin/assign` with `"release": true`, §4). You do not have to do it
to stop access — `canViewCase()` only honours an assignment held by someone who
still passes `requireStaff()`, so a revoked role neutralises every row they
hold. Do it anyway before a re-grant, so nothing old comes back with the new
role.

### Break-glass — SQL editor

Use when there is no other owner available, when the deployment is down, or
when you need it done in ten seconds.

```sql
update public.staff_roles
set revoked_at = now()
where user_id = '<uuid>' and revoked_at is null;

update public.case_assignments
set released_at = now()
where reviewer_id = '<uuid>' and released_at is null;
```

Two things to know about this path. It **bypasses the last-owner protection**,
so it is possible to revoke the only owner and leave the system unadministrable
— recoverable only by another SQL insert (§1c), but check first:

```sql
select count(*) from public.staff_roles where role = 'owner' and revoked_at is null;
```

And it writes **no audit row**, because the audit trail is written by the API.
Record the revocation in your incident notes.

### What happens to live sessions

Be precise about this, because the two halves behave differently.

**Admin access stops on their very next request.** `requireStaff()` re-reads
`staff_roles` every time and caches nothing. The next call returns `403 Not
authorized.` and writes an `admin_access_denied` row with
`meta.reason = "no_active_role"`. This holds for both the API and the SQL path,
and it does not depend on their token expiring.

**Their ordinary user session is not reliably terminated.** `api/admin/role.ts`
calls `sb.auth.admin.signOut(userId, "global")`, but that method's first
argument is a **JWT**, not a user id — it is sent as the bearer for
`POST /auth/v1/logout`. Passing a uuid produces an auth error, which
supabase-js returns rather than throws and the route discards. So treat the
sign-out as not having happened. It costs nothing in admin privilege (see
above), but the person keeps a working session against their own account until
it expires. To actually terminate it, delete their sessions:

```sql
-- confirm the table exists in your project first: select * from auth.sessions limit 1;
delete from auth.sessions where user_id = '<uuid>';
```

This is a write into Supabase's own auth schema; it is the reliable way to
force a logout, and refresh tokens are removed with the session by cascade.

### Verify it took effect

```sql
-- 1. the role is gone
select role, granted_at, revoked_at from public.staff_roles where user_id = '<uuid>';

-- 2. no assignments left open
select count(*) from public.case_assignments
where reviewer_id = '<uuid>' and released_at is null;

-- 3. after they retry, the denial is on the record
select created_at, action, success, meta, ip
from public.admin_audit
where actor_id = '<uuid>' order by created_at desc limit 10;
```

Then ask them to hit any admin route and confirm you see the `no_active_role`
denial appear. A revocation you have not watched fail closed is a revocation
you are guessing about.

### Offboarding, not just revoking

Revoke the role, release the assignments, remove their MFA factors and their
Supabase dashboard membership, and rotate anything they held. **Do not delete
the auth user.** `admin_audit.actor_id` is `references auth.users on delete
restrict`, so the delete will fail with a foreign-key error for anyone who has
ever acted — deliberately, so a trail cannot be erased by removing an account.

The same restriction has a side effect worth knowing: any ordinary user who
probes `/api/admin/*` gets a `no_active_role` denial logged against their own
id, which then blocks deleting that account from the dashboard. If an erasure
request hits this, check `select count(*) from public.admin_audit where
actor_id = '<uuid>'` first. Their *data* is erased independently — documents
and profile contents go via `deleteAllData()` in `src/lib/sync.ts` — and the
audit row retains only the fact that a uuid was refused admin access.

---

## 6. Access review

Run this monthly, and after anyone leaves. It takes about five minutes.

Two of these reads now have routes of their own — `GET /api/admin/audit`
(filters: `actor`, `subject`, `action`, `from`, `to`, `success=false`, `page`,
`limit`, max 100 per page) and `GET /api/admin/alerts`, both administrator and
above, both feeding the admin portal. Prefer them: **reading the log is itself
an audited action**, written before the query runs (`read_audit_log`,
`read_alerts`), so a review leaves its own trace and someone checking whether
their trail is visible leaves a record of having checked. The SQL below reaches
what the routes do not expose — `staff_roles`, MFA factors, assignments — and
reading through the SQL editor leaves no application-level trace, which is
itself a reason to keep dashboard access narrow.

**Who holds what.**

```sql
select u.email, s.role, s.granted_at, g.email as granted_by, s.revoked_at, s.note
from public.staff_roles s
join auth.users u on u.id = s.user_id
left join auth.users g on g.id = s.granted_by
order by s.revoked_at nulls first, s.role desc, s.granted_at;
```

Ask of every active row: does this person still work here, do they still do
this job, and is this still the smallest role for it? A `granted_by` of null on
anything other than your one bootstrap owner means someone wrote to the table
directly — find out who and why.

**Every role change since the last review.**

```sql
select a.created_at, actor.email as by, subject.email as to,
       a.success, a.reason, a.meta
from public.admin_audit a
left join auth.users actor   on actor.id = a.actor_id
left join auth.users subject on subject.id = a.subject_id
where a.action = 'change_role' and a.created_at > now() - interval '30 days'
order by a.created_at desc;
```

Each grant should match a request you remember.

**Standing assignments.** The query in §4. Anything open for months is either
an unfinished case or forgotten access.

**MFA coverage.** The query in §2.

**Volume per person.**

```sql
select u.email, a.action, count(*), max(a.created_at) as last_seen
from public.admin_audit a
left join auth.users u on u.id = a.actor_id
where a.created_at > now() - interval '30 days'
group by 1, 2 order by 3 desc;
```

You are looking for shape, not totals: a reviewer opening far more documents
than cases, an administrator listing constantly, activity at hours that person
does not work.

**Denials.**

```sql
select created_at, actor_id, action, meta, ip, user_agent
from public.admin_audit
where success = false and created_at > now() - interval '30 days'
order by created_at desc;
```

A handful of `mfa_required` after a new laptop is ordinary. A run of
`no_active_role` from one id is someone probing.

**Alerts.**

```sql
select * from public.admin_alerts;
```

`admin_alerts` is a view computed at query time over fixed windows, defined in
`supabase/admin.sql`:

| `kind` | Fires when | Window |
|---|---|---|
| `many_subjects` | one actor touched ≥ 25 distinct subjects | last hour |
| `failed_actions` | one actor had ≥ 5 failures | last 15 minutes |
| `bulk_export` | ≥ 20 `download_document` or `export_user` actions | last hour |

Two honest caveats. Nothing schedules this view and nothing emails anyone — it
only reports when someone loads the page or runs the query, so put it on the
monthly review and check it during an incident. And `many_subjects` counts
distinct `subject_id`, which `list_cases` rows do not carry, so it catches
someone opening many files rather than someone listing repeatedly.

---

## 7. What is logged, and what is not

Every row in `public.admin_audit`, written by `audit()` in `api/_admin.ts`:

| Column | Contents |
|---|---|
| `actor_id`, `actor_role` | Who acted, and the role they held at that moment |
| `action` | One of: `list_cases`, `view_case`, `view_document`, `download_document`, `export_user`, `export_user_manifest`, `assign_case`, `release_case`, `change_role`, `read_audit_log`, `read_alerts`, `admin_access_denied` |
| `subject_id` | The applicant whose record was touched |
| `document_id` | Which document |
| `reason` | Free text the staff member supplied, truncated to 300 chars |
| `success` | False for denials and refusals |
| `ip`, `user_agent` | Taken from the request |
| `meta` | JSON: document `kind` and file `name`, the search string on a list, the target's email on a role change, the reviewer id on an assignment, the audit filters on a log search, the export manifest, the denial reason |
| `created_at` | Server time |

Two of those deserve a note. `read_audit_log` and `read_alerts` mean the
oversight tooling is itself on the record. And an export writes **two** rows —
`export_user` before anything is read, then `export_user_manifest` afterwards
carrying document ids, counts, characters and any truncation, so the log says
not just that an export happened but exactly what left.

**Never logged: document contents.** No essay text, no transcript text, no
profile fields, no signed URL, no token, no password. The reason is in the
schema comment and it is a real constraint: the log has to be safe to keep
long after a deletion request has been honoured. If it held the file, deleting
the file would not delete the file.

**But the log is not free of personal data.** It contains file names, the email
addresses of role-change targets, search strings staff typed (which are usually
names or addresses), and IPs. Treat `admin_audit` as sensitive in its own
right. Access matches that: administrators and owners can read it; **reviewers
cannot read it at all**, including their own rows, because a readable log
doubles as a way to enumerate which accounts exist.

**It cannot be rewritten from the app.** There is no client `INSERT` policy and
no `UPDATE` or `DELETE` policy anywhere, and beyond RLS the
`admin_audit_no_update` / `admin_audit_no_delete` triggers raise on any attempt
— triggers fire regardless of which key you hold, so even the secret key cannot
quietly edit history. A superuser in the SQL editor could drop those triggers,
which is one more reason the dashboard login is the crown jewel.

**Some denials are invisible.** Refusals thrown before the role lookup write no
audit row, because the actor is not established yet or the guard exits early:
an invalid or missing token, `email_unconfirmed`, `session_expired` (over 8
hours), and `reauth_required` on a sensitive route. Logged denials are
`no_active_role`, `ip_not_allowed`, `mfa_required` and `insufficient_role`.
Do not read an empty log as "nobody tried".

**No retention or purge exists.** Rows accumulate indefinitely, and
`subject_id` carries no foreign key, so entries survive the deletion of the
user they name as a bare uuid. That is deliberate for a trail; it is also an
open question you should answer with an explicit retention decision rather than
by default.

**Documents are only reachable through the audited path.** Staff have no
storage policy on the `documents` bucket. `api/admin/document.ts` authorizes,
writes the audit row, and *only then* mints a 120-second signed URL, never
returning the permanent storage path. The order is the point: a failure to log
is a failure to access.

Everything around that route is built to keep it the only door. The case view
(`GET /api/admin/case`) returns document **metadata** only, and strips the long
free-text fields out of the profile blob — `essayText`, `activitiesText`,
`awardsText` are the same material as an upload, so they follow the same rule:
the case view reports how much is there, the document route hands over the
words. The export route mints no signed URLs at all. Without that discipline,
one fetch would open every file a student ever submitted and the log would show
a single line for it.

---

## 8. The data-access boundary

**Administrative access is permission to do the job the user asked for. It is
not permission for anything else.**

Specifically, holding a staff role does not authorize:

- training, fine-tuning or evaluating any model on user material;
- marketing, outreach, recruiting or newsletters;
- sharing or selling records to anyone outside the review;
- looking up someone you know, or a case you are not working on.

Each purpose is tracked separately in `public.consents`, with its own enum
value: `service_delivery`, `human_review`, `support`, `security`,
`product_improvement` (de-identified only), `marketing`.
`public.has_consent(user, purpose)` returns the most recent answer for one
purpose and **defaults to false when there is no row** — silence is not
consent.

### Why staff cannot write a consent row

The only insert policy on `consents` is `auth.uid() = user_id`. There is no
staff insert policy, and no `UPDATE` or `DELETE` policy at all, so a record can
only be created by the person it describes, from their own session, and cannot
be edited afterwards.

This matters because of what a consent record is *for*. It is evidence, and
evidence that the interested party can manufacture is not evidence. If an
administrator could write "granted" into someone's row, then no row in the
table would mean anything — not the ones staff wrote, and not the honest ones
either, because from the outside they are indistinguishable. Keeping the write
path exclusively with the user is what makes the whole table worth consulting.
The operational consequence is simple and deliberately inconvenient: an
administrator who wants a different answer has to go and ask for it.

**The one hole, stated plainly.** The secret key bypasses RLS, as it must. So
the guarantee above rests on there being no server route that writes
`consents` — which is true today, and is an invariant to defend in code review,
not a property the database enforces against your own server. If a route ever
needs to record a consent, it must be triggered by the user's own action in
their own session and record `source` and `ip` from that session.

**Also honest: nothing enforces consent yet.** `has_consent()` is not called
from any TypeScript in this repo. The case view surfaces each of the six
purposes and its current answer, so a reviewer can see what someone agreed to;
no API path currently *refuses* an action because consent is absent. Until one
does, purpose limitation is a discipline you keep, not a control that keeps you
— and the same applies to `api/contribute.ts`, which must stay unwired to the
UI until the consent checkbox and privacy copy exist (see `DEPLOY.md`).

### Exporting someone's record

`POST /api/admin/export` assembles everything held about one person into a
single response. It is the request that moves the most private data in the
product, and it is the right tool for exactly two jobs: a user asking for their
own copy (CCPA/CPRA gives Californians that right — see `supabase/SETUP.md`),
and a support or incident case that genuinely needs the whole picture.

```sh
curl -sS -X POST "https://<your-domain>/api/admin/export" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"userId":"<uuid>","includeContent":true,"reason":"Subject access request received 2026-09-04, ticket 118"}'
```

The brakes on it, all in `api/admin/export.ts`:

- administrator and above — never a reviewer
- `sensitive: true`, so the session must have authenticated recently (with the
  caveat in gap 4 about what "recently" currently measures)
- **a written reason of at least 10 characters is required**, stored on the
  audit row. Not a checkbox — a sentence someone can read back to you later
- five exports per hour per actor (in-memory and per-instance, so a speed bump
  plus a trail rather than a hard cap)
- ceilings on rows and characters: 100 documents, 100k characters each, 400k
  total, and the truncation is reported in the manifest
- `includeContent` defaults to **false** — ask for the words only when the job
  needs the words
- no signed URLs: stored files are listed as metadata and must still be opened
  one at a time through `/api/admin/document`, so a bulk route cannot collapse
  dozens of individually-logged accesses into one line

Treat the output like the file it is: a minor's transcripts and essays in one
blob. Send it over a channel you would be happy to describe in an incident
report, and delete your local copy when the request is closed.

---

## 9. Incident response

### Suspected credential compromise

Assume compromise if a factor is lost, a laptop is stolen, a password was
reused on a breached site, or the audit log shows activity the person denies.

1. **Revoke first, investigate second** (§5). Access is cheap to restore.
2. Release their assignments.
3. Terminate their sessions (`delete from auth.sessions …`) — do not rely on
   the route's sign-out call.
4. Scope it. Everything that id did, and every case it touched:

   ```sql
   select created_at, action, subject_id, document_id, success, ip, user_agent, meta
   from public.admin_audit
   where actor_id = '<uuid>' and created_at > '<date you trust>'
   order by created_at desc;

   select distinct subject_id from public.admin_audit
   where actor_id = '<uuid>' and created_at > '<date you trust>'
     and subject_id is not null;
   ```

   Compare IPs and user agents against what that person normally uses.
5. Remove their MFA factors and have them re-enrol on a device you have seen
   (§2), and reset the password.
6. Re-grant the role only after the account is provably back under their
   control — and re-grant the **smallest** role, not the one they had.
7. If the compromised credential was the Supabase dashboard login rather than
   an app account, treat it as total: rotate the secret key (below), review
   `staff_roles` for rows you did not create, and check whether the audit
   triggers still exist:

   ```sql
   select tgname from pg_trigger where tgrelid = 'public.admin_audit'::regclass;
   -- expect admin_audit_no_update and admin_audit_no_delete
   ```

### Suspected data exposure

1. **Preserve the record before anything else.** The audit log cannot be edited
   through the app, which is what makes it worth reading now. Export the
   relevant window to a file and keep it outside the system.
2. Scope by subject, not by actor:

   ```sql
   select created_at, actor_id, actor_role, action, document_id, reason, ip
   from public.admin_audit
   where subject_id = '<applicant uuid>'
   order by created_at desc;
   ```

   That query answers "who has ever touched this student's file", which is the
   question they will actually ask you.
3. Work out which users are affected and what specifically was exposed
   (metadata, or contents).
4. Close the hole before notifying, so the notice is true.
5. Notify. This is not legal advice: US state breach-notification law, CCPA/CPRA
   and — because many of these users are minors — parental-notice expectations
   all bear on the timing and the wording. Get advice, and do not let getting
   advice become the reason nobody is told.
6. Write down what happened and what changed. A runbook that never grows after
   an incident is a runbook nobody used.

### Rotating the service-role key

Rotate on any suspicion the key was exposed — a commit, a log, a screenshot, a
laptop, a departing contractor — and on a schedule regardless.

This project uses Supabase's **new API key format** (the publishable key in
`.env.local` begins `sb_publishable_`), which means secret keys can be created
and revoked individually, several can be valid at once, and rotating one does
**not** invalidate the publishable key or sign users out. Zero downtime:

1. Dashboard → Project Settings → API Keys → create a second **secret** key.
   Name it with the date.
2. Update `SUPABASE_SERVICE_ROLE_KEY` everywhere it is set. There are two
   deployment targets in this repo and both use that variable name — Vercel
   (`api/*.ts`, per `DEPLOY.md`) and Cloudflare Pages
   (`functions/api/contribute.ts`, per `CLOUDFLARE.md`). Missing one leaves a
   dead service after step 4.
3. Redeploy. Vercel applies environment changes to new deployments only.
4. Verify before revoking. An admin route must return real data, not
   `500 Admin API is not configured.`:

   ```sh
   curl -sS -i "https://<your-domain>/api/admin/cases" -H "authorization: Bearer $TOKEN"
   ```

5. Revoke the old secret key in the dashboard.
6. Confirm again after revocation, and check the audit log is still receiving
   rows — a broken key makes `audit()` fail, and a failed audit write turns
   every admin request into `500 Could not record this access; the action was
   refused.` That failure mode is loud on purpose.

If a project ever falls back to the legacy `eyJ…` JWT keys, rotation is a very
different operation: anon and service_role are both signed by the project's JWT
secret, so rotating it invalidates the anon key too and signs every user out.
Plan that as maintenance, not as a quick fix.

Finally: if the key was ever in git, rotating is necessary but not sufficient —
the old value stays in history until the history is rewritten.

---

## Known gaps — read this before you rely on anything above

Stated plainly, because a runbook that oversells its protections is worse than
none.

1. **The rate limit is in-memory, per serverless instance.** `rateLimit()` in
   `api/_admin.ts` allows 60 requests per minute per IP, in a `Map` that lives
   in one instance's memory. Vercel spreads load across instances and cold
   starts reset it, so the real ceiling is higher than 60/min and is not a
   guarantee against a distributed or patient attacker. It raises cost; it does
   not stop anything. Move to Upstash Redis or a WAF rule before the admin
   routes face the open internet.
2. **Email confirmation is disabled** in the live project (`supabase/SETUP.md`).
   Supabase stamps `email_confirmed_at` at sign-up when confirmation is off, so
   the checks in `requireStaff()` and `api/admin/role.ts` pass for addresses
   nobody has proved they can read. Connect SMTP and switch confirmation back
   on; until then, verify staff identity out of band.
3. **The IP allow-list is exact string match, not CIDR** — despite the column
   comment on `staff_roles.ip_allow` saying CIDR. The check is
   `allow.includes(ip)` against the first entry of `X-Forwarded-For`. Only
   literal single addresses work; ranges, IPv6 forms of the same host, and a
   changed home IP all fail closed and lock the account out, fixable only from
   the SQL editor. On Vercel the forwarded header is set by the platform, so it
   is trustworthy there; behind any other proxy, satisfy yourself that a client
   cannot forge it before relying on this at all.
4. **"Recent authentication" is really "recent token".** `sessionAgeMs()` reads
   the access token's `iat`. Supabase silently refreshes access tokens roughly
   hourly, which resets `iat` without anyone re-entering a credential — so the
   8-hour session cap effectively never fires for an active client, and the
   15-minute `sensitive: true` window can be satisfied by refreshing a token
   rather than by proving who you are. Treat it as "recently active", not
   "recently authenticated", and do not lean on it as the control that stops a
   stolen unlocked laptop.
5. **No MFA enrolment exists in the app** (§2). The admin portal reads the
   current session's access token and sends it as a bearer; nothing in `src/`
   calls `mfa.enroll`, `mfa.challenge` or `mfa.verify`, so every staff request
   returns the `aal1` refusal until a factor is enrolled out of band. Blocking,
   and the first thing to build.
6. **The audit trail has one blind spot: the SQL editor.** Every route logs
   before it acts, but a dashboard session can read `profiles`, `documents`,
   `admin_audit` and `consents` directly, assign a case, or revoke a role,
   leaving nothing in `admin_audit`. Supabase keeps its own dashboard logs, but
   they are not this log. Keep org membership tiny and treat dashboard access as
   the highest privilege in the system.
7. **The revocation sign-out call does not work** (§5).
   `sb.auth.admin.signOut(userId, "global")` in `api/admin/role.ts` passes a
   user id where supabase-js expects a JWT; the resulting error is returned,
   not thrown, and is discarded. Admin access still dies on the next request
   because the role is re-read every time — but the person's ordinary session
   is not terminated, contrary to the comment above that line.
8. **`admin_alerts` may be readable by the anon key.** It is a plain view
   without `security_invoker`, so it executes with its owner's privileges and
   the `admins read audit` policy on `admin_audit` is not applied to reads
   through it. A request to `/rest/v1/admin_alerts` with the public anon key
   returns HTTP 200 (empty today only because `admin_audit` has no rows yet),
   rather than a permission error — which indicates the anon role does hold
   SELECT on the view. Check and fix:

   ```sql
   select relname, reloptions from pg_class where relname = 'admin_alerts';
   select grantee, privilege_type from information_schema.role_table_grants
   where table_name = 'admin_alerts';

   -- fix (PostgreSQL 15+):
   alter view public.admin_alerts set (security_invoker = on);
   revoke all on public.admin_alerts from anon, authenticated;
   ```

   `security_invoker` makes the querying user's RLS apply, so the view stops
   handing out rows the reader could not have selected from `admin_audit`
   itself. The `revoke` then removes direct REST access altogether, which costs
   nothing: the portal reads this view through `/api/admin/alerts` with the
   secret key, not from the browser. Both lines belong in `supabase/admin.sql`
   so a fresh project does not repeat this.
9. **Nothing enforces `has_consent()`** (§8), and no route writes consents,
   which is the safe half of that statement.
10. **No audit retention policy** (§7).
11. **The bundle secret-scan is name-based for new-format keys.**
    `tests/no-secrets-in-bundle.test.ts` decodes `eyJ…` JWTs to catch a leaked
    legacy `service_role` key by value; an `sb_secret_…` key would only be
    caught by the variable-name check. Worth extending now that this project
    uses the new format.

---

## Troubleshooting

Every message a staff member can see, and what it means. Order matters —
`requireStaff()` checks these top to bottom, so the first failure is the one
reported.

| Status and message | Cause | Fix |
|---|---|---|
| `429 Too many requests.` | Over 60 requests/min from this IP on one instance | Wait a minute. If it is not you, see gap 1. |
| `401 Sign in required.` | No bearer token, or the token failed verification | Sign in again. Repeated hits from one id are worth a look. |
| `403 Confirm your email address first.` | `email_confirmed_at` is null | Confirm the address. Not audited. |
| `403 Not authorized.` | No active `staff_roles` row, or the role ranks below the route's minimum | Expected after revocation. Audited as `no_active_role` or `insufficient_role`. |
| `403 Not authorized from this network.` | `ip_allow` is set and the request IP is not an exact match | See gap 3. Clear `ip_allow` from the SQL editor if it has locked someone out. |
| `403 Multi-factor authentication is required for staff accounts.` | Token is `aal1` | Complete the TOTP challenge, or enrol (§2). Audited. |
| `401 Your admin session has expired. Sign in again.` | Token `iat` older than 8 hours | Sign in again. Not audited. See gap 4. |
| `401 Confirm your password again to continue.` | Sensitive route, token older than 15 minutes | Re-authenticate and retry within the window. Not audited. |
| `403 That case isn't assigned to you.` | Reviewer opening an unassigned case or document | Assign it (§4) if the work is real. Audited with `reason: not_assigned`. |
| `403 You can't change your own role. Ask another owner.` | Self-modification | This is why you keep two owners. Audited. |
| `409 That's the last owner — promote someone else first.` | Revoking the only active owner | Promote a replacement first. Audited. |
| `409 That account hasn't confirmed its email address yet.` | Granting a role to an unconfirmed account | See gap 2. |
| `409 That account isn't staff.` | Assigning a case to someone with no active role | Grant the role first (§3). Audited as a failed `assign_case`. |
| `409 That reviewer already has the maximum number of open cases.` | 200 open assignments | Release finished work (§4). If it is not a mistake, the ceiling is in `assign.ts`. |
| `409 This case already has the maximum number of reviewers.` | 10 reviewers on one applicant | Almost always a mistake. Check who is on it and why. |
| `404 That reviewer isn't assigned to this case.` | Releasing an assignment that is already released | Nothing to do. Audited as a failed `release_case`. |
| `404 No such case.` | Subject id is not a row in `profiles` | Check the id. |
| `400 An export needs a written reason.` | Export reason under 10 characters | Write a sentence. Audited as a failed `export_user` with `no_reason_given`. |
| `429 Too many exports. Wait before running another.` | Over 5 exports in an hour by this actor | Wait. If you legitimately need more, that is worth a conversation first. |
| `400 Unknown action filter.` | An `action=` value on the audit route that is not one we write | Use a name from the table in §7. |
| `500 Admin API is not configured.` | `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` missing where the function runs | Set them and redeploy (§0, §9). |
| `500 Could not record this access; the action was refused.` | The audit insert failed | Working as designed: no log, no access. Check the database and the key. |
| `500 Could not check authorization.` | The `staff_roles` read failed | Database or key problem. |

---

## Quick reference

| Task | Where | Minimum role | Audited |
|---|---|---|---|
| Seed the first owner | SQL editor (§1) | — | No |
| Enrol MFA | Script, until the app does it (§2) | — | No |
| Grant or revoke a role | `POST /api/admin/role` (§3, §5) | owner, recent auth | Yes |
| Emergency revoke | SQL editor (§5) | — | No — write it down |
| Assign or release a case | `POST /api/admin/assign` (§4) | administrator | Yes |
| List cases | `GET /api/admin/cases` | reviewer (scoped) | Yes |
| Open one case | `GET /api/admin/case?id=` | reviewer (scoped) | Yes, before access |
| Open a document | `POST /api/admin/document` | reviewer (scoped) | Yes, before access |
| Export a person's record | `POST /api/admin/export` (§8) | administrator, recent auth, written reason | Yes, twice |
| Search the log | `GET /api/admin/audit` (§6) | administrator | Yes — the search itself |
| Check alerts | `GET /api/admin/alerts` (§6) | administrator | Yes |
| Review who holds what | SQL editor (§6) | — | No |
| Rotate the secret key | Supabase dashboard + Vercel + Cloudflare (§9) | — | No |
