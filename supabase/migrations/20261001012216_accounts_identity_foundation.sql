-- Phase 6.7 account, identity, and persistent-user-data foundation.
-- Additive only: does not modify ranking or collector tables.

create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_watchlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id bigint not null references public."Game"(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create table if not exists public.user_alert_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  alerts_enabled boolean not null default true,
  top10_enabled boolean not null default true,
  new_peak_enabled boolean not null default true,
  rank_jump_enabled boolean not null default true,
  rank_jump_threshold smallint not null default 5
    check (rank_jump_threshold between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saved_comparisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id_a bigint not null references public."Game"(id) on delete cascade,
  game_id_b bigint not null references public."Game"(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (game_id_a <> game_id_b)
);

create unique index if not exists saved_comparisons_pair_unique
  on public.saved_comparisons (
    user_id,
    least(game_id_a, game_id_b),
    greatest(game_id_a, game_id_b)
  );

create index if not exists user_watchlist_created_at_idx
  on public.user_watchlist (user_id, created_at desc);

create index if not exists saved_comparisons_created_at_idx
  on public.saved_comparisons (user_id, created_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80), '')
  )
  on conflict (id) do nothing;

  insert into public.user_alert_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role, supabase_auth_admin;

revoke all on function private.set_updated_at() from public;
grant execute on function private.set_updated_at() to authenticated, service_role, supabase_auth_admin;

revoke all on function private.handle_new_user() from public;
grant execute on function private.handle_new_user() to supabase_auth_admin, service_role;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

drop trigger if exists alert_preferences_set_updated_at on public.user_alert_preferences;
create trigger alert_preferences_set_updated_at
before update on public.user_alert_preferences
for each row execute function private.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.user_watchlist enable row level security;
alter table public.user_alert_preferences enable row level security;
alter table public.saved_comparisons enable row level security;

drop policy if exists profiles_public_select on public.profiles;
create policy profiles_public_select
on public.profiles
for select
to anon
using (is_public = true);

drop policy if exists profiles_authenticated_select on public.profiles;
create policy profiles_authenticated_select
on public.profiles
for select
to authenticated
using (is_public = true or (select auth.uid()) = id);

drop policy if exists profiles_authenticated_update on public.profiles;
create policy profiles_authenticated_update
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists profiles_authenticated_delete on public.profiles;
create policy profiles_authenticated_delete
on public.profiles
for delete
to authenticated
using ((select auth.uid()) = id);

drop policy if exists watchlist_select_own on public.user_watchlist;
create policy watchlist_select_own
on public.user_watchlist
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists watchlist_insert_own on public.user_watchlist;
create policy watchlist_insert_own
on public.user_watchlist
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists watchlist_delete_own on public.user_watchlist;
create policy watchlist_delete_own
on public.user_watchlist
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists alerts_select_own on public.user_alert_preferences;
create policy alerts_select_own
on public.user_alert_preferences
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists alerts_insert_own on public.user_alert_preferences;
create policy alerts_insert_own
on public.user_alert_preferences
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists alerts_update_own on public.user_alert_preferences;
create policy alerts_update_own
on public.user_alert_preferences
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists alerts_delete_own on public.user_alert_preferences;
create policy alerts_delete_own
on public.user_alert_preferences
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists saved_comparisons_select_own on public.saved_comparisons;
create policy saved_comparisons_select_own
on public.saved_comparisons
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists saved_comparisons_insert_own on public.saved_comparisons;
create policy saved_comparisons_insert_own
on public.saved_comparisons
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists saved_comparisons_delete_own on public.saved_comparisons;
create policy saved_comparisons_delete_own
on public.saved_comparisons
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.user_watchlist from anon, authenticated;
revoke all on table public.user_alert_preferences from anon, authenticated;
revoke all on table public.saved_comparisons from anon, authenticated;

grant select on table public.profiles to anon;
grant select, update, delete on table public.profiles to authenticated;

grant select, insert, delete on table public.user_watchlist to authenticated;
grant select, insert, update, delete on table public.user_alert_preferences to authenticated;
grant select, insert, delete on table public.saved_comparisons to authenticated;

grant all on table public.profiles, public.user_watchlist, public.user_alert_preferences, public.saved_comparisons to service_role;
