-- Daily game statistics support for Phase 2 retention.
-- Raw GameSnapshot data remains the source of truth for the detailed 31-day window.
-- DailyGameStat stores long-term daily summaries.

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
    "gameId",
    day_start,
    AVG("playerCount")::double precision,
    MAX("playerCount"),
    MIN("playerCount"),
    COUNT(*)::integer,
    SUM("playerCount")::bigint
  FROM public."GameSnapshot"
  WHERE "timestamp" >= day_start
    AND "timestamp" < day_end
  GROUP BY "gameId"
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

CREATE OR REPLACE FUNCTION public.summarize_yesterday_daily_game_stats()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN public.summarize_daily_game_stats(
    ((now() AT TIME ZONE 'UTC')::date - 1)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.summarize_daily_game_stats(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.summarize_yesterday_daily_game_stats() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.summarize_daily_game_stats(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.summarize_yesterday_daily_game_stats() TO service_role;
