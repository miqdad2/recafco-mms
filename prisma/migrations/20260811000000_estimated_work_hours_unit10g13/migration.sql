-- Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 14.
--
-- Additive only: two new nullable columns, no existing column changed,
-- renamed, or removed, no data rewrite. Existing Job Cards/assignments have
-- no estimate and read back NULL — every UI surface added in this unit
-- displays "No estimate recorded." for a NULL estimated_labor_hours, never
-- requires one. Precision (12,2) matches the existing hour-like fields on
-- work_orders (running_hours, next_service_running_hours) — 2 decimal
-- places is enough for hand-entered estimates like 1.5/2/4.25, and this is
-- deliberately NOT Decimal(12,3) like hourly_rate_snapshot/money fields,
-- since these are planning hours, not currency.

ALTER TABLE work_orders ADD COLUMN estimated_labor_hours numeric(12, 2);

ALTER TABLE work_order_worker_assignments ADD COLUMN estimated_hours numeric(12, 2);
