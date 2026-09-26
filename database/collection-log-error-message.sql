-- Add failure details to collection logs for production diagnostics.
ALTER TABLE public."DataCollectionLog"
  ADD COLUMN IF NOT EXISTS "errorMessage" text;
