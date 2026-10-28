-- Job Card Start Date / Job Card End Date: two optional calendar dates that
-- Data Entry types on the Job Card (New Job Card wizard Step 2 and the Edit
-- Job Card form). They belong to the Job Card itself and are NOT worker
-- time: no timer, work session, manual time entry, correction, labor-hour,
-- cost, closure or lifecycle code reads or writes them. They are also
-- separate from the older starting_datetime / ending_datetime columns, which
-- feed the overdue checks and the recorded Work Start / Work End fallback.
--
-- Additive only: two nullable columns, no default, no existing row is
-- changed — older Job Cards keep NULL ("Not entered"); no date is invented.
-- The check mirrors the application rule (lib/work-orders/job-card-edit.ts):
-- an End Date needs a Start Date and may not be earlier than it. Every
-- existing row is NULL/NULL, so adding it validates trivially.

ALTER TABLE work_orders
  ADD COLUMN job_card_start_date date,
  ADD COLUMN job_card_end_date date;

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_job_card_dates_check CHECK (
    job_card_end_date IS NULL
    OR (job_card_start_date IS NOT NULL AND job_card_end_date >= job_card_start_date)
  );
