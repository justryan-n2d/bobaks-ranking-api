-- Link every collector snapshot to the collector run that produced it.
-- New snapshots are valid for rankings only when their run is finalized as
-- success or partial. Legacy snapshots remain NULL-linked and continue to
-- be treated as valid historical data.

ALTER TABLE public."DataCollectionLog"
  ADD COLUMN IF NOT EXISTS "collectionRunId" uuid;

ALTER TABLE public."GameSnapshot"
  ADD COLUMN IF NOT EXISTS "collectionRunId" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "DataCollectionLog_collectionRunId_unique_idx"
  ON public."DataCollectionLog" ("collectionRunId")
  WHERE "collectionRunId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "GameSnapshot_collectionRunId_idx"
  ON public."GameSnapshot" ("collectionRunId");
