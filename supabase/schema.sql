-- Saved gradients. Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Row-level security does the access control (the anon key in src/config.js ships to every browser, so it must):
--   anyone (signed in or not) can read rows marked is_public; only the owner can read their private rows;
--   only the owner can insert, update or delete their own rows.

create table if not exists public.gradients (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text,
  name        text not null default 'Untitled' check (char_length(name) <= 80),
  config      jsonb not null check (octet_length(config::text) <= 400000),
  thumb       text check (thumb is null or char_length(thumb) <= 80000),
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists gradients_user_idx   on public.gradients (user_id, updated_at desc);
create index if not exists gradients_public_idx on public.gradients (created_at desc) where is_public;

alter table public.gradients enable row level security;

drop policy if exists "read own or public" on public.gradients;
create policy "read own or public" on public.gradients
  for select to anon, authenticated
  using (is_public or auth.uid() = user_id);

drop policy if exists "insert own" on public.gradients;
create policy "insert own" on public.gradients
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "update own" on public.gradients;
create policy "update own" on public.gradients
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own" on public.gradients;
create policy "delete own" on public.gradients
  for delete to authenticated
  using (auth.uid() = user_id);
