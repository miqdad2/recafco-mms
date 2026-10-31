-- Edit Material: master values for the fields Inventory Control otherwise
-- reads from a material's movements (category, part number and SS Rec. Code
-- from the latest movement, location from the latest opening stock). Editing
-- them must not rewrite transaction rows, so the edited value lives on the
-- material's settings row and takes priority for display.
--
-- Additive only: nullable columns, no row is changed. NULL = never edited, the
-- movement value is shown as before. An empty string = deliberately cleared.
-- Material Notes reuse the existing, unused inventory_material_settings.remarks.

ALTER TABLE inventory_material_settings
  ADD COLUMN category    text,
  ADD COLUMN part_number text,
  ADD COLUMN ss_rec_code text,
  ADD COLUMN location    text;
