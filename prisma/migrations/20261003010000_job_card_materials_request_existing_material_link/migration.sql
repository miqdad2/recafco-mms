-- Job Card Materials Request UX and Existing Inventory Selection Fix.
--
-- Additive on parts_request_items, plus one existing column loosened from
-- NOT NULL to nullable (no row's current value is changed, no data moved):
--
-- unit — the Request / Issue Unit (the unit maintenance/store will issue
-- in). NULL on every row created before this migration; the old form never
-- actually persisted a unit at all (its unit_of_measure_<i> field was never
-- read server-side).
--
-- inventory_material_key — set only when this row was linked to an
-- existing, non-catalog (manual) Offline Inventory material, using the same
-- "manual:<name>|<unit>" identity key buildBalanceKey() in
-- lib/store/offline-inventory-data.ts produces. A catalog-backed match
-- instead sets the pre-existing part_id column above (both tables already
-- share the same parts.id, so no second id column is needed here, unlike
-- the sibling general_inventory_request_items migration which had no
-- existing part_id to reuse). Both part_id and inventory_material_key NULL
-- means "New Material Request" — not linked to Inventory.
--
-- purchase_unit / conversion_quantity — set only when "Purchased in a
-- different unit" is used. quantity_requested/unit keep meaning "requested
-- amount, in the Request/Issue Unit" (unchanged from this table's own
-- pre-existing quantity_requested semantics) — conversion_quantity means
-- "1 purchase_unit = conversion_quantity unit", so the purchase estimate
-- (quantity_requested / conversion_quantity) is always computed on display,
-- never persisted as its own column.
--
-- unit_price dropped NOT NULL (default 0 kept, for any untouched caller
-- that omits it) so "not priced yet" can be stored as NULL instead of a
-- misleading 0 — the existing generated total_price column already wraps
-- unit_price in COALESCE(unit_price, 0), so it keeps working unchanged for
-- both NULL and real values.

ALTER TABLE parts_request_items
  ALTER COLUMN unit_price DROP NOT NULL,
  ADD COLUMN unit                   text,
  ADD COLUMN inventory_material_key text,
  ADD COLUMN purchase_unit          text,
  ADD COLUMN conversion_quantity    numeric(12,4);

ALTER TABLE parts_request_items
  ADD CONSTRAINT parts_request_items_conversion_qty_check
  CHECK (conversion_quantity IS NULL OR conversion_quantity > 0);
