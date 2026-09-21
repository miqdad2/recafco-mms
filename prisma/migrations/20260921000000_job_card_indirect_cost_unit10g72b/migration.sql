-- Job Card Level Indirect Cost Correction Unit 10G.72B, Task 2.
--
-- Additive-only columns on the app_settings singleton row — no existing
-- column removed or renamed, no other table touched. Unit 10G.72's
-- worker_profiles.indirect_cost_per_job_card/indirect_cost_note columns are
-- deliberately left in place, unused, per this unit's own "do not remove"
-- instruction; Indirect Cost is corrected here to be a single, Job-Card-wide
-- amount configured once (not per worker, not per hour), added once to each
-- Job Card's own Closure Review cost summary. NOT NULL DEFAULT 0 means every
-- existing Job Card's total is unchanged until explicitly configured.

ALTER TABLE app_settings
  ADD COLUMN job_card_indirect_cost numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN job_card_indirect_cost_note text;
