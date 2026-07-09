-- Drop the legacy hardcoded category CHECK constraint on "assets".
--
-- This constraint predates the Phase 11E asset_categories master table and
-- restricted assets.category to a fixed 11-value enum (Vehicle, Bus, Car,
-- Truck, Crane, Forklift, Generator, Factory Machine, Electrical Equipment,
-- Building/Facility, Other). It was never represented in Prisma's tracked
-- migration history (untracked drift on the live database), and it silently
-- rejects every asset save/import using any of the newly seeded dynamic
-- categories (e.g. "Production Equipment", "Batching Plant", "Heavy
-- Equipment", "Workshop Equipment", "IT / Office Equipment", ...).
--
-- assets.category is intentionally a free-text column (not an FK) validated
-- at the application layer against the asset_categories master table, so no
-- replacement DB-level constraint is needed.

ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_category_check";
