-- Phase 2 hardening: make stale-game selection and verification concurrency-safe.
-- This migration preserves the existing 24-hour stale threshold and 12-miss
-- deactivation rule. Ranking coverage rules are unchanged.

CREATE OR REPLACE FUNCTION public.list_stale_active_games(
  p_cutoff timestamptz,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  "id" bigint,
  "universeId" bigint,
  "lastVerificationAttemptAt" timestamptz,
  "verificationMisses" integer
)
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    g."id",
    g."universeId",
    g."lastVerificationAttemptAt",
    g."verificationMisses"
  FROM public."Game" g
  WHERE g."isActive" = true
    AND g."lastObservedAt" < p_cutoff
    AND (
      g."verificationMisses" > 0
      OR g."lastVerificationAttemptAt" IS NULL
      OR g."lastVerificationAttemptAt" < p_cutoff
    )
  ORDER BY
    g."lastVerificationAttemptAt" ASC NULLS FIRST,
    g."id" ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100);
$function$;

REVOKE ALL ON FUNCTION public.list_stale_active_games(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_stale_active_games(timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_game_activity(
  p_attempted_universe_ids jsonb,
  p_found_universe_ids jsonb,
  p_verified_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  processed integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_attempted_universe_ids, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_found_universe_ids, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Verification universe ID inputs must be JSON arrays';
  END IF;

  -- Serialize activity verification state changes so overlapping collector
  -- runs cannot count the same game twice for one verification cycle.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('bobaks.verify_game_activity', 0)
  );

  UPDATE public."Game" g
  SET
    "lastVerificationAttemptAt" = p_verified_at,
    "verificationMisses" = 0,
    "isActive" = true,
    "inactiveAt" = NULL,
    "inactiveReason" = NULL
  WHERE g."universeId" IN (
    SELECT value::bigint
    FROM jsonb_array_elements_text(p_found_universe_ids) AS value
    WHERE value ~ '^[0-9]+$'
  )
  AND g."universeId" IN (
    SELECT value::bigint
    FROM jsonb_array_elements_text(p_attempted_universe_ids) AS value
    WHERE value ~ '^[0-9]+$'
  );

  UPDATE public."Game" g
  SET
    "lastVerificationAttemptAt" = p_verified_at,
    "verificationMisses" = "verificationMisses" + 1,
    "isActive" = CASE
      WHEN "verificationMisses" + 1 >= 12 THEN false
      ELSE "isActive"
    END,
    "inactiveAt" = CASE
      WHEN "verificationMisses" + 1 >= 12 AND "inactiveAt" IS NULL
        THEN p_verified_at
      ELSE "inactiveAt"
    END,
    "inactiveReason" = CASE
      WHEN "verificationMisses" + 1 >= 12
        THEN 'verification_misses'
      ELSE "inactiveReason"
    END
  WHERE g."universeId" IN (
    SELECT value::bigint
    FROM jsonb_array_elements_text(p_attempted_universe_ids) AS value
    WHERE value ~ '^[0-9]+$'
  )
  AND g."universeId" NOT IN (
    SELECT value::bigint
    FROM jsonb_array_elements_text(p_found_universe_ids) AS value
    WHERE value ~ '^[0-9]+$'
  )
  AND g."isActive" = true;

  GET DIAGNOSTICS processed = ROW_COUNT;
  RETURN processed;
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_game_activity(jsonb, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_game_activity(jsonb, jsonb, timestamptz) TO service_role;
