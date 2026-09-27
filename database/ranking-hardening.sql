-- Phase 2 ranking hardening.
-- Apply once in Supabase production before using the hardened refresh_rankings().

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Ranking_period_valid'
      AND conrelid = 'public."Ranking"'::regclass
  ) THEN
    ALTER TABLE public."Ranking"
      ADD CONSTRAINT "Ranking_period_valid"
      CHECK ("period" IN ('live','weekly','monthly','yearly'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Ranking_rank_range'
      AND conrelid = 'public."Ranking"'::regclass
  ) THEN
    ALTER TABLE public."Ranking"
      ADD CONSTRAINT "Ranking_rank_range"
      CHECK ("rank" BETWEEN 1 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Ranking_score_nonnegative'
      AND conrelid = 'public."Ranking"'::regclass
  ) THEN
    ALTER TABLE public."Ranking"
      ADD CONSTRAINT "Ranking_score_nonnegative"
      CHECK ("score" >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Ranking_period_gameId_unique_idx"
  ON public."Ranking" ("period", "gameId");

CREATE UNIQUE INDEX IF NOT EXISTS "Ranking_period_rank_unique_idx"
  ON public."Ranking" ("period", "rank");

-- Ranking period definitions used by refresh_rankings():
-- live   = latest qualifying snapshot, within 15 minutes
-- weekly = current UTC calendar week, Monday through Sunday
-- monthly = current UTC calendar month
-- yearly = 365 UTC calendar dates
--
-- See database/cloudflare-collector-functions.sql for the canonical function body.
