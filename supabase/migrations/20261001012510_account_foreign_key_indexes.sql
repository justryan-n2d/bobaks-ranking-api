-- Index foreign-key columns used by future watchlist/comparison lookups and cascades.
create index if not exists user_watchlist_game_id_idx
  on public.user_watchlist (game_id);

create index if not exists saved_comparisons_game_id_a_idx
  on public.saved_comparisons (game_id_a);

create index if not exists saved_comparisons_game_id_b_idx
  on public.saved_comparisons (game_id_b);
