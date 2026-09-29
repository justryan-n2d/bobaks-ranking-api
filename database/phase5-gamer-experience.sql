-- Phase 5 gamer-facing database helpers.
-- The canonical deployment copy is the matching Supabase migration.

ALTER TABLE public."Ranking"
  ADD COLUMN IF NOT EXISTS "previousRank" integer;

ALTER TABLE public."Ranking"
  DROP CONSTRAINT IF EXISTS "Ranking_previousRank_valid";

ALTER TABLE public."Ranking"
  ADD CONSTRAINT "Ranking_previousRank_valid"
  CHECK ("previousRank" IS NULL OR ("previousRank" >= 1 AND "previousRank" <= 100));

CREATE INDEX IF NOT EXISTS "Ranking_game_period_idx"
  ON public."Ranking" ("gameId", "period");

CREATE OR REPLACE FUNCTION public.get_game_current_stats(p_game_id bigint)
RETURNS TABLE ("playerCount" integer, "snapshotAt" timestamptz)
LANGUAGE sql SECURITY INVOKER AS $$
  SELECT s."playerCount", s."timestamp"
  FROM public."GameSnapshot" s
  LEFT JOIN public."DataCollectionLog" l ON l."collectionRunId"=s."collectionRunId"
  WHERE s."gameId"=p_game_id
    AND s."timestamp"<=now()
    AND (s."collectionRunId" IS NULL OR l."status" IN ('success','partial'))
  ORDER BY s."timestamp" DESC, s."id" DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_game_current_stats(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_game_current_stats(bigint) TO service_role;
ALTER FUNCTION public.get_game_current_stats(bigint) SET search_path=public,pg_temp;

CREATE OR REPLACE FUNCTION public.get_game_rank_history(p_game_id bigint,p_days integer DEFAULT 31)
RETURNS TABLE ("date" date,"rank" integer,"averagePlayers" double precision,"gamesRanked" bigint)
LANGUAGE sql SECURITY INVOKER AS $$
  WITH bounds AS (
    SELECT (CURRENT_DATE-GREATEST(1,LEAST(COALESCE(p_days,31),365))+1) AS start_day,CURRENT_DATE AS end_day
  ),
  historical AS (
    SELECT d."gameId",(d."date" AT TIME ZONE 'UTC')::date AS day,d."averagePlayers"
    FROM public."DailyGameStat" d CROSS JOIN bounds b
    WHERE (d."date" AT TIME ZONE 'UTC')::date >= b.start_day
      AND (d."date" AT TIME ZONE 'UTC')::date <= b.end_day
      AND (d."date" AT TIME ZONE 'UTC')::date < CURRENT_DATE
    UNION ALL
    SELECT s."gameId",(s."timestamp" AT TIME ZONE 'UTC')::date AS day,
      AVG(s."playerCount")::double precision AS "averagePlayers"
    FROM public."GameSnapshot" s CROSS JOIN bounds b
    WHERE (s."timestamp" AT TIME ZONE 'UTC')::date >= b.start_day
      AND (s."timestamp" AT TIME ZONE 'UTC')::date <= b.end_day
      AND (s."timestamp" AT TIME ZONE 'UTC')::date = CURRENT_DATE
      AND s."timestamp" <= now()
    GROUP BY s."gameId",(s."timestamp" AT TIME ZONE 'UTC')::date
  ),
  ranked AS (
    SELECT h.day,h."gameId",h."averagePlayers",
      ROW_NUMBER() OVER (PARTITION BY h.day ORDER BY h."averagePlayers" DESC,h."gameId" ASC)::integer AS rank,
      COUNT(*) OVER (PARTITION BY h.day)::bigint AS games_ranked
    FROM historical h JOIN public."Game" g ON g."id"=h."gameId"
    WHERE g."isActive"=true AND h."averagePlayers" IS NOT NULL
  )
  SELECT r.day AS "date",r.rank,r."averagePlayers",r.games_ranked AS "gamesRanked"
  FROM ranked r WHERE r."gameId"=p_game_id ORDER BY r.day ASC;
$$;

REVOKE ALL ON FUNCTION public.get_game_rank_history(bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_game_rank_history(bigint,integer) TO service_role;
ALTER FUNCTION public.get_game_rank_history(bigint,integer) SET search_path=public,pg_temp;
