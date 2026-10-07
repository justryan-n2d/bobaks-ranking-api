-- Every new run creates its DataCollectionLog row before snapshots are inserted.
-- The existing database has legacy orphan snapshots, so the FK is intentionally NOT VALID.
-- It still enforces referential integrity for all future writes.

CREATE UNIQUE INDEX IF NOT EXISTS data_collection_log_collection_run_id_key
  ON public."DataCollectionLog" ("collectionRunId")
  WHERE "collectionRunId" IS NOT NULL;

ALTER TABLE public."GameSnapshot"
  ADD CONSTRAINT game_snapshot_collection_run_id_fkey
  FOREIGN KEY ("collectionRunId")
  REFERENCES public."DataCollectionLog" ("collectionRunId")
  NOT VALID;
