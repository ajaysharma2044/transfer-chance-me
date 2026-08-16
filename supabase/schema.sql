-- Transfer Chance Me — database schema.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New
-- query → paste → Run). It is idempotent, so re-running it is safe.
--
-- Every table is protected by row-level security: a signed-in user can read
-- and write only the rows carrying their own user id, and there is no policy
-- that grants anyone read access to anyone else's rows. The anon key shipped
-- in the browser therefore cannot be used to read another user's file, which
-- matters here because these tables hold transcripts and essays.

-- ── One row per account ────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  name        text,
  -- The engine's Profile object: GPA, institution, standing, major,
  -- credentials, and the free-text fields the student writes themselves.
  profile     jsonb,
  -- The "My Schools" tracker: { [school]: { status, notes } }
  schools     jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Uploaded and pasted material ───────────────────────────────────────────
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null check (kind in
                ('transcript', 'essay', 'statement', 'activities', 'awards')),
  name        text,
  content     text,
  created_at  timestamptz not null default now()
);
create index if not exists documents_user_idx on public.documents (user_id, kind);

-- ── Row-level security ─────────────────────────────────────────────────────
alter table public.profiles  enable row level security;
alter table public.documents enable row level security;

drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile write"  on public.profiles;
drop policy if exists "own profile update" on public.profiles;
drop policy if exists "own docs read"      on public.documents;
drop policy if exists "own docs write"     on public.documents;
drop policy if exists "own docs delete"    on public.documents;

create policy "own profile read"   on public.profiles
  for select using (auth.uid() = id);
create policy "own profile write"  on public.profiles
  for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "own docs read"   on public.documents
  for select using (auth.uid() = user_id);
create policy "own docs write"  on public.documents
  for insert with check (auth.uid() = user_id);
create policy "own docs delete" on public.documents
  for delete using (auth.uid() = user_id);

-- ── Keep updated_at honest ─────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── Create the profile row automatically on sign-up ────────────────────────
-- Without this, a brand-new Google user has no row until their first save.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
