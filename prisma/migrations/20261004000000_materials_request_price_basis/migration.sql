-- Material Request Purchase-First Unit and Flexible Price Basis.
--
-- Additive only, on both Materials Request item tables. No existing column
-- or row value is changed.
--
-- price_basis — which unit the estimated price was entered against:
--   'purchase_unit' (e.g. 10.000 KWD per BOX) or 'stock_unit' (e.g. 1.200
--   KWD per PCS). NULL on every row created before this migration and on
--   any unpriced row.
--
-- entered_unit_price — the estimated price exactly as typed, in the
--   price_basis unit, so the request detail can show it back unchanged.
--
-- The existing unit_price column keeps its current meaning on each table,
-- because downstream code depends on it:
--   general_inventory_request_items.unit_price = per purchase unit (`unit`)
--     — used by Receive (received cost, generated unit_cost/total_price).
--   parts_request_items.unit_price = per request/stock unit (`unit`)
--     — used by the generated total_price and by purchase-request creation.
-- The application converts entered_unit_price into that unit on save.

ALTER TABLE general_inventory_request_items
  ADD COLUMN price_basis        text,
  ADD COLUMN entered_unit_price numeric(12,3);

ALTER TABLE general_inventory_request_items
  ADD CONSTRAINT general_inventory_request_items_price_basis_check
  CHECK (price_basis IS NULL OR price_basis IN ('purchase_unit', 'stock_unit'));

ALTER TABLE parts_request_items
  ADD COLUMN price_basis        text,
  ADD COLUMN entered_unit_price numeric(12,3);

ALTER TABLE parts_request_items
  ADD CONSTRAINT parts_request_items_price_basis_check
  CHECK (price_basis IS NULL OR price_basis IN ('purchase_unit', 'stock_unit'));
