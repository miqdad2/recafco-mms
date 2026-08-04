-- Backend Reliability / Performance Optimization Unit 3, Task 8.
--
-- Additive only — CREATE INDEX IF NOT EXISTS, no data change, no column/table
-- change, nothing dropped. Targets the exact query shapes introduced by this
-- unit's optimizations (see lib/store/offline-inventory-data.ts,
-- app/(dashboard)/store/parts-requests/page.tsx,
-- app/(dashboard)/store/offline-inventory/movements/page.tsx):
--
-- 1. idx_oim_balance_identity — serves getOfflineInventoryBalance()'s new
--    SQL-side groupBy(part_id, manual_material_name, unit, movement_type) and
--    the distinct-on metadata queries, all filtered by deleted_at IS NULL.
--    This is the Offline Inventory Control page's core query, on the table
--    that grows fastest and never shrinks (every movement recorded, ever).
-- 2. idx_oim_deleted_movement_date — serves Movement History's paginated
--    listing (WHERE deleted_at IS NULL ORDER BY movement_date DESC), replacing
--    two separate single-column index lookups (deleted_at, movement_date)
--    with one index that matches the query directly.
-- 3. idx_parts_requests_created_at — serves the Materials Requests list's new
--    bucket-based pagination, each bucket ordered by created_at.
-- 4. idx_work_orders_status_updated_at — serves the dashboard's and Job Cards
--    list's frequent "status = X, ordered/filtered by updated_at" queries
--    (Manager queues, "closed recently" counts).
--
-- profiles.deleted_at / profiles(is_active, deleted_at) and
-- work_orders(deleted_at, status) were evaluated and NOT added here — see the
-- Unit 3 report: profiles is an inherently small internal-staff table where
-- the existing single-column indexes are already sufficient at any realistic
-- size, and work_orders already has separate deleted_at/status indexes whose
-- bitmap-AND combination is adequate at this system's scale. Recommended
-- only, not created, per the task's "if not 100% sure, only recommend" rule.
--
-- Plain CREATE INDEX (not CONCURRENTLY) is safe to run as-is right now given
-- this system's current data volume (low tens of rows in every table
-- involved, per the Unit 3 report) — the brief write-lock during index build
-- is negligible at this size. If this migration is ever deferred and applied
-- after substantial production data growth, run the CREATE INDEX statements
-- below manually with CONCURRENTLY first (outside a transaction) instead of
-- a blind `prisma migrate deploy`.

CREATE INDEX IF NOT EXISTS "idx_oim_balance_identity"
  ON "public"."offline_inventory_movements" ("deleted_at", "part_id", "manual_material_name", "unit");

CREATE INDEX IF NOT EXISTS "idx_oim_deleted_movement_date"
  ON "public"."offline_inventory_movements" ("deleted_at", "movement_date" DESC);

CREATE INDEX IF NOT EXISTS "idx_parts_requests_created_at"
  ON "public"."parts_requests" ("created_at");

CREATE INDEX IF NOT EXISTS "idx_work_orders_status_updated_at"
  ON "public"."work_orders" ("status", "updated_at");
