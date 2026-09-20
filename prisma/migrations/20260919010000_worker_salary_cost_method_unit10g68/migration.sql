-- Worker Salary Cost Method and Rate Calculation Unit 10G.68, Task 7.
--
-- Additive columns on worker_profiles only — no existing column removed or
-- renamed, no other table touched. salary_input_method controls which
-- single field (Yearly Cost / Monthly Cost / Manual Hourly Rate) the Add/Edit
-- Worker form shows as editable; yearly_cost/monthly_cost hold the entered
-- basis for whichever method is active (both left NULL when the method is
-- manual_hourly_rate, since that method's estimated monthly/yearly/daily
-- figures are display-only and recomputed on read, never stored as if they
-- were an entered value). hourly_rate itself (already on this table since
-- an earlier unit) remains the one field every other part of the app reads
-- for Job Card labor cost — untouched by this migration.

ALTER TABLE worker_profiles
  ADD COLUMN salary_input_method text DEFAULT 'yearly_cost',
  ADD COLUMN yearly_cost numeric(14,3),
  ADD COLUMN monthly_cost numeric(14,3),
  ADD COLUMN monthly_working_days numeric(6,2) DEFAULT 26,
  ADD COLUMN manual_hourly_rate_reason text;

ALTER TABLE worker_profiles
  ADD CONSTRAINT worker_profiles_salary_input_method_check
  CHECK (salary_input_method IN ('yearly_cost', 'monthly_cost', 'manual_hourly_rate'));

-- Task 8 — existing-worker backfill, in priority order:
--   1. Had a real monthly total_salary already -> treat it as the Monthly
--      Cost basis going forward (closest match to what was actually there).
--   2. No total_salary but a real hourly_rate already -> treat as Manual
--      Hourly Rate (that number was clearly entered/relied on directly).
--   3. Neither -> left at the column default (yearly_cost method, basis
--      NULL), which the app shows as "Salary Pending".
UPDATE worker_profiles
  SET salary_input_method = 'monthly_cost',
      monthly_cost = total_salary
  WHERE total_salary IS NOT NULL AND total_salary > 0;

UPDATE worker_profiles
  SET salary_input_method = 'manual_hourly_rate'
  WHERE (total_salary IS NULL OR total_salary = 0)
    AND hourly_rate IS NOT NULL AND hourly_rate > 0;
