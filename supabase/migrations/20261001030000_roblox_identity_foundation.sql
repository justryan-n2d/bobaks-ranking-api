-- Phase 6.7 Roblox identity foundation.
-- Additive only. OAuth token exchange and writes stay server-side.

create table if not exists public.roblox_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  roblox_user_id bigint not null,
  provider_subject text not null,
  username text,
  display_name text,
  profile_url text,
  avatar_url text,
  status text not null default 'connected'
    check (status in ('connected', 'revoked')),
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists roblox_identities_roblox_user_unique
  on public.roblox_identities (roblox_user_id);

create unique index if not exists roblox_identities_provider_subject_unique
  on public.roblox_identities (provider_subject);

drop trigger if exists roblox_identities_set_updated_at on public.roblox_identities;
create trigger roblox_identities_set_updated_at
before update on public.roblox_identities
for each row execute function private.set_updated_at();

alter table public.roblox_identities enable row level security;

drop policy if exists roblox_identity_select_own on public.roblox_identities;
create policy roblox_identity_select_own
on public.roblox_identities
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.roblox_identities from anon, authenticated;
grant select on table public.roblox_identities to authenticated;
grant all on table public.roblox_identities to service_role;
