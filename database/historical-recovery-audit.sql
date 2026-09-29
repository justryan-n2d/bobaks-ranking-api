-- Phase 3 Part 6: historical recovery audit.
-- Read-only server-side checks for recoverable historical gaps.
--
-- Recovery principle:
--   * days with retained qualifying snapshots can be rebuilt
--   * days with no qualifying snapshots are not synthesized
--   * failed collection runs are excluded from historical summaries
--   * partial collection runs remain usable for the data they produced

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
GRANT EXECUTE ON FUNCTION public.get_historical_recovery_audit(integer) TO service_role;
