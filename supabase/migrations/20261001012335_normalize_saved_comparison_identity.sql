-- Canonicalize saved comparison identity so game A/B order cannot create duplicates.
alter table public.saved_comparisons
  drop constraint if exists saved_comparisons_game_order;

alter table public.saved_comparisons
  add constraint saved_comparisons_game_order
  check (game_id_a < game_id_b);

drop index if exists public.saved_comparisons_pair_unique;

alter table public.saved_comparisons
  add constraint saved_comparisons_pair_unique
  unique (user_id, game_id_a, game_id_b);
