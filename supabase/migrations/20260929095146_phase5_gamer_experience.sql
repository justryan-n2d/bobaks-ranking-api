-- Phase 5 gamer experience data support.
-- Adds persisted prior rank information and read-only game rank/history helpers.

ALTER TABLE public."Ranking"
  ADD COLUMN IF NOT EXISTS "previousRank" integer;

ALTER TABLE public."Ranking"
  DROP CONSTRAINT IF EXISTS "Ranking_previousRank_valid";

ALTER TABLE public."Ranking"
  ADD CONSTRAINT "Ranking_previousRank_valid"
  CHECK ("previousRank" IS NULL OR ("previousRank" >= 1 AND "previousRank" <= 100));

CREATE INDEX IF NOT EXISTS "Ranking_game_period_idx"
  ON public."Ranking" ("gameId", "period");

CREATE OR REPLACE FUNCTION public.refresh_rankings()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  calculated_at timestamptz := now();
  current_day_start timestamptz;
  current_week_start timestamptz;
  next_week_start timestamptz;
  current_month_start timestamptz;
  next_month_start timestamptz;
  summary_start_date date;
  weekly_collection_opportunities bigint;
  monthly_collection_opportunities bigint;
  active_game_count bigint;
  live_candidate_rows bigint;
  live_minimum_rows bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bobaks.refresh_rankings', 0));
  current_day_start := date_trunc('day', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  current_week_start := date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  next_week_start := current_week_start + interval '7 days';
  current_month_start := date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  next_month_start := current_month_start + interval '1 month';
  summary_start_date := ((calculated_at AT TIME ZONE 'UTC')::date - 364);

  CREATE TEMP TABLE old_ranking_snapshot ON COMMIT DROP AS
  SELECT "gameId", "period", "rank" FROM public."Ranking";

  SELECT count(*) INTO active_game_count
  FROM public."Game" WHERE "isActive" = true;

  live_minimum_rows := GREATEST(
    1, CEIL(LEAST(active_game_count, 100)::numeric * 0.50)::bigint
  );

  SELECT count(*) INTO weekly_collection_opportunities
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success','partial')
    AND "startedAt" >= current_week_start
    AND "startedAt" < next_week_start
    AND "startedAt" <= calculated_at;

  SELECT count(*) INTO monthly_collection_opportunities
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success','partial')
    AND "startedAt" >= current_month_start
    AND "startedAt" < next_month_start
    AND "startedAt" <= calculated_at;

  DELETE FROM public."Ranking"
  WHERE "period" IN ('live','weekly','monthly','yearly');

  WITH ranked AS (
    SELECT g."id" AS "gameId", latest."playerCount"::double precision AS score,
      ROW_NUMBER() OVER (ORDER BY latest."playerCount" DESC, g."id" ASC) AS rank
    FROM public."Game" g
    LEFT JOIN LATERAL (
      SELECT s."playerCount", s."timestamp"
      FROM public."GameSnapshot" s
      LEFT JOIN public."DataCollectionLog" l ON l."collectionRunId" = s."collectionRunId"
      WHERE s."gameId" = g."id"
        AND s."timestamp" <= calculated_at
        AND (s."collectionRunId" IS NULL OR l."status" IN ('success','partial'))
      ORDER BY s."timestamp" DESC, s."id" DESC LIMIT 1
    ) latest ON true
    WHERE g."isActive" = true
      AND latest."timestamp" >= calculated_at - interval '15 minutes'
  )
  INSERT INTO public."Ranking"
    ("gameId","period","rank","score","calculatedAt","previousRank")
  SELECT r."gameId",'live',r.rank::integer,r.score,calculated_at,o."rank"
  FROM ranked r
  LEFT JOIN old_ranking_snapshot o ON o."gameId"=r."gameId" AND o."period"='live'
  WHERE r.rank <= 100;

  SELECT count(*) INTO live_candidate_rows
  FROM public."Ranking" WHERE "period"='live';

  IF live_candidate_rows < live_minimum_rows THEN
    RAISE EXCEPTION
      'Ranking refresh aborted: live candidate has % rows, minimum safe rows is % for % active games',
      live_candidate_rows, live_minimum_rows, active_game_count;
  END IF;

  WITH current_period_samples AS MATERIALIZED (
    SELECT s."gameId",
      AVG(s."playerCount") FILTER (
        WHERE COALESCE(l."startedAt",s."timestamp") >= current_week_start
          AND COALESCE(l."startedAt",s."timestamp") < next_week_start
      )::double precision AS weekly_score,
      COUNT(*) FILTER (
        WHERE COALESCE(l."startedAt",s."timestamp") >= current_week_start
          AND COALESCE(l."startedAt",s."timestamp") < next_week_start
      )::bigint AS weekly_sample_count,
      AVG(s."playerCount") FILTER (
        WHERE COALESCE(l."startedAt",s."timestamp") >= current_month_start
          AND COALESCE(l."startedAt",s."timestamp") < next_month_start
      )::double precision AS monthly_score,
      COUNT(*) FILTER (
        WHERE COALESCE(l."startedAt",s."timestamp") >= current_month_start
          AND COALESCE(l."startedAt",s."timestamp") < next_month_start
      )::bigint AS monthly_sample_count
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l ON l."collectionRunId"=s."collectionRunId"
    WHERE COALESCE(l."startedAt",s."timestamp") >= LEAST(current_week_start,current_month_start)
      AND COALESCE(l."startedAt",s."timestamp") <= calculated_at
      AND (s."collectionRunId" IS NULL OR l."status" IN ('success','partial'))
    GROUP BY s."gameId"
  ),
  weekly_ranked AS (
    SELECT g."id" AS "gameId",cps.weekly_score AS score,
      ROW_NUMBER() OVER (ORDER BY cps.weekly_score DESC,g."id" ASC) AS rank
    FROM public."Game" g JOIN current_period_samples cps ON cps."gameId"=g."id"
    WHERE g."isActive"=true AND cps.weekly_sample_count>=12
      AND weekly_collection_opportunities>0
      AND LEAST(cps.weekly_sample_count::numeric/weekly_collection_opportunities::numeric,1.0)>=0.50
  ),
  monthly_ranked AS (
    SELECT g."id" AS "gameId",cps.monthly_score AS score,
      ROW_NUMBER() OVER (ORDER BY cps.monthly_score DESC,g."id" ASC) AS rank
    FROM public."Game" g JOIN current_period_samples cps ON cps."gameId"=g."id"
    WHERE g."isActive"=true AND cps.monthly_sample_count>=12
      AND monthly_collection_opportunities>0
      AND LEAST(cps.monthly_sample_count::numeric/monthly_collection_opportunities::numeric,1.0)>=0.50
  )
  INSERT INTO public."Ranking"
    ("gameId","period","rank","score","calculatedAt","previousRank")
  SELECT wr."gameId",'weekly',wr.rank::integer,wr.score,calculated_at,o."rank"
  FROM weekly_ranked wr
  LEFT JOIN old_ranking_snapshot o ON o."gameId"=wr."gameId" AND o."period"='weekly'
  WHERE wr.rank<=100
  UNION ALL
  SELECT mr."gameId",'monthly',mr.rank::integer,mr.score,calculated_at,o."rank"
  FROM monthly_ranked mr
  LEFT JOIN old_ranking_snapshot o ON o."gameId"=mr."gameId" AND o."period"='monthly'
  WHERE mr.rank<=100;

  WITH yearly_totals AS (
    SELECT "gameId",SUM("playerSum")::numeric AS player_sum,SUM("totalSamples")::bigint AS total_samples
    FROM public."DailyGameStat"
    WHERE "date">=summary_start_date::timestamp AT TIME ZONE 'UTC' AND "date"<current_day_start
    GROUP BY "gameId"
    UNION ALL
    SELECT s."gameId",SUM(s."playerCount")::numeric,COUNT(*)::bigint
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l ON l."collectionRunId"=s."collectionRunId"
    WHERE s."timestamp">=current_day_start AND s."timestamp"<=calculated_at
      AND (s."collectionRunId" IS NULL OR l."status" IN ('success','partial'))
    GROUP BY s."gameId"
  ),
  yearly_aggregates AS (
    SELECT "gameId",SUM(player_sum) AS player_sum,SUM(total_samples) AS total_samples
    FROM yearly_totals GROUP BY "gameId"
  ),
  averages AS (
    SELECT "gameId",(player_sum/total_samples)::double precision AS score
    FROM yearly_aggregates WHERE total_samples>0
  ),
  ranked AS (
    SELECT g."id" AS "gameId",averages.score AS score,
      ROW_NUMBER() OVER (ORDER BY averages.score DESC,g."id" ASC) AS rank
    FROM public."Game" g JOIN averages ON averages."gameId"=g."id"
    WHERE g."isActive"=true
  )
  INSERT INTO public."Ranking"
    ("gameId","period","rank","score","calculatedAt","previousRank")
  SELECT r."gameId",'yearly',r.rank::integer,r.score,calculated_at,o."rank"
  FROM ranked r
  LEFT JOIN old_ranking_snapshot o ON o."gameId"=r."gameId" AND o."period"='yearly'
  WHERE r.rank<=100;

  PERFORM public.assert_rankings_integrity();
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_rankings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_rankings() TO service_role;
ALTER FUNCTION public.refresh_rankings() SET search_path=public,pg_temp;

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
