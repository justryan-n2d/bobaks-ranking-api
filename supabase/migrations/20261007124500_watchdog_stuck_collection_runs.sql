-- Prevent a killed collector from leaving a run permanently in the non-qualifying "running" state.
CREATE OR REPLACE FUNCTION public.mark_stale_collection_runs(
  p_cutoff timestamp with time zone DEFAULT (now() - interval '30 minutes')
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  affected integer;
BEGIN
  UPDATE public."DataCollectionLog"
  SET
    status = 'failed',
    finishedAt = COALESCE("finishedAt", now()),
    errors = GREATEST("errors", 1),
    errorMessage = COALESCE("errorMessage", 'Collector run exceeded the finalization deadline.')
  WHERE "status" = 'running'
    AND "finishedAt" IS NULL
    AND "startedAt" < p_cutoff;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_stale_collection_runs(timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_collection_runs(timestamp with time zone) TO service_role;
ALTER FUNCTION public.mark_stale_collection_runs(timestamp with time zone) SET search_path = public, pg_temp;

DO $schedule$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'bobaks-collection-run-watchdog'
  ) THEN
    PERFORM cron.schedule(
      'bobaks-collection-run-watchdog',
      '*/15 * * * *',
      $job$SELECT public.mark_stale_collection_runs();$job$
    );
  END IF;
END
$schedule$;
