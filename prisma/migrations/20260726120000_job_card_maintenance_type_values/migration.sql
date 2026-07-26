-- New Job Card Wizard Cleanup + Draft/Material Submit Fix Task 2:
-- widens the existing work_orders_maintenance_type_check constraint to also
-- allow the new, business-approved maintenance type list ("Repair",
-- "Break Down") used by the New Job Card wizard going forward. The old
-- values are kept in the allowed list (not removed) so existing rows that
-- already hold them remain valid without any backfill/data migration.
ALTER TABLE "work_orders"
  DROP CONSTRAINT IF EXISTS "work_orders_maintenance_type_check";

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_maintenance_type_check"
  CHECK (maintenance_type = ANY (ARRAY[
    'Repair'::text, 'Routine'::text, 'Service'::text, 'Break Down'::text, 'Other'::text,
    'Breakdown'::text, 'Preventive'::text, 'Inspection'::text, 'Emergency'::text
  ]));
