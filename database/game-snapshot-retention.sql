-- Bobaks Ranking GameSnapshot retention support.
-- Server-side storage lifecycle for raw GameSnapshot history.
-- Keep raw snapshots for at least 31 days; preserve summarized/peak/ranking
-- history separately for long-term use.
--
-- This SQL reflects the production retention setup. It is intentionally
-- separate from the collector deployment.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Supports the retention query's timestamp ordering/filtering as the
-- GameSnapshot table grows.
CREATE INDEX IF NOT EXISTS "GameSnapshot_timestamp_id_idx"
  ON public."GameSnapshot" ("timestamp", "id");

CREATE OR REPLACE FUNCTION public.cleanup_game_snapshots(
  p_retention_days integer DEFAULT 31,
  p_batch_size integer DEFAULT 5000
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  cutoff timestamptz;
  deleted_in_batch integer;
  deleted_total bigint := 0;
BEGIN
  -- Never allow cleanup to shorten the approved retention window.
  IF p_retention_days < 31 THEN
    RAISE EXCEPTION 'GameSnapshot retention must be at least 31 days';
  END IF;

  IF p_batch_size < 1 OR p_batch_size > 50000 THEN
    RAISE EXCEPTION 'p_batch_size must be between 1 and 50000';
  END IF;

  cutoff := now() - make_interval(days => p_retention_days);

  LOOP
    DELETE FROM public."GameSnapshot"
    WHERE "id" IN (
      SELECT "id"
      FROM public."GameSnapshot"
      WHERE "timestamp" < cutoff
      ORDER BY "timestamp", "id"
      LIMIT p_batch_size
    );

    GET DIAGNOSTICS deleted_in_batch = ROW_COUNT;
    deleted_total := deleted_total + deleted_in_batch;

    EXIT WHEN deleted_in_batch = 0;
  END LOOP;

  RETURN deleted_total;
END;
$$;

-- Cleanup is server-only. The public API must never be able to invoke it.
REVOKE EXECUTE ON FUNCTION public.cleanup_game_snapshots(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_game_snapshots(integer, integer)
  TO service_role;

ALTER FUNCTION public.cleanup_game_snapshots(integer, integer)
  SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.cleanup_game_snapshots(integer, integer)
  IS 'Deletes GameSnapshot rows older than the approved retention window. Minimum retention is 31 days. Intended for scheduled server-side execution.';

-- Daily at 00:20 UTC / 08:20 PHT, after the daily summary at 00:05 UTC.
-- Idempotent: rerunning this entire file will not create a duplicate job.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'bobaks-game-snapshot-retention-daily'
  ) THEN
    PERFORM cron.schedule(
      'bobaks-game-snapshot-retention-daily',
      '20 0 * * *',
      $job$SELECT public.cleanup_game_snapshots(31, 5000);$job$
    );
  END IF;
END
$do$;
