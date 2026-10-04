-- Inventory-First Material Request Workflow.
--
-- Inventory Control becomes the source of truth for how a material is
-- bought: inventory_material_settings (one row per material identity,
-- already holding minimum stock / reorder quantity) gains the material's
-- purchase unit and conversion. The identity's own `unit` column stays the
-- Stock Unit (the unit the balance is counted and issued in).
--
-- purchase_unit       — how the supplier sells it (e.g. BOX).
-- conversion_quantity — stock units inside 1 purchase unit (1 BOX = 9 PCS).
-- Both NULL means the material is bought in its Stock Unit (1:1) — the case
-- for every material that existed before this migration. Additive only; no
-- existing row or value changes.

ALTER TABLE inventory_material_settings
  ADD COLUMN purchase_unit       text,
  ADD COLUMN conversion_quantity numeric(12,4);

ALTER TABLE inventory_material_settings
  ADD CONSTRAINT inventory_material_settings_unit_setup_check
  CHECK (
    (purchase_unit IS NULL AND conversion_quantity IS NULL)
    OR (purchase_unit IS NOT NULL AND conversion_quantity IS NOT NULL AND conversion_quantity > 0)
  );
