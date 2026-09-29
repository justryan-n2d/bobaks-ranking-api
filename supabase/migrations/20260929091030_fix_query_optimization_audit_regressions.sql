-- Phase 4 Part 6.2 correction migration.
-- Apply the final production-safe versions after the initial optimization
-- migration. These corrections preserve CTE scope and qualify PL/pgSQL
-- output variables.

CREATE OR REPLACE FUNCTION public.get_rankings_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  result jsonb;
  calculated_at timestamptz;
  latest_collection_started_at timestamptz;
  latest_collection_status text;
  weekly_opportunities bigint;
  monthly_opportunities bigint;
  weekly_min_samples bigint;
  weekly_min_coverage numeric;
  monthly_min_samples bigint;
  monthly_min_coverage numeric;
  live_max_age_seconds double precision;
  historical_recovery jsonb;
BEGIN
  PERFORM public.assert_rankings_integrity();
  historical_recovery := public.get_historical_recovery_audit(31);

  SELECT max("calculatedAt")
  INTO calculated_at
  FROM public."Ranking";

  SELECT "startedAt","status"
  INTO latest_collection_started_at, latest_collection_status
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success','partial','failed')
  ORDER BY "startedAt" DESC
  LIMIT 1;

  SELECT count(*)
  INTO weekly_opportunities
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success','partial')
    AND "startedAt" >= date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND "startedAt" < (date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '7 days')
    AND "startedAt" <= calculated_at;

  SELECT count(*)
  INTO monthly_opportunities
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success','partial')
    AND "startedAt" >= date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND "startedAt" < (date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 month')
    AND "startedAt" <= calculated_at;

  -- Weekly and monthly coverage metrics share one current-period snapshot scan.
  -- The lower bound includes a week that crosses a UTC month boundary.
  WITH current_month_samples AS MATERIALIZED (
    SELECT
      s."gameId",
      COUNT(*) FILTER (
        WHERE COALESCE(l."startedAt", s."timestamp") >= date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND COALESCE(l."startedAt", s."timestamp") < date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '7 days'
      )::bigint AS weekly_sample_count,
      COUNT(*) FILTER (
        WHERE COALESCE(l."startedAt", s."timestamp") >= date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND COALESCE(l."startedAt", s."timestamp") < date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 month'
      )::bigint AS monthly_sample_count
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    WHERE COALESCE(l."startedAt", s."timestamp") >= LEAST(
      date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
      date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    )
      AND COALESCE(l."startedAt", s."timestamp") <= calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success','partial')
      )
    GROUP BY s."gameId"
  ),
  stats AS (
    SELECT
      MIN(c.weekly_sample_count) FILTER (WHERE r."period"='weekly') AS weekly_min_samples,
      MIN(LEAST(
        c.weekly_sample_count::numeric / NULLIF(weekly_opportunities, 0)::numeric,
        1.0
      )) FILTER (WHERE r."period"='weekly') AS weekly_min_coverage,
      MIN(c.monthly_sample_count) FILTER (WHERE r."period"='monthly') AS monthly_min_samples,
      MIN(LEAST(
        c.monthly_sample_count::numeric / NULLIF(monthly_opportunities, 0)::numeric,
        1.0
      )) FILTER (WHERE r."period"='monthly') AS monthly_min_coverage
    FROM public."Ranking" r
    JOIN current_month_samples c ON c."gameId"=r."gameId"
    WHERE r."period" IN ('weekly','monthly')
  )
  SELECT
    stats.weekly_min_samples,
    stats.weekly_min_coverage,
    stats.monthly_min_samples,
    stats.monthly_min_coverage
  INTO weekly_min_samples, weekly_min_coverage,
       monthly_min_samples, monthly_min_coverage
  FROM stats;

  -- Live audit uses one indexed lookup per ranked game.
  WITH calc AS (
    SELECT min("calculatedAt") AS calculated_at
    FROM public."Ranking"
    WHERE "period"='live'
  )
  SELECT max(extract(epoch from (calc.calculated_at - latest."timestamp")))
  INTO live_max_age_seconds
  FROM public."Ranking" r
  CROSS JOIN calc
  LEFT JOIN LATERAL (
    SELECT s."timestamp"
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId"=s."collectionRunId"
    WHERE s."gameId"=r."gameId"
      AND s."timestamp"<=calc.calculated_at
      AND (s."collectionRunId" IS NULL OR l."status" IN ('success','partial'))
    ORDER BY s."timestamp" DESC, s."id" DESC
    LIMIT 1
  ) latest ON true
  WHERE r."period"='live'
    AND latest."timestamp" IS NOT NULL;

  result := jsonb_build_object(
    'methodologyVersion', '2026-09-28',
    'auditStatus', CASE
      WHEN historical_recovery->>'status' = 'passed' THEN 'passed'
      ELSE 'needs_repair'
    END,
    'historicalRecovery', historical_recovery,
    'auditedAt', now(),
    'collection', jsonb_build_object(
      'cadenceSeconds', 600,
      'latestStartedAt', latest_collection_started_at,
      'latestStatus', latest_collection_status
    ),
    'rankings', jsonb_build_object(
      'live', jsonb_build_object(
        'rows', (select count(*) from public."Ranking" where "period"='live'),
        'calculatedAt', (select max("calculatedAt") from public."Ranking" where "period"='live'),
        'maxLatestSnapshotAgeSeconds', live_max_age_seconds
      ),
      'weekly', jsonb_build_object(
        'rows', (select count(*) from public."Ranking" where "period"='weekly'),
        'calculatedAt', (select max("calculatedAt") from public."Ranking" where "period"='weekly'),
        'collectionOpportunities', weekly_opportunities,
        'minimumSamplesObserved', weekly_min_samples,
        'minimumCoverageObserved', weekly_min_coverage
      ),
      'monthly', jsonb_build_object(
        'rows', (select count(*) from public."Ranking" where "period"='monthly'),
        'calculatedAt', (select max("calculatedAt") from public."Ranking" where "period"='monthly'),
        'collectionOpportunities', monthly_opportunities,
        'minimumSamplesObserved', monthly_min_samples,
        'minimumCoverageObserved', monthly_min_coverage
      ),
      'yearly', jsonb_build_object(
        'rows', (select count(*) from public."Ranking" where "period"='yearly'),
        'calculatedAt', (select max("calculatedAt") from public."Ranking" where "period"='yearly')
      )
    )
  );

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_rankings_audit() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_historical_recovery_audit(
  p_lookback_days integer DEFAULT 31
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  current_utc_date date := (now() AT TIME ZONE 'UTC')::date;
  oldest_date date;
  recoverable_mismatches bigint := 0;
  raw_days bigint := 0;
  summary_days bigint := 0;
  success_runs bigint := 0;
  partial_runs bigint := 0;
  failed_runs bigint := 0;
  collection_gaps bigint := 0;
  largest_gap_seconds double precision := 0;
  oldest_snapshot timestamptz;
  newest_snapshot timestamptz;
  raw_days_without_summary jsonb := '[]'::jsonb;
  gap_details jsonb := '[]'::jsonb;
BEGIN
  IF p_lookback_days < 1 OR p_lookback_days > 31 THEN
    RAISE EXCEPTION 'p_lookback_days must be between 1 and 31';
  END IF;

  oldest_date := current_utc_date - p_lookback_days;

  WITH source AS (
    SELECT
      s."gameId",
      (s."timestamp" AT TIME ZONE 'UTC')::date AS day,
      AVG(s."playerCount")::double precision AS average_players,
      MAX(s."playerCount") AS peak_players,
      MIN(s."playerCount") AS lowest_players,
      COUNT(*)::integer AS total_samples,
      SUM(s."playerCount")::bigint AS player_sum,
      MIN(s."timestamp") AS oldest_snapshot_at,
      MAX(s."timestamp") AS newest_snapshot_at
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
  comparison AS (
    SELECT
      source.day,
      source."gameId",
      source.oldest_snapshot_at,
      source.newest_snapshot_at,
      summary."gameId" AS summary_game_id,
      summary.average_players,
      source.average_players AS source_average_players,
      summary.peak_players,
      source.peak_players AS source_peak_players,
      summary.lowest_players,
      source.lowest_players AS source_lowest_players,
      summary.total_samples,
      source.total_samples AS source_total_samples,
      summary.player_sum,
      source.player_sum AS source_player_sum
    FROM source
    LEFT JOIN summary
      ON summary."gameId" = source."gameId"
     AND summary.day = source.day
  )
  SELECT
    COUNT(*) FILTER (
      WHERE summary_game_id IS NULL
         OR average_players IS DISTINCT FROM source_average_players
         OR peak_players IS DISTINCT FROM source_peak_players
         OR lowest_players IS DISTINCT FROM source_lowest_players
         OR total_samples IS DISTINCT FROM source_total_samples
         OR player_sum IS DISTINCT FROM source_player_sum
    ),
    COUNT(DISTINCT day),
    COALESCE(
      jsonb_agg(day ORDER BY day) FILTER (WHERE summary_game_id IS NULL),
      '[]'::jsonb
    ),
    MIN(oldest_snapshot_at),
    MAX(newest_snapshot_at)
  INTO recoverable_mismatches, raw_days, raw_days_without_summary,
       oldest_snapshot, newest_snapshot
  FROM comparison;

  SELECT COUNT(DISTINCT day)
  INTO summary_days
  FROM (
    SELECT (d."date" AT TIME ZONE 'UTC')::date AS day
    FROM public."DailyGameStat" d
    WHERE d."date" >= oldest_date::timestamp AT TIME ZONE 'UTC'
      AND d."date" < current_utc_date::timestamp AT TIME ZONE 'UTC'
  ) summary_days_source;

  SELECT
    COUNT(*) FILTER (WHERE "status" = 'success'),
    COUNT(*) FILTER (WHERE "status" = 'partial'),
    COUNT(*) FILTER (WHERE "status" = 'failed')
  INTO success_runs, partial_runs, failed_runs
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success','partial','failed')
    AND "startedAt" >= oldest_date::timestamp AT TIME ZONE 'UTC'
    AND "startedAt" < (current_utc_date + 1)::timestamp AT TIME ZONE 'UTC';

  WITH ordered AS (
    SELECT
      "startedAt",
      LAG("startedAt") OVER (ORDER BY "startedAt") AS previous_started_at
    FROM public."DataCollectionLog"
    WHERE "status" IN ('success','partial','failed')
      AND "startedAt" >= oldest_date::timestamp AT TIME ZONE 'UTC'
      AND "startedAt" < (current_utc_date + 1)::timestamp AT TIME ZONE 'UTC'
  ),
  gaps AS (
    SELECT
      previous_started_at,
      "startedAt",
      EXTRACT(EPOCH FROM ("startedAt" - previous_started_at))::double precision AS gap_seconds
    FROM ordered
    WHERE previous_started_at IS NOT NULL
      AND "startedAt" - previous_started_at > interval '20 minutes'
  )
  SELECT
    COUNT(*),
    COALESCE(MAX(gap_seconds), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'from', previous_started_at,
          'to', "startedAt",
          'gapSeconds', gap_seconds
        )
        ORDER BY gap_seconds DESC, "startedAt" DESC
      ) FILTER (WHERE gap_seconds IS NOT NULL),
      '[]'::jsonb
    )
  INTO collection_gaps, largest_gap_seconds, gap_details
  FROM gaps;

  gap_details := COALESCE(
    (
      SELECT jsonb_agg(item)
      FROM (
        SELECT item
        FROM jsonb_array_elements(gap_details) AS entries(item)
        LIMIT 20
      ) limited
    ),
    '[]'::jsonb
  );

  RETURN jsonb_build_object(
    'status', CASE
      WHEN recoverable_mismatches = 0 THEN 'passed'
      ELSE 'needs_repair'
    END,
    'lookbackDays', p_lookback_days,
    'recoverableDailyRows', recoverable_mismatches,
    'rawDaysObserved', raw_days,
    'dailySummaryDaysObserved', summary_days,
    'rawDaysWithoutSummary', raw_days_without_summary,
    'history', jsonb_build_object(
      'oldestSnapshotAt', oldest_snapshot,
      'newestSnapshotAt', newest_snapshot
    ),
    'collection', jsonb_build_object(
      'expectedCadenceSeconds', 600,
      'gapThresholdSeconds', 1200,
      'successRuns', success_runs,
      'partialRuns', partial_runs,
      'failedRuns', failed_runs,
      'gapsOverThreshold', collection_gaps,
      'largestGapSeconds', largest_gap_seconds,
      'gaps', gap_details
    ),
    'recoveryRule', 'Only days with retained qualifying snapshots are repairable. Days with no qualifying snapshots are left without synthesized statistics.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_historical_recovery_audit(integer) FROM PUBLIC;
