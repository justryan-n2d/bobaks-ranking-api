-- PostgREST upserts require UPDATE privileges for ON CONFLICT DO UPDATE.
-- Keep UPDATE restricted to the signed-in user's own watchlist rows.
drop policy if exists watchlist_update_own on public.user_watchlist;
create policy watchlist_update_own
on public.user_watchlist
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant update on table public.user_watchlist to authenticated;
