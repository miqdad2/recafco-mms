-- Materials Request Type Selection Flow Unit 10G.58, Task 3/8.
--
-- Two new, fully separate tables for the "General Inventory / Stock
-- Request" flow (no Job Card required). Deliberately NOT reusing
-- parts_requests — its work_order_id is a required, non-nullable FK that
-- the entire Job Card materials workflow (approval, Waiting Stock,
-- issueMaterials, Job Card status sync) depends on being present, and its
-- status column is a locked 5-value machine (Requested/Approved/Waiting
-- Stock/Partially Issued/Issued) enforced by lib/workflows/status-rules.ts.
-- A separate table keeps this new flow's much simpler Pending/Completed/
-- Cancelled status entirely independent, so nothing here can affect the
-- existing Job Card Materials Request flow. requested_by/department are
-- stored as plain scalar columns (no FK/relation declared in Prisma), so
-- this migration does not alter any existing table.

CREATE TABLE general_inventory_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number     text UNIQUE,
  purpose            text NOT NULL,
  remarks            text,
  department         text,
  location           text,
  status             text NOT NULL DEFAULT 'Pending',
  requested_by_id    uuid,
  requested_by_name  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  CONSTRAINT general_inventory_requests_status_check
    CHECK (status IN ('Pending', 'Completed', 'Cancelled'))
);

CREATE INDEX idx_general_inventory_requests_status ON general_inventory_requests(status);
CREATE INDEX idx_general_inventory_requests_created_at ON general_inventory_requests(created_at);

CREATE TABLE general_inventory_request_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           uuid NOT NULL REFERENCES general_inventory_requests(id) ON DELETE CASCADE,
  material_name        text NOT NULL,
  description          text,
  quantity_requested    numeric(12,2) NOT NULL,
  unit                  text NOT NULL,
  unit_price             numeric(12,3),
  total_price             numeric(12,3) GENERATED ALWAYS AS (COALESCE(quantity_requested,0) * COALESCE(unit_price,0)) STORED,
  supplier                text,
  remarks                 text,
  received_quantity        numeric(12,2) NOT NULL DEFAULT 0,
  received_unit_price      numeric(12,3),
  -- Unit, Price, and Conversion Polish Unit 10G.58A, Task 5/6/10: `unit`
  -- above is always the PURCHASE unit (what the request was made in, e.g.
  -- BARREL). inventory_unit/conversion_quantity are optional and only
  -- present when the item is purchased in one unit but stored/issued in
  -- another (e.g. 1 BARREL = 200 LITER) — NULL on both means "no
  -- conversion", i.e. inventory unit = purchase unit, 1:1. The two
  -- GENERATED columns below always reflect that same NULL-means-1 rule
  -- (COALESCE(conversion_quantity,1)), so a plain PCS/BOX/etc. item's
  -- inventory_quantity_to_add is simply its quantity_requested and its
  -- unit_cost is simply its unit_price — no special-casing needed anywhere
  -- that reads these two columns for future inventory valuation reporting.
  inventory_unit           text,
  conversion_quantity      numeric(12,4),
  inventory_quantity_to_add numeric(14,4) GENERATED ALWAYS AS (COALESCE(quantity_requested,0) * COALESCE(conversion_quantity,1)) STORED,
  unit_cost                 numeric(14,6) GENERATED ALWAYS AS (
    CASE WHEN unit_price IS NULL THEN NULL ELSE unit_price / COALESCE(conversion_quantity,1) END
  ) STORED,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT general_inventory_request_items_qty_check CHECK (quantity_requested > 0),
  CONSTRAINT general_inventory_request_items_price_check CHECK (unit_price IS NULL OR unit_price >= 0),
  CONSTRAINT general_inventory_request_items_conversion_check CHECK (conversion_quantity IS NULL OR conversion_quantity > 0)
);

CREATE INDEX idx_general_inventory_request_items_request_id ON general_inventory_request_items(request_id);
