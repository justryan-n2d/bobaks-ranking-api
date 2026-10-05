-- Phase 6.7 explicit Roblox identity visibility controls.
-- Additive only: preserves existing account, ranking, and identity data.

create table if not exists public.user_identity_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  show_roblox_identity boolean not null default false,
  show_roblox_avatar boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (show_roblox_avatar = false or show_roblox_identity = true)
);

drop trigger if exists identity_preferences_set_updated_at on public.user_identity_preferences;
create trigger identity_preferences_set_updated_at
before update on public.user_identity_preferences
for each row execute function private.set_updated_at();

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

  insert into public.user_identity_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

alter table public.user_identity_preferences enable row level security;

drop policy if exists identity_preferences_select_own on public.user_identity_preferences;
create policy identity_preferences_select_own
on public.user_identity_preferences
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists identity_preferences_insert_own on public.user_identity_preferences;
create policy identity_preferences_insert_own
on public.user_identity_preferences
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists identity_preferences_update_own on public.user_identity_preferences;
create policy identity_preferences_update_own
on public.user_identity_preferences
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists identity_preferences_delete_own on public.user_identity_preferences;
create policy identity_preferences_delete_own
on public.user_identity_preferences
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.user_identity_preferences from anon, authenticated;
grant select, insert, update, delete on table public.user_identity_preferences to authenticated;
grant all on table public.user_identity_preferences to service_role;
