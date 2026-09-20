-- Inventory Clarity, Low Stock, and Bulk Unit Balance Unit 10G.62, Task 2.
--
-- Additive only: a new, small settings table keyed by the exact same
-- material identity concept buildBalanceKey() already uses in
-- lib/store/offline-inventory-data.ts (a catalog part_id, OR a manual
-- material name + unit) — Option B from the task, since Offline Inventory
-- has no material-master table to attach these fields to (a "material" is
-- just a recurring identity across offline_inventory_movements rows).
-- Every existing movement row is completely unaffected; a material with no
-- row here simply has no minimum stock configured (treated as "no minimum
-- set" per the task's own OK-status rule).
--
-- Deliberately no preferred_location_bin column here — Offline Inventory
-- already has a location concept (the most recent Opening Stock movement's
-- counterparty field, shown as "Location / Bin" on Add New Material and the
-- balance list today); adding a second, competing "preferred" location
-- source here would create two answers to "where is this material," which
-- is the opposite of this unit's own goal of clarity.
CREATE TABLE inventory_material_settings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id                uuid REFERENCES parts(id) ON DELETE CASCADE,
  manual_material_name   text,
  unit                   text NOT NULL,
  minimum_stock_quantity numeric(12,3),
  reorder_quantity       numeric(12,3),
  remarks                text,
  created_by             uuid NOT NULL REFERENCES profiles(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_material_settings_identity_check CHECK (
    (part_id IS NOT NULL AND manual_material_name IS NULL) OR
    (part_id IS NULL AND manual_material_name IS NOT NULL)
  ),
  CONSTRAINT inventory_material_settings_min_stock_check CHECK (minimum_stock_quantity IS NULL OR minimum_stock_quantity >= 0),
  CONSTRAINT inventory_material_settings_reorder_check CHECK (reorder_quantity IS NULL OR reorder_quantity > 0)
);

-- One settings row per material identity — same identity split
-- buildBalanceKey() uses (a catalog part, or a case-insensitive manual
-- name+unit pair).
CREATE UNIQUE INDEX inventory_material_settings_part_unique
  ON inventory_material_settings(part_id) WHERE part_id IS NOT NULL;
CREATE UNIQUE INDEX inventory_material_settings_manual_unique
  ON inventory_material_settings(LOWER(manual_material_name), LOWER(unit)) WHERE part_id IS NULL;

CREATE INDEX idx_inventory_material_settings_part_id ON inventory_material_settings(part_id);
