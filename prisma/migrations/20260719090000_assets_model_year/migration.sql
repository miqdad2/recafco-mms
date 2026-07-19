-- Vehicle Import Unit 1: add model_year to assets.
-- Additive only — nullable, no default, no backfill. Existing asset rows
-- (equipment and any previously created vehicles) remain valid as-is.
-- Distinct from the existing free-text "model" column, which stores the
-- model name/designation, not the year of manufacture.

ALTER TABLE "assets"
ADD COLUMN "model_year" INTEGER;
