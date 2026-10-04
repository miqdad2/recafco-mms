-- New Job Card Required Materials Inventory Selection and Smart Unit UX.
--
-- Additive only, all nullable, on work_order_required_parts. Existing
-- columns keep their meaning — and material issue / closure tracking keeps
-- matching on them: description + unit_of_measure (or part_id) identify the
-- Inventory material, quantity_required is in that material's Stock Unit.
--
-- New snapshot columns, set by the New Job Card wizard for a row selected
-- from Inventory:
--   inventory_material_key — the Inventory identity key ("part:<id>" /
--                            "manual:<name>|<unit>") the row was selected as.
--   ss_rec_code            — SS Rec. Code at the time of selection.
--   entered_quantity       — the quantity as the user typed it.
--   entered_unit           — the unit it was typed in: the Stock Unit, or
--                            the material's Purchase Unit.
--   purchase_unit /
--   conversion_quantity    — the material's Inventory unit setup at the time
--                            (1 purchase_unit = conversion_quantity
--                            unit_of_measure); both NULL = bought in the
--                            stock unit.
-- quantity_required = entered_quantity × conversion when entered_unit is the
-- purchase unit, otherwise entered_quantity. NULL on every older row.

ALTER TABLE work_order_required_parts
  ADD COLUMN inventory_material_key text,
  ADD COLUMN ss_rec_code            text,
  ADD COLUMN entered_quantity       numeric(12,2),
  ADD COLUMN entered_unit           text,
  ADD COLUMN purchase_unit          text,
  ADD COLUMN conversion_quantity    numeric(12,4);

ALTER TABLE work_order_required_parts
  ADD CONSTRAINT work_order_required_parts_conversion_check
  CHECK (conversion_quantity IS NULL OR conversion_quantity > 0);
