-- Worker Salary Breakdown and Manager Labor Cost View Unit 10G.41B, Task 1.
--
-- Additive only: 10 new nullable columns on worker_profiles, no existing
-- column changed, renamed, or removed. Existing worker profiles simply get
-- the defaults below (0 for money fields, 260 for monthly working hours) —
-- shown as "Salary Pending" in the UI until a Manager fills in real values.
-- job_title/work_location can be set by Data Entry at creation;
-- reporting_manager/nationality and every salary field below are
-- Manager/Super-Admin-only to set, enforced in
-- lib/backend/workers/service.ts (not just hidden in the UI).

ALTER TABLE worker_profiles
  ADD COLUMN job_title text,
  ADD COLUMN work_location text,
  ADD COLUMN reporting_manager text,
  ADD COLUMN nationality text,
  ADD COLUMN basic_salary numeric(12,3) DEFAULT 0,
  ADD COLUMN transport_allowance numeric(12,3) DEFAULT 0,
  ADD COLUMN accommodation_allowance numeric(12,3) DEFAULT 0,
  ADD COLUMN food_allowance numeric(12,3) DEFAULT 0,
  ADD COLUMN total_salary numeric(12,3) DEFAULT 0,
  ADD COLUMN monthly_working_hours numeric(12,2) DEFAULT 260;
