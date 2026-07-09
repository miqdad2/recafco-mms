-- Phase 11E: Asset Category Master
-- Creates asset_categories table for dynamic 2-level category management.
-- Main categories have parent_id = NULL.
-- Subcategories have parent_id pointing to a main category row.
-- Additive only — no existing tables or columns are altered.

CREATE TABLE "asset_categories" (
  "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
  "name"       TEXT        NOT NULL,
  "parent_id"  UUID,
  "is_active"  BOOLEAN     NOT NULL DEFAULT TRUE,
  "sort_order" INTEGER     NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "asset_categories_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "asset_categories"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION
);

-- Unique: main category names (no parent) must be globally unique
CREATE UNIQUE INDEX "uq_asset_categories_name_no_parent"
  ON "asset_categories"("name")
  WHERE "parent_id" IS NULL;

-- Unique: subcategory name unique within its parent
CREATE UNIQUE INDEX "uq_asset_categories_name_per_parent"
  ON "asset_categories"("name", "parent_id")
  WHERE "parent_id" IS NOT NULL;

CREATE INDEX "idx_asset_categories_parent_id"  ON "asset_categories"("parent_id");
CREATE INDEX "idx_asset_categories_is_active"  ON "asset_categories"("is_active");
CREATE INDEX "idx_asset_categories_sort_order" ON "asset_categories"("sort_order", "name");

-- ─── Seed initial main categories ────────────────────────────────────────────
INSERT INTO "asset_categories" ("name", "parent_id", "sort_order", "is_active") VALUES
  ('Production Equipment',   NULL, 1, TRUE),
  ('Vehicles',               NULL, 2, TRUE),
  ('Heavy Equipment',        NULL, 3, TRUE),
  ('Electrical Equipment',   NULL, 4, TRUE),
  ('Workshop Equipment',     NULL, 5, TRUE),
  ('Facility / Utility',     NULL, 6, TRUE),
  ('IT / Office Equipment',  NULL, 7, TRUE),
  ('Other',                  NULL, 8, TRUE)
ON CONFLICT DO NOTHING;

-- ─── Seed subcategories ───────────────────────────────────────────────────────

-- Production Equipment
INSERT INTO "asset_categories" ("name", "parent_id", "sort_order", "is_active")
SELECT s.name, c.id, s.ord, TRUE
FROM (VALUES ('Batching Plant',1),('Mixer',2),('Compressor',3),('Pump',4),
             ('Conveyor',5),('Spray Machine',6),('Factory Machine',7),('Concrete Equipment',8)) AS s(name,ord)
CROSS JOIN (SELECT id FROM "asset_categories" WHERE name='Production Equipment' AND parent_id IS NULL) c
ON CONFLICT DO NOTHING;

-- Vehicles
INSERT INTO "asset_categories" ("name", "parent_id", "sort_order", "is_active")
SELECT s.name, c.id, s.ord, TRUE
FROM (VALUES ('Car',1),('Pickup',2),('Bus',3),('Truck',4),('Trailer',5)) AS s(name,ord)
CROSS JOIN (SELECT id FROM "asset_categories" WHERE name='Vehicles' AND parent_id IS NULL) c
ON CONFLICT DO NOTHING;

-- Heavy Equipment
INSERT INTO "asset_categories" ("name", "parent_id", "sort_order", "is_active")
SELECT s.name, c.id, s.ord, TRUE
FROM (VALUES ('Crane',1),('Forklift',2),('Loader',3),('Excavator',4),('Generator',5)) AS s(name,ord)
CROSS JOIN (SELECT id FROM "asset_categories" WHERE name='Heavy Equipment' AND parent_id IS NULL) c
ON CONFLICT DO NOTHING;

-- Electrical Equipment
INSERT INTO "asset_categories" ("name", "parent_id", "sort_order", "is_active")
SELECT s.name, c.id, s.ord, TRUE
FROM (VALUES ('Electrical Panel',1),('Transformer',2),('Welding Machine',3),
             ('Control Panel',4),('Cable System',5),('Lighting System',6)) AS s(name,ord)
CROSS JOIN (SELECT id FROM "asset_categories" WHERE name='Electrical Equipment' AND parent_id IS NULL) c
ON CONFLICT DO NOTHING;

-- Workshop Equipment
INSERT INTO "asset_categories" ("name", "parent_id", "sort_order", "is_active")
SELECT s.name, c.id, s.ord, TRUE
FROM (VALUES ('Drill Machine',1),('Lathe',2),('Grinder',3),
             ('Cutting Machine',4),('Hydraulic Press',5),('Tools',6)) AS s(name,ord)
CROSS JOIN (SELECT id FROM "asset_categories" WHERE name='Workshop Equipment' AND parent_id IS NULL) c
ON CONFLICT DO NOTHING;

-- Facility / Utility
INSERT INTO "asset_categories" ("name", "parent_id", "sort_order", "is_active")
SELECT s.name, c.id, s.ord, TRUE
FROM (VALUES ('Air Conditioner',1),('Water Pump',2),('Fire Pump',3),
             ('Boiler',4),('Water System',5),('Air System',6)) AS s(name,ord)
CROSS JOIN (SELECT id FROM "asset_categories" WHERE name='Facility / Utility' AND parent_id IS NULL) c
ON CONFLICT DO NOTHING;

-- IT / Office Equipment
INSERT INTO "asset_categories" ("name", "parent_id", "sort_order", "is_active")
SELECT s.name, c.id, s.ord, TRUE
FROM (VALUES ('Computer',1),('Printer',2),('UPS',3),('Network Device',4)) AS s(name,ord)
CROSS JOIN (SELECT id FROM "asset_categories" WHERE name='IT / Office Equipment' AND parent_id IS NULL) c
ON CONFLICT DO NOTHING;

-- Other
INSERT INTO "asset_categories" ("name", "parent_id", "sort_order", "is_active")
SELECT s.name, c.id, s.ord, TRUE
FROM (VALUES ('Other',1)) AS s(name,ord)
CROSS JOIN (SELECT id FROM "asset_categories" WHERE name='Other' AND parent_id IS NULL) c
ON CONFLICT DO NOTHING;
