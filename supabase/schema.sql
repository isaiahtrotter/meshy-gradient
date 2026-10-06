-- Saved gradients. Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Row-level security does the access control (the anon key in src/config.js ships to every browser, so it must):
--   anyone (signed in or not) can read rows marked is_public; only the owner can read their private rows;
--   only the owner can insert, update or delete their own rows.

create table if not exists public.gradients (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text,
  author_twitter text check (author_twitter is null or author_twitter ~ '^[A-Za-z0-9_]{1,15}$'),
  -- a short public id for sharing a gradient (a link can point at it); generated here, never typed by users
  slug        text not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  config      jsonb not null check (octet_length(config::text) <= 400000),
  thumb       text check (thumb is null or char_length(thumb) <= 80000),
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- fingerprint of the gradient itself (jsonb prints keys in a fixed order, so equal configs give equal hashes)
  config_hash text generated always as (md5(config::text)) stored
);

create index if not exists gradients_user_idx   on public.gradients (user_id, updated_at desc);
-- For a table created before gradients had a slug and lost their name: run these (each is a no-op once done).
-- Existing rows each get their own slug.
alter table public.gradients add column if not exists slug text not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
create unique index if not exists gradients_slug_key on public.gradients (slug);
alter table public.gradients drop column if exists name;

-- For a table created before author_twitter existed: run this line (a no-op otherwise).
alter table public.gradients add column if not exists author_twitter text check (author_twitter is null or author_twitter ~ '^[A-Za-z0-9_]{1,15}$');

-- For a table created before config_hash existed: run these two lines (a no-op otherwise).
alter table public.gradients add column if not exists config_hash text generated always as (md5(config::text)) stored;

-- Every published gradient must be unique: the same gradient can't be published twice, by anyone. Private saves may repeat.
-- If this fails with "could not create unique index", two published rows are already identical: delete one of them
-- (Table Editor → gradients, filter is_public) and run it again.
create unique index if not exists gradients_public_unique on public.gradients (config_hash) where is_public;

-- ...and you can't keep the same gradient twice in your own saved ones (each user's private rows are unique to them).
-- Same advice if this fails: two of your saved rows are identical, so delete the extra one first.
create unique index if not exists gradients_saved_unique on public.gradients (user_id, config_hash) where not is_public;

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

-- Owners may change only how a gradient is credited and whether it's public, never its id, owner, slug or content
-- fingerprint. (The app only ever updates author_name and author_twitter.)
revoke update on public.gradients from authenticated;
grant update (author_name, author_twitter, is_public, thumb, config, updated_at) on public.gradients to authenticated;
