-- Transfer Chance Me — staff roles, case assignment, consent and audit.
--
-- Run AFTER schema.sql, in the Supabase SQL editor. Idempotent.
--
-- The security model, stated once so it is not re-derived from the policies:
--
--   1. A user's role is NEVER read from the JWT, from user_metadata, or from
--      anything else the browser can influence. user_metadata is editable by
--      the user themselves — trusting it would let anyone make themselves an
--      owner with one API call. Roles live only in public.staff_roles, which
--      no client key may write.
--   2. staff_roles has NO insert/update/delete policy for authenticated
--      users. With RLS on and no permissive policy, those writes are denied
--      for everyone holding an anon or user token. Only the service_role key
--      — server-side only, never in the browser bundle — can grant a role.
--   3. Every admin read path is expressed as a policy here AND re-checked in
--      the API layer. The policy is the backstop, not the only gate.
--   4. admin_audit is append-only by construction: there is an INSERT policy
--      and a SELECT policy, and deliberately no UPDATE or DELETE policy, so
--      staff cannot rewrite or erase their own trail through the app.

-- ── Roles ──────────────────────────────────────────────────────────────────
do $$ begin
  create type public.staff_role as enum ('reviewer', 'administrator', 'owner');
exception when duplicate_object then null; end $$;

create table if not exists public.staff_roles (
  user_id     uuid primary key references auth.users on delete cascade,
  role        public.staff_role not null,
  granted_by  uuid references auth.users on delete set null,
  granted_at  timestamptz not null default now(),
  -- Revocation is a timestamp rather than a delete so the grant remains in
  -- the record. Access checks require revoked_at is null.
  revoked_at  timestamptz,
  -- Optional CIDR allow-list, intended for owners.
  ip_allow    text[],
  note        text
);

create index if not exists staff_roles_active_idx
  on public.staff_roles (user_id) where revoked_at is null;

alter table public.staff_roles enable row level security;

-- Staff may read their OWN row (so the UI can tell whether to offer the admin
-- link at all). Nobody may write through a client key: no such policy exists.
drop policy if exists "read own staff row" on public.staff_roles;
create policy "read own staff row" on public.staff_roles
  for select using (auth.uid() = user_id);

-- ── The authoritative role lookup ──────────────────────────────────────────
-- security definer so it can read staff_roles regardless of the caller's own
-- policies; search_path pinned so it cannot be hijacked by a shadowing table.
create or replace function public.current_staff_role()
returns public.staff_role
language sql stable security definer set search_path = public as $$
  select role from public.staff_roles
  where user_id = auth.uid() and revoked_at is null
$$;

create or replace function public.is_staff_at_least(min public.staff_role)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case
       when role = 'owner'         then 3
       when role = 'administrator' then 2
       when role = 'reviewer'      then 1
       else 0 end
     from public.staff_roles
     where user_id = auth.uid() and revoked_at is null)
    >= case
       when min = 'owner'         then 3
       when min = 'administrator' then 2
       when min = 'reviewer'      then 1
       else 0 end,
    false)
$$;

-- ── Case assignment ────────────────────────────────────────────────────────
-- A "case" is one applicant. Reviewers see only what is assigned to them;
-- administrators and owners may see all, and every view is logged.
create table if not exists public.case_assignments (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references auth.users on delete cascade,
  reviewer_id uuid not null references auth.users on delete cascade,
  assigned_by uuid references auth.users on delete set null,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  unique (subject_id, reviewer_id)
);
create index if not exists case_assign_reviewer_idx
  on public.case_assignments (reviewer_id) where released_at is null;

alter table public.case_assignments enable row level security;

drop policy if exists "reviewer reads own assignments" on public.case_assignments;
create policy "reviewer reads own assignments" on public.case_assignments
  for select using (
    reviewer_id = auth.uid() or public.is_staff_at_least('administrator')
  );
-- Writes are service_role only: assignment is an administrative act.

create or replace function public.can_view_case(subject uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    -- your own file, always
    subject = auth.uid()
    -- administrators and owners: any case, operationally
    or public.is_staff_at_least('administrator')
    -- reviewers: only what is currently assigned to them
    or exists (
      select 1 from public.case_assignments a
      where a.subject_id = subject
        and a.reviewer_id = auth.uid()
        and a.released_at is null
        and public.is_staff_at_least('reviewer')
    )
$$;

-- ── Staff read access to applicant data ────────────────────────────────────
-- Additive to the "own row" policies in schema.sql: Postgres ORs permissive
-- policies together, so users keep their own access and staff gain scoped
-- access. Note these are SELECT only — no staff policy grants UPDATE or
-- DELETE on a user's own record.
drop policy if exists "staff read cases" on public.profiles;
create policy "staff read cases" on public.profiles
  for select using (public.can_view_case(id));

drop policy if exists "staff read case docs" on public.documents;
create policy "staff read case docs" on public.documents
  for select using (public.can_view_case(user_id));

-- ── Consent ────────────────────────────────────────────────────────────────
-- Purposes are tracked separately: holding a file to deliver the service the
-- user paid for is not permission to train models on it or to market to them.
do $$ begin
  create type public.consent_purpose as enum (
    'service_delivery',      -- generate and review the report they asked for
    'human_review',          -- a person reads the file for quality
    'support',               -- looking at it to answer a support request
    'security',              -- abuse and fraud investigation
    'product_improvement',   -- de-identified only
    'marketing'              -- unrelated outreach
  );
exception when duplicate_object then null; end $$;

create table if not exists public.consents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  purpose    public.consent_purpose not null,
  granted    boolean not null,
  -- Recorded at the moment of the decision, from the user's own session.
  source     text,
  ip         inet,
  created_at timestamptz not null default now()
);
create index if not exists consents_user_idx on public.consents (user_id, purpose, created_at desc);

alter table public.consents enable row level security;

drop policy if exists "own consents read"  on public.consents;
drop policy if exists "own consents write" on public.consents;
drop policy if exists "staff read consents" on public.consents;
create policy "own consents read"  on public.consents
  for select using (auth.uid() = user_id);
-- A consent record may only be written by the user it belongs to. Staff
-- cannot silently change what someone agreed to; an administrator wanting a
-- different answer has to go and ask for it.
create policy "own consents write" on public.consents
  for insert with check (auth.uid() = user_id);
create policy "staff read consents" on public.consents
  for select using (public.can_view_case(user_id));

/** The current answer for one purpose — the most recent record wins. */
create or replace function public.has_consent(subject uuid, p public.consent_purpose)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select granted from public.consents
     where user_id = subject and purpose = p
     order by created_at desc limit 1),
    false)
$$;

-- ── Append-only audit log ──────────────────────────────────────────────────
create table if not exists public.admin_audit (
  id          bigserial primary key,
  actor_id    uuid not null references auth.users on delete restrict,
  actor_role  public.staff_role,
  action      text not null,
  subject_id  uuid,               -- the user whose record was touched
  document_id uuid,
  reason      text,
  success     boolean not null default true,
  ip          inet,
  user_agent  text,
  -- Metadata about the access. Never document contents: the log must be
  -- safe to keep long after a deletion request has been honoured.
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_audit_actor_idx   on public.admin_audit (actor_id, created_at desc);
create index if not exists admin_audit_subject_idx on public.admin_audit (subject_id, created_at desc);
create index if not exists admin_audit_action_idx  on public.admin_audit (action, created_at desc);

alter table public.admin_audit enable row level security;

-- Readable by administrators and owners. A reviewer cannot read the log at
-- all, including their own entries — otherwise the log doubles as a way to
-- enumerate which accounts exist.
drop policy if exists "admins read audit" on public.admin_audit;
create policy "admins read audit" on public.admin_audit
  for select using (public.is_staff_at_least('administrator'));

-- Deliberately absent: any INSERT policy for clients (writes go through the
-- server with the service key), and any UPDATE or DELETE policy at all. With
-- RLS enabled and no such policy, those statements are denied for every
-- non-service key — which is what makes this append-only from the app.

-- Belt and braces at the table level, so even a future mistaken policy or a
-- service-role slip cannot rewrite history.
create or replace function public.deny_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'admin_audit is append-only';
end $$;

drop trigger if exists admin_audit_no_update on public.admin_audit;
create trigger admin_audit_no_update before update on public.admin_audit
  for each row execute function public.deny_audit_mutation();

drop trigger if exists admin_audit_no_delete on public.admin_audit;
create trigger admin_audit_no_delete before delete on public.admin_audit
  for each row execute function public.deny_audit_mutation();

-- ── Private document storage ───────────────────────────────────────────────
-- Files live in a private bucket; the app never gets a permanent public URL,
-- only short-lived signed ones minted server-side after an authorization
-- check. Creating the bucket here keeps it out of manual dashboard steps
-- that are easy to get wrong.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;

-- Users may write only into their own folder: documents/<uid>/<file>.
drop policy if exists "own folder upload" on storage.objects;
create policy "own folder upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own folder read" on storage.objects;
create policy "own folder read" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own folder delete" on storage.objects;
create policy "own folder delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- Staff do NOT get a storage policy: admin document access goes through the
-- server, which mints a signed URL with the service key and writes an audit
-- row first. That keeps every staff document view on the record.

-- Where the file lives, alongside the extracted text.
alter table public.documents add column if not exists storage_path text;
alter table public.documents add column if not exists mime text;
alter table public.documents add column if not exists bytes bigint;

-- ── Sensitive-action alerting ──────────────────────────────────────────────
-- Unusual staff behaviour, computed from the log rather than trusted from the
-- client. Read by the admin dashboard; refreshed on demand.
create or replace view public.admin_alerts as
  select
    actor_id,
    'many_subjects' as kind,
    count(distinct subject_id) as value,
    max(created_at) as last_seen
  from public.admin_audit
  where created_at > now() - interval '1 hour' and subject_id is not null
  group by actor_id
  having count(distinct subject_id) >= 25
union all
  select actor_id, 'failed_actions', count(*), max(created_at)
  from public.admin_audit
  where created_at > now() - interval '15 minutes' and success = false
  group by actor_id
  having count(*) >= 5
union all
  select actor_id, 'bulk_export', count(*), max(created_at)
  from public.admin_audit
  where created_at > now() - interval '1 hour' and action in ('export_user', 'download_document')
  group by actor_id
  having count(*) >= 20;
