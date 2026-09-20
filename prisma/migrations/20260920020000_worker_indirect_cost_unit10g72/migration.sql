-- Closure Review Work and Material Cost Unit 10G.72, Task 1.
--
-- Additive-only columns on worker_profiles — no existing salary/cost column
-- removed or renamed, no other table touched. indirect_cost_per_job_card is
-- a one-time-configured, per-Job-Card amount (NOT per hour) that Closure
-- Review adds once per worker when computing that worker's total cost on a
-- Job Card; it is completely independent of hourly_rate/salary_input_method
-- from Unit 10G.68, which remain the only source for direct labor cost.
-- NOT NULL DEFAULT 0 (rather than nullable) means every existing worker's
-- total cost is unchanged until a Manager explicitly sets a non-zero value,
-- and no calling code needs to null-coalesce this value anywhere.

ALTER TABLE worker_profiles
  ADD COLUMN indirect_cost_per_job_card numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN indirect_cost_note text;
