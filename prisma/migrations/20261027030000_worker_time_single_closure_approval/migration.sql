-- Worker Time: Automatic or Manual, Single Closure Approval.
--
-- Data Entry's manual worker time and time corrections are now saved at
-- once and reviewed only in the Manager's Job Card Closure Review (the one
-- approval stage); the Manager can return the closure request for
-- correction. Additive only — nothing existing is rewritten or deleted:
--
-- 1. work_order_work_sessions — how a manual period was entered:
--      start_time_known / end_time_known: false when only the date was
--        entered (the stored time is then the start/end of that Kuwait day).
--      period_is_span: true when started_at → stopped_at is the date range
--        the work happened in, not one continuous period. The worked time is
--        then duration_minutes (the "Actual Hours Worked" entered), never end
--        minus start. Such a period is not used to block other periods; the
--        Manager sees possible overlaps flagged in Closure Review.
--    Defaults (true / true / false) describe every existing row exactly.
--
-- 2. work_session_time_corrections — new status 'Recorded' (saved at once,
--    reviewed at closure). 'Pending' / 'Approved' / 'Rejected' rows stay as
--    they are: a Pending row from before this change is still decided by the
--    Manager with the existing Approve / Reject, is not counted until
--    approved, and still blocks closure until decided. client_submission_id
--    makes a repeated submission (double click, retry) return the first save.
--
-- 3. approvals — status 'Closure Returned' for the Manager's "Return for
--    Correction" decision in Closure Review.

ALTER TABLE work_order_work_sessions
  ADD COLUMN start_time_known boolean NOT NULL DEFAULT true,
  ADD COLUMN end_time_known boolean NOT NULL DEFAULT true,
  ADD COLUMN period_is_span boolean NOT NULL DEFAULT false;

ALTER TABLE work_session_time_corrections
  ADD COLUMN client_submission_id uuid;

CREATE UNIQUE INDEX work_session_time_corrections_client_submission_id_key
  ON work_session_time_corrections (client_submission_id);

ALTER TABLE work_session_time_corrections
  DROP CONSTRAINT work_session_time_corrections_status_check,
  ADD CONSTRAINT work_session_time_corrections_status_check
    CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Recorded'));

-- Same shape rule as before, extended to 'Recorded': an applied manual entry
-- always points at the work period it created.
ALTER TABLE work_session_time_corrections
  DROP CONSTRAINT work_session_time_corrections_shape_check,
  ADD CONSTRAINT work_session_time_corrections_shape_check
    CHECK (
      (entry_kind = 'correction'
        AND work_session_id IS NOT NULL
        AND original_started_at IS NOT NULL
        AND original_ended_at IS NOT NULL
        AND original_duration_minutes IS NOT NULL)
      OR
      (entry_kind = 'manual_entry'
        AND worker_assignment_id IS NOT NULL
        AND original_started_at IS NULL
        AND original_ended_at IS NULL
        AND original_duration_minutes IS NULL
        AND (status NOT IN ('Approved', 'Recorded') OR work_session_id IS NOT NULL))
    );

ALTER TABLE approvals
  DROP CONSTRAINT approvals_status_check,
  ADD CONSTRAINT approvals_status_check
    CHECK (status IN ('Approved', 'Rejected', 'Closed', 'Verified', 'Closure Requested', 'Closure Returned'));

INSERT INTO notification_events (event_key, category, priority, description, is_critical, is_enabled)
SELECT 'job_card.closure_returned', 'Approvals', 'high', 'The Manager returned a Job Card closure request for correction.', true, true
WHERE NOT EXISTS (SELECT 1 FROM notification_events WHERE event_key = 'job_card.closure_returned');
