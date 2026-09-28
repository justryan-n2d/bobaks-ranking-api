-- Phase 2 verification-confidence hardening.
-- A missing result from one Roblox source is not enough to count a miss.
-- The worker now classifies candidates as found, confirmed missing, or uncertain.
-- Uncertain candidates are recorded as attempted but do not increment misses.

DROP FUNCTION IF EXISTS public.verify_game_activity(jsonb, jsonb, timestamptz);

CREATE OR REPLACE FUNCTION public.verify_game_activity(
  p_attempted_universe_ids jsonb,
  p_found_universe_ids jsonb,
  p_uncertain_universe_ids jsonb,
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
     OR jsonb_typeof(COALESCE(p_found_universe_ids, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_uncertain_universe_ids, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Verification universe ID inputs must be JSON arrays';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('bobaks.verify_game_activity', 0)
  );

  -- A found universe is healthy again, so clear any prior verification misses.
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

  -- An inconclusive verification still counts as an attempt, but never
  -- rewards the game with a reset and never increments its miss counter.
  UPDATE public."Game" g
  SET
    "lastVerificationAttemptAt" = p_verified_at
  WHERE g."universeId" IN (
    SELECT value::bigint
    FROM jsonb_array_elements_text(p_uncertain_universe_ids) AS value
    WHERE value ~ '^[0-9]+$'
  )
  AND g."universeId" IN (
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

  -- Only candidates confirmed missing by the worker are allowed to
  -- contribute to the consecutive miss counter and 12-miss deactivation.
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
  AND g."universeId" NOT IN (
    SELECT value::bigint
    FROM jsonb_array_elements_text(p_uncertain_universe_ids) AS value
    WHERE value ~ '^[0-9]+$'
  )
  AND g."isActive" = true;

  GET DIAGNOSTICS processed = ROW_COUNT;
  RETURN processed;
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_game_activity(jsonb, jsonb, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_game_activity(jsonb, jsonb, jsonb, timestamptz) TO service_role;
