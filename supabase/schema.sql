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

-- ---------- Sharing ----------
-- A share link is /?g=<slug>, and only gradients published to the community can be shared. The slug is an unguessable
-- id, so the link opens that one published gradient for anyone (signed in or not) without listing anything else.
-- (An earlier version could also share private gradients; this drops it.)
drop function if exists public.share_gradient(jsonb, text, text, text);

create or replace function public.gradient_by_slug(p_slug text)
returns table (config jsonb, author_name text, author_twitter text)
language sql stable security definer set search_path = public
as $$
  select g.config, g.author_name, g.author_twitter from public.gradients g where g.slug = p_slug and g.is_public limit 1;
$$;
revoke all on function public.gradient_by_slug(text) from public;
grant execute on function public.gradient_by_slug(text) to anon, authenticated;

-- ---------- Deleting an account ----------
-- Lets a signed-in user delete their own account from Settings. Removing the auth user cascades (the user_id foreign key
-- above is `on delete cascade`) to every gradient they saved or published. The function runs with elevated rights
-- because browsers can't delete auth users directly, but it can only ever delete the caller's own account.
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- Likes ----------
-- Anyone can like a published gradient, signed in or not. A "voter" is a text id: 'u:<account id>' when signed in,
-- 'd:<random>' for a browser that isn't. The table has row-level security on and no policies, so browsers can't touch it
-- directly; they go through the three functions below. (A determined visitor can mint extra device ids, so treat the
-- count as a popularity hint, not a vote.)
create table if not exists public.gradient_likes (
  gradient_id uuid not null references public.gradients (id) on delete cascade,
  voter       text not null check (char_length(voter) between 3 and 80),
  created_at  timestamptz not null default now(),
  primary key (gradient_id, voter)
);
alter table public.gradient_likes enable row level security;

create or replace function public.like_counts()
returns table (gradient_id uuid, n bigint)
language sql stable security definer set search_path = public
as $$
  select l.gradient_id, count(*) from public.gradient_likes l join public.gradients g on g.id = l.gradient_id where g.is_public group by l.gradient_id;
$$;
create or replace function public.my_likes(p_voter text)
returns table (gradient_id uuid)
language sql stable security definer set search_path = public
as $$
  select l.gradient_id from public.gradient_likes l where l.voter = p_voter;
$$;
create or replace function public.set_like(p_gradient uuid, p_voter text, p_liked boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_liked then
    insert into public.gradient_likes (gradient_id, voter) select g.id, p_voter from public.gradients g where g.id = p_gradient and g.is_public on conflict do nothing;
  else
    delete from public.gradient_likes where gradient_id = p_gradient and voter = p_voter;
  end if;
end;
$$;
revoke all on function public.like_counts() from public;
revoke all on function public.my_likes(text) from public;
revoke all on function public.set_like(uuid, text, boolean) from public;
grant execute on function public.like_counts() to anon, authenticated;
grant execute on function public.my_likes(text) to anon, authenticated;
grant execute on function public.set_like(uuid, text, boolean) to anon, authenticated;
