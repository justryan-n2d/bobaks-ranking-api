-- Bobaks Ranking operational log retention.
-- Long-term historical data lives in DailyGameStat/GamePeak and rankings.
-- DataCollectionLog is operational provenance needed for recent raw snapshots,
-- coverage checks, and recovery. Keep 365 days, while never deleting a log that
-- is still referenced by a retained GameSnapshot.

CREATE INDEX IF NOT EXISTS "DataCollectionLog_startedAt_id_idx"
  ON public."DataCollectionLog" ("startedAt", "id");

CREATE OR REPLACE FUNCTION public.cleanup_collection_logs(
  p_retention_days integer DEFAULT 365,
  p_batch_size integer DEFAULT 5000
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  cutoff timestamptz;
  deleted_in_batch integer;
  deleted_total bigint := 0;
BEGIN
  IF p_retention_days < 90 THEN
    RAISE EXCEPTION 'DataCollectionLog retention must be at least 90 days';
  END IF;

  IF p_batch_size < 1 OR p_batch_size > 50000 THEN
    RAISE EXCEPTION 'p_batch_size must be between 1 and 50000';
  END IF;

  cutoff := now() - make_interval(days => p_retention_days);

  LOOP
    DELETE FROM public."DataCollectionLog" l
    WHERE l."id" IN (
      SELECT l2."id"
      FROM public."DataCollectionLog" l2
      WHERE l2."startedAt" < cutoff
        AND (
          l2."collectionRunId" IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM public."GameSnapshot" s
            WHERE s."collectionRunId" = l2."collectionRunId"
          )
        )
      ORDER BY l2."startedAt", l2."id"
      LIMIT p_batch_size
    );

    GET DIAGNOSTICS deleted_in_batch = ROW_COUNT;
    deleted_total := deleted_total + deleted_in_batch;

    EXIT WHEN deleted_in_batch = 0;
  END LOOP;

  RETURN deleted_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_collection_logs(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_collection_logs(integer, integer)
  TO service_role;

ALTER FUNCTION public.cleanup_collection_logs(integer, integer)
  SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.cleanup_collection_logs(integer, integer)
  IS 'Deletes operational DataCollectionLog rows older than the retention window while preserving logs still referenced by retained GameSnapshot rows. Intended for scheduled server-side execution.';

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'bobaks-collection-log-retention-daily'
  ) THEN
    PERFORM cron.schedule(
      'bobaks-collection-log-retention-daily',
      '30 0 * * *',
      $job$SELECT public.cleanup_collection_logs(365, 5000);$job$
    );
  END IF;
END
$do$;
