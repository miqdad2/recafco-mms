-- Inventory Cost and Stock Value Foundation Unit 10G.61, Task 2.
--
-- Additive only: two new nullable columns on offline_inventory_movements
-- so General Inventory receipts and Add New Material's optional Opening
-- Unit Cost can record what a movement cost, without requiring cost on
-- every movement — an Issue or a manual entry with no price info simply
-- leaves both null, exactly as every existing row already is today.
--
-- Deliberately no new "material master" table/columns for last_unit_cost/
-- average_unit_cost: Offline Inventory materials aren't modeled as a
-- persistent master row (a "material" here is just a recurring identity —
-- part_id, or manual_material_name+unit — across movement rows; see
-- buildBalanceKey() in lib/store/offline-inventory-data.ts). "Last unit
-- cost" and "stock value" for a material are instead derived at read time
-- from the most recent movement with a non-null unit_cost for that same
-- identity — simpler, always consistent with the ledger, and needs no
-- extra schema. The existing parts.unit_price column (a different,
-- purchase-catalog-specific field used by Store > Parts / Purchase
-- Requests) is intentionally left untouched — these are two separate
-- systems, per prior units' own findings.
ALTER TABLE offline_inventory_movements
  ADD COLUMN unit_cost numeric(14,6),
  ADD COLUMN total_cost numeric(14,3),
  ADD CONSTRAINT offline_inventory_movements_unit_cost_check CHECK (unit_cost IS NULL OR unit_cost >= 0),
  ADD CONSTRAINT offline_inventory_movements_total_cost_check CHECK (total_cost IS NULL OR total_cost >= 0);
