-- Daily game statistics support for long-term historical retention.
-- Raw GameSnapshot data remains the source of truth for the detailed 31-day window.
-- DailyGameStat stores long-term daily summaries.
--
-- The repair function automatically detects missing or inconsistent daily
-- summaries in the retained raw-snapshot window and rebuilds them safely.

ALTER TABLE public."DailyGameStat"
  ADD COLUMN IF NOT EXISTS "playerSum" bigint NOT NULL DEFAULT 0;

ALTER TABLE public."DailyGameStat"
  DROP CONSTRAINT IF EXISTS "DailyGameStat_playerSum_nonnegative";

ALTER TABLE public."DailyGameStat"
  ADD CONSTRAINT "DailyGameStat_playerSum_nonnegative"
  CHECK ("playerSum" >= 0);

CREATE OR REPLACE FUNCTION public.summarize_daily_game_stats(p_day date)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  day_start timestamptz;
  day_end timestamptz;
  affected integer;
BEGIN
  IF p_day >= (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Cannot summarize a current or future UTC day: %', p_day;
  END IF;

  day_start := p_day::timestamp AT TIME ZONE 'UTC';
  day_end := (p_day + 1)::timestamp AT TIME ZONE 'UTC';

  INSERT INTO public."DailyGameStat" (
    "gameId",
    "date",
    "averagePlayers",
    "peakPlayers",
    "lowestPlayers",
    "totalSamples",
    "playerSum"
  )
  SELECT
    s."gameId",
    day_start,
    AVG(s."playerCount")::double precision,
    MAX(s."playerCount"),
    MIN(s."playerCount"),
    COUNT(*)::integer,
    SUM(s."playerCount")::bigint
  FROM public."GameSnapshot" s
  LEFT JOIN public."DataCollectionLog" l
    ON l."collectionRunId" = s."collectionRunId"
  WHERE s."timestamp" >= day_start
    AND s."timestamp" < day_end
    AND (
      s."collectionRunId" IS NULL
      OR l."status" IN ('success', 'partial')
    )
  GROUP BY s."gameId"
  ON CONFLICT ("gameId", "date") DO UPDATE
  SET
    "averagePlayers" = EXCLUDED."averagePlayers",
    "peakPlayers" = EXCLUDED."peakPlayers",
    "lowestPlayers" = EXCLUDED."lowestPlayers",
    "totalSamples" = EXCLUDED."totalSamples",
    "playerSum" = EXCLUDED."playerSum";

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;

CREATE OR REPLACE FUNCTION public.repair_missing_daily_game_stats(
  p_lookback_days integer DEFAULT 31,
  p_max_days integer DEFAULT 31
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  current_utc_date date := (now() AT TIME ZONE 'UTC')::date;
  oldest_date date;
  target_day date;
  repaired_rows integer := 0;
  affected integer;
BEGIN
  IF p_lookback_days < 1 OR p_lookback_days > 31 THEN
    RAISE EXCEPTION 'p_lookback_days must be between 1 and 31';
  END IF;

  IF p_max_days < 1 OR p_max_days > 31 THEN
    RAISE EXCEPTION 'p_max_days must be between 1 and 31';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('bobaks.daily_summary_repair', 0)
  );

  oldest_date := current_utc_date - p_lookback_days;

  FOR target_day IN
    WITH source AS (
      SELECT
        s."gameId",
        (s."timestamp" AT TIME ZONE 'UTC')::date AS day,
        AVG(s."playerCount")::double precision AS average_players,
        MAX(s."playerCount") AS peak_players,
        MIN(s."playerCount") AS lowest_players,
        COUNT(*)::integer AS total_samples,
        SUM(s."playerCount")::bigint AS player_sum
      FROM public."GameSnapshot" s
      LEFT JOIN public."DataCollectionLog" l
        ON l."collectionRunId" = s."collectionRunId"
      WHERE s."timestamp" >= oldest_date::timestamp AT TIME ZONE 'UTC'
        AND s."timestamp" < current_utc_date::timestamp AT TIME ZONE 'UTC'
        AND (
          s."collectionRunId" IS NULL
          OR l."status" IN ('success', 'partial')
        )
      GROUP BY s."gameId", (s."timestamp" AT TIME ZONE 'UTC')::date
    ),
    summary AS (
      SELECT
        d."gameId",
        (d."date" AT TIME ZONE 'UTC')::date AS day,
        d."averagePlayers" AS average_players,
        d."peakPlayers" AS peak_players,
        d."lowestPlayers" AS lowest_players,
        d."totalSamples" AS total_samples,
        d."playerSum" AS player_sum
      FROM public."DailyGameStat" d
      WHERE d."date" >= oldest_date::timestamp AT TIME ZONE 'UTC'
        AND d."date" < current_utc_date::timestamp AT TIME ZONE 'UTC'
    ),
    mismatched_days AS (
      SELECT source.day
      FROM source
      LEFT JOIN summary
        ON summary."gameId" = source."gameId"
        AND summary.day = source.day
      WHERE summary."gameId" IS NULL
        OR summary.average_players IS DISTINCT FROM source.average_players
        OR summary.peak_players IS DISTINCT FROM source.peak_players
        OR summary.lowest_players IS DISTINCT FROM source.lowest_players
        OR summary.total_samples IS DISTINCT FROM source.total_samples
        OR summary.player_sum IS DISTINCT FROM source.player_sum
      GROUP BY source.day
    )
    SELECT day
    FROM mismatched_days
    ORDER BY day
    LIMIT p_max_days
  LOOP
    affected := public.summarize_daily_game_stats(target_day);
    repaired_rows := repaired_rows + affected;
  END LOOP;

  RETURN repaired_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.summarize_yesterday_daily_game_stats()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Keep the existing RPC as the scheduler entrypoint, but repair any
  -- missing/inconsistent historical day in the retained raw-data window.
  RETURN public.repair_missing_daily_game_stats(31, 31);
END;
$function$;

REVOKE ALL ON FUNCTION public.summarize_daily_game_stats(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_missing_daily_game_stats(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.summarize_yesterday_daily_game_stats() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.summarize_daily_game_stats(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.repair_missing_daily_game_stats(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.summarize_yesterday_daily_game_stats() TO service_role;
