-- Phase 2 transparency and auditability.
-- Exposes the canonical ranking methodology and a server-side audit summary.

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

  WITH bounds AS (
    SELECT
      date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS period_start,
      date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '7 days' AS period_end
  ),
  samples AS (
    SELECT
      s."gameId",
      count(*)::bigint AS sample_count
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    CROSS JOIN bounds b
    WHERE COALESCE(l."startedAt", s."timestamp") >= b.period_start
      AND COALESCE(l."startedAt", s."timestamp") < b.period_end
      AND COALESCE(l."startedAt", s."timestamp") <= calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success','partial')
      )
    GROUP BY s."gameId"
  )
  SELECT
    min(samples.sample_count),
    min(least(samples.sample_count::numeric / nullif(weekly_opportunities,0)::numeric, 1.0))
  INTO weekly_min_samples, weekly_min_coverage
  FROM public."Ranking" r
  JOIN samples ON samples."gameId" = r."gameId"
  WHERE r."period"='weekly';

  WITH bounds AS (
    SELECT
      date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS period_start,
      date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 month' AS period_end
  ),
  samples AS (
    SELECT
      s."gameId",
      count(*)::bigint AS sample_count
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    CROSS JOIN bounds b
    WHERE COALESCE(l."startedAt", s."timestamp") >= b.period_start
      AND COALESCE(l."startedAt", s."timestamp") < b.period_end
      AND COALESCE(l."startedAt", s."timestamp") <= calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success','partial')
      )
    GROUP BY s."gameId"
  )
  SELECT
    min(samples.sample_count),
    min(least(samples.sample_count::numeric / nullif(monthly_opportunities,0)::numeric, 1.0))
  INTO monthly_min_samples, monthly_min_coverage
  FROM public."Ranking" r
  JOIN samples ON samples."gameId" = r."gameId"
  WHERE r."period"='monthly';

  WITH latest AS (
    SELECT DISTINCT ON (s."gameId")
      s."gameId",
      s."timestamp"
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId"=s."collectionRunId"
    WHERE s."timestamp"<=calculated_at
      AND (s."collectionRunId" IS NULL OR l."status" IN ('success','partial'))
    ORDER BY s."gameId",s."timestamp" DESC,s."id" DESC
  )
  SELECT max(extract(epoch from (calculated_at - latest."timestamp")))
  INTO live_max_age_seconds
  FROM public."Ranking" r
  JOIN latest ON latest."gameId"=r."gameId"
  WHERE r."period"='live';

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
GRANT EXECUTE ON FUNCTION public.get_rankings_audit() TO service_role;
ALTER FUNCTION public.get_rankings_audit() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_rankings_audit() SET search_path = public, pg_temp;