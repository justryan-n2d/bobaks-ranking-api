-- Cloudflare collector support functions.
-- These functions are server-only and are callable by the Supabase service_role.

CREATE OR REPLACE FUNCTION public.record_game_peaks(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  affected integer;
BEGIN
  INSERT INTO public."GamePeak" ("gameId", "peakPlayers", "peakAt")
  SELECT
    (row->>'gameId')::bigint,
    (row->>'playerCount')::integer,
    (row->>'peakAt')::timestamptz
  FROM jsonb_array_elements(p_rows) AS row
  WHERE (row->>'gameId') ~ '^[0-9]+$'
    AND (row->>'playerCount') ~ '^[0-9]+$'
    AND NULLIF(row->>'peakAt', '') IS NOT NULL
  ON CONFLICT ("gameId") DO UPDATE
  SET
    "peakPlayers" = GREATEST(public."GamePeak"."peakPlayers", EXCLUDED."peakPlayers"),
    "peakAt" = CASE
      WHEN EXCLUDED."peakPlayers" > public."GamePeak"."peakPlayers"
        THEN EXCLUDED."peakAt"
      ELSE public."GamePeak"."peakAt"
    END;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.record_game_peaks(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_game_peaks(jsonb) TO service_role;\nALTER FUNCTION public.record_game_peaks(jsonb) SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.refresh_rankings()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  calculated_at timestamptz := now();
  current_day_start timestamptz;
  summary_start_date date;
BEGIN
  current_day_start := date_trunc('day', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  summary_start_date := ((calculated_at AT TIME ZONE 'UTC')::date - 364);

  DELETE FROM public."Ranking"
  WHERE "period" IN ('live', 'weekly', 'monthly', 'yearly');

  WITH latest AS (
    SELECT DISTINCT ON ("gameId")
      "gameId",
      "playerCount"
    FROM public."GameSnapshot"
    ORDER BY "gameId", "timestamp" DESC, "id" DESC
  ),
  ranked AS (
    SELECT
      g."id" AS "gameId",
      COALESCE(latest."playerCount", 0)::double precision AS score,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(latest."playerCount", 0) DESC, g."id" ASC
      ) AS rank
    FROM public."Game" g
    LEFT JOIN latest ON latest."gameId" = g."id"
    WHERE g."isActive" = true
  )
  INSERT INTO public."Ranking" ("gameId", "period", "rank", "score", "calculatedAt")
  SELECT "gameId", 'live', rank::integer, score, calculated_at
  FROM ranked
  WHERE rank <= 100;

  WITH averages AS (
    SELECT
      "gameId",
      AVG("playerCount")::double precision AS score
    FROM public."GameSnapshot"
    WHERE "timestamp" >= calculated_at - interval '7 days'
    GROUP BY "gameId"
  ),
  ranked AS (
    SELECT
      g."id" AS "gameId",
      COALESCE(averages.score, 0)::double precision AS score,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(averages.score, 0) DESC, g."id" ASC
      ) AS rank
    FROM public."Game" g
    LEFT JOIN averages ON averages."gameId" = g."id"
    WHERE g."isActive" = true
  )
  INSERT INTO public."Ranking" ("gameId", "period", "rank", "score", "calculatedAt")
  SELECT "gameId", 'weekly', rank::integer, score, calculated_at
  FROM ranked
  WHERE rank <= 100;

  WITH averages AS (
    SELECT
      "gameId",
      AVG("playerCount")::double precision AS score
    FROM public."GameSnapshot"
    WHERE "timestamp" >= calculated_at - interval '30 days'
    GROUP BY "gameId"
  ),
  ranked AS (
    SELECT
      g."id" AS "gameId",
      COALESCE(averages.score, 0)::double precision AS score,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(averages.score, 0) DESC, g."id" ASC
      ) AS rank
    FROM public."Game" g
    LEFT JOIN averages ON averages."gameId" = g."id"
    WHERE g."isActive" = true
  )
  INSERT INTO public."Ranking" ("gameId", "period", "rank", "score", "calculatedAt")
  SELECT "gameId", 'monthly', rank::integer, score, calculated_at
  FROM ranked
  WHERE rank <= 100;

  /*
    Yearly ranking uses 365 UTC calendar dates:
    - the current UTC day from raw GameSnapshot rows
    - the prior 364 complete UTC days from DailyGameStat

    DailyGameStat stores playerSum and totalSamples so the score remains
    a weighted average across the underlying samples.
  */
  WITH yearly_totals AS (
    SELECT
      "gameId",
      SUM("playerSum")::numeric AS player_sum,
      SUM("totalSamples")::bigint AS total_samples
    FROM public."DailyGameStat"
    WHERE "date" >= summary_start_date::timestamp AT TIME ZONE 'UTC'
      AND "date" < current_day_start
    GROUP BY "gameId"

    UNION ALL

    SELECT
      "gameId",
      SUM("playerCount")::numeric AS player_sum,
      COUNT(*)::bigint AS total_samples
    FROM public."GameSnapshot"
    WHERE "timestamp" >= current_day_start
      AND "timestamp" <= calculated_at
    GROUP BY "gameId"
  ),
  yearly_aggregates AS (
    SELECT
      "gameId",
      SUM(player_sum) AS player_sum,
      SUM(total_samples) AS total_samples
    FROM yearly_totals
    GROUP BY "gameId"
  ),
  averages AS (
    SELECT
      "gameId",
      CASE
        WHEN total_samples > 0
          THEN (player_sum / total_samples)::double precision
        ELSE 0::double precision
      END AS score
    FROM yearly_aggregates
  ),
  ranked AS (
    SELECT
      g."id" AS "gameId",
      COALESCE(averages.score, 0)::double precision AS score,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(averages.score, 0) DESC, g."id" ASC
      ) AS rank
    FROM public."Game" g
    LEFT JOIN averages ON averages."gameId" = g."id"
    WHERE g."isActive" = true
  )
  INSERT INTO public."Ranking" ("gameId", "period", "rank", "score", "calculatedAt")
  SELECT "gameId", 'yearly', rank::integer, score, calculated_at
  FROM ranked
  WHERE rank <= 100;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_rankings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_rankings() TO service_role;
ALTER FUNCTION public.refresh_rankings() SET search_path = public, pg_temp;
