-- Phase 7: Asset Master Data — add condition, criticality, remarks
-- Additive only. All three columns are nullable — existing asset records remain valid.
-- No data loss, no destructive alterations.

ALTER TABLE "assets"
  ADD COLUMN IF NOT EXISTS "condition"    TEXT,
  ADD COLUMN IF NOT EXISTS "criticality"  TEXT,
  ADD COLUMN IF NOT EXISTS "remarks"      TEXT;

CREATE INDEX IF NOT EXISTS "idx_assets_criticality"
  ON "assets"("criticality")
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS "idx_assets_condition"
  ON "assets"("condition")
  WHERE deleted_at IS NULL;
