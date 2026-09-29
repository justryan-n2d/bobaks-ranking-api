-- Phase 4 Part 6.1: database performance hardening.
--
-- The live production audit found this exact duplicate:
--   Ranking_period_rank_idx
--   Ranking_period_rank_unique_idx
--
-- The unique index already provides the same B-tree key ordering on
-- (period, rank) while also enforcing the existing uniqueness invariant.
-- No other index is removed by this change.

DROP INDEX IF EXISTS public."Ranking_period_rank_idx";
