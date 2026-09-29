ALTER TABLE public."DataCollectionLog"
  ADD COLUMN IF NOT EXISTS "rankingRefreshStatus" text,
  ADD COLUMN IF NOT EXISTS "rankingRefreshStartedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "rankingRefreshFinishedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "rankingRefreshErrorMessage" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'DataCollectionLog_rankingRefreshStatus_valid'
      AND conrelid = 'public."DataCollectionLog"'::regclass
  ) THEN
    ALTER TABLE public."DataCollectionLog"
      ADD CONSTRAINT "DataCollectionLog_rankingRefreshStatus_valid"
      CHECK (
        "rankingRefreshStatus" IS NULL
        OR "rankingRefreshStatus" IN ('pending', 'success', 'failed')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "DataCollectionLog_rankingRefreshStatus_startedAt_idx"
  ON public."DataCollectionLog" ("rankingRefreshStatus", "rankingRefreshStartedAt" DESC);
