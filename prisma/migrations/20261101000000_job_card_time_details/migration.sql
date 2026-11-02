-- Job Card Time Details: the two moments the system could not record.
--
-- job_card_opened_at: the exact opening moment, when Data Entry adds a time to
-- the Job Card Open Date. job_card_start_date stays the date of record; this
-- only adds the time, so it must fall on that same Kuwait calendar day.
-- starting_datetime is not reused because the overdue reports read it, and
-- created_at is when the record was saved, not when the Job Card was opened.
--
-- work_completed_at: the completion moment entered at closure request, for
-- Job Cards whose worker time cannot prove it (No Workers Required, or manual
-- time without a clock time). No work session is created for it.
--
-- Additive only: two nullable columns with no default. Existing rows stay NULL
-- and show "Time not recorded" / "Not available"; no time is invented. The
-- Manager's approval time stays in approvals.decided_at.

ALTER TABLE work_orders
  ADD COLUMN job_card_opened_at timestamptz,
  ADD COLUMN work_completed_at timestamptz;

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_job_card_opened_at_check CHECK (
    job_card_opened_at IS NULL
    OR (job_card_opened_at AT TIME ZONE 'Asia/Kuwait')::date = job_card_start_date
  );
