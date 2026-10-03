-- Materials Request Existing-vs-New Material and Unit Conversion UX Fix.
--
-- Additive only: four nullable columns on general_inventory_request_items.
-- No existing column, generated column, constraint, or row is changed.
--
-- inventory_material_key / inventory_part_id — set only when the row was
-- linked to an existing Offline Inventory material at request time (the
-- same identity key buildBalanceKey() in lib/store/offline-inventory-data.ts
-- produces: "part:<uuid>" or "manual:<name>|<unit>"). NULL means "New
-- Material Request" — not linked to Inventory. Plain scalar columns, no FK,
-- same choice already made for this table's other references.
--
-- request_unit / request_quantity — the Request / Issue Unit and the
-- quantity entered in that unit. The pre-existing columns keep their
-- original meaning so the receive flow and both generated columns are
-- untouched: `unit` is still the purchase unit, `quantity_requested` the
-- quantity in that unit, `inventory_unit`/`conversion_quantity` the
-- store/issue unit and "1 purchase unit = N issue units". For a row with no
-- purchase conversion, request_unit = unit and request_quantity =
-- quantity_requested. For a converted row, quantity_requested holds the
-- purchase estimate (request_quantity / conversion_quantity) at that
-- column's 2-decimal precision, while request_quantity keeps the exact
-- requested amount. Both NULL on rows created before this migration.

ALTER TABLE general_inventory_request_items
  ADD COLUMN inventory_material_key text,
  ADD COLUMN inventory_part_id      uuid,
  ADD COLUMN request_unit           text,
  ADD COLUMN request_quantity       numeric(14,4);

ALTER TABLE general_inventory_request_items
  ADD CONSTRAINT general_inventory_request_items_request_qty_check
  CHECK (request_quantity IS NULL OR request_quantity > 0);
