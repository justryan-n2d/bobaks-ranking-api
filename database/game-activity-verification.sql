-- Game activity and verification model.
-- lastObservedAt = last collector cycle in which Roblox discovery returned the game.
-- lastVerificationAttemptAt = last explicit existence check for a stale game.
-- verificationMisses = consecutive explicit verification attempts with no Roblox result.
-- Active games become eligible for verification after 24 hours without observation.
-- After 12 consecutive misses, about 2 hours at the 10-minute cadence, the game
-- is marked inactive. Discovery of the game immediately reactivates it.
-- Ranking coverage rules are intentionally unchanged.

ALTER TABLE public."Game"
  ADD COLUMN IF NOT EXISTS "lastObservedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "lastVerificationAttemptAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "verificationMisses" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "inactiveAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "inactiveReason" text;

UPDATE public."Game" g
SET "lastObservedAt" = latest.last_snapshot
FROM (
  SELECT "gameId", MAX("timestamp") AS last_snapshot
  FROM public."GameSnapshot"
  GROUP BY "gameId"
) latest
WHERE latest."gameId" = g."id"
  AND g."lastObservedAt" IS NULL;

ALTER TABLE public."Game"
  DROP CONSTRAINT IF EXISTS "Game_verificationMisses_nonnegative";

ALTER TABLE public."Game"
  ADD CONSTRAINT "Game_verificationMisses_nonnegative"
  CHECK ("verificationMisses" >= 0);

CREATE INDEX IF NOT EXISTS "Game_active_lastObservedAt_idx"
  ON public."Game" ("isActive", "lastObservedAt");

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
