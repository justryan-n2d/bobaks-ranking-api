-- Bobaks Ranking GameSnapshot retention support.
-- This file defines a guarded, server-only cleanup function.
-- It is intentionally separate from the collector deployment so retention
-- cannot be activated by a normal Worker code deployment.

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
  -- Never allow the cleanup function to shorten the approved retention window.
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

REVOKE ALL ON FUNCTION public.cleanup_game_snapshots(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_game_snapshots(integer, integer) TO service_role;
ALTER FUNCTION public.cleanup_game_snapshots(integer, integer)
  SET search_path = public, pg_temp;
