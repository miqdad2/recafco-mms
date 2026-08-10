-- Worker Profile Form Simplification and Division Rename Unit 10G.6, Task 1.
--
-- Additive only: one new nullable column, no existing column changed,
-- renamed, or removed. employee_id is optional (existing worker profiles
-- have none, and display safely as "Employee ID: —") and unique only among
-- ACTIVE workers with a non-null employee_id — a deactivated worker's
-- employee_id can be reused by a genuine replacement hire without being
-- blocked, matching the same "active-only" uniqueness convention this
-- table's existing name+phone duplicate check already applies
-- (findDuplicateActiveWorker in lib/backend/workers/service.ts).

ALTER TABLE worker_profiles ADD COLUMN employee_id text;

CREATE UNIQUE INDEX worker_profiles_employee_id_active_unique
  ON worker_profiles (employee_id)
  WHERE employee_id IS NOT NULL AND is_active = true;
