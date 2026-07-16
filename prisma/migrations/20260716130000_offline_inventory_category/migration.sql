-- Phase MaintenanceStore-06: add an optional Category to Maintenance Store
-- movements, used to group manually-entered materials for Store Balance
-- category cards/filtering and Excel opening-stock import.
-- Additive only — nullable, no existing columns/data are touched. Records
-- with no category are treated as "Other" in the application layer.

ALTER TABLE "offline_inventory_movements"
  ADD COLUMN "category" TEXT;
