-- Job Card Required Materials: manual materials and outside services.
--
-- Additive only. A Job Card requirement is either
--   'inventory' — a material selected from Inventory Control (every existing
--                 row: the default keeps today's meaning unchanged), or
--   'manual'    — a description typed on the Job Card (an outside repair or
--                 service, or a material not registered in Inventory), with a
--                 quantity and a unit. It never has an Inventory identity:
--                 material issue, Process Materials, Materials Requests and
--                 the Inventory Check ignore it, and it never creates an
--                 Inventory material, Item Code or stock movement.
--
-- Adding a NOT NULL column with a constant default is a catalog-only change
-- in PostgreSQL 11+ (no table rewrite). Every existing row is 'inventory', so
-- the shape check below holds for all of them.

ALTER TABLE public.work_order_required_parts
  ADD COLUMN entry_type text NOT NULL DEFAULT 'inventory'
    CONSTRAINT work_order_required_parts_entry_type_check CHECK (entry_type IN ('inventory', 'manual'));

-- A manual requirement carries no Inventory identity (no part, no Inventory
-- key, no unit conversion) and always has a description, a unit and a
-- positive quantity.
ALTER TABLE public.work_order_required_parts
  ADD CONSTRAINT work_order_required_parts_manual_shape_check CHECK (
    entry_type <> 'manual'
    OR (
      part_id IS NULL
      AND inventory_material_key IS NULL
      AND purchase_unit IS NULL
      AND conversion_quantity IS NULL
      AND btrim(description) <> ''
      AND btrim(unit_of_measure) <> ''
      AND quantity_required > 0
    )
  );
