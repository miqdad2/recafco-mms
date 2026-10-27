-- Manual Worker Time Entry (Maintenance Data Entry, Manager approval).
--
-- Reuses work_session_time_corrections for one more kind of request:
--   entry_kind = 'correction'    — the existing flow: change one recorded
--                                   work period (work_session_id + original_*
--                                   required, exactly as before).
--   entry_kind = 'manual_entry'  — Data Entry enters a NEW work period for a
--                                   worker who did not use the timer. Until a
--                                   Manager approves it, it is only this row:
--                                   no work_order_work_sessions row exists, so
--                                   it cannot reach hours, cost or reports.
--                                   On approval one session row is created
--                                   (is_manual_entry = true) and linked back
--                                   through work_session_id.
--
-- Additive only: existing rows become entry_kind 'correction' and keep every
-- value; the NOT NULLs relaxed below stay enforced for corrections by the
-- shape check. No data is rewritten.

ALTER TABLE work_session_time_corrections
  ADD COLUMN entry_kind text NOT NULL DEFAULT 'correction',
  ADD COLUMN worker_assignment_id uuid REFERENCES work_order_worker_assignments(id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE work_session_time_corrections
  ALTER COLUMN work_session_id DROP NOT NULL,
  ALTER COLUMN original_started_at DROP NOT NULL,
  ALTER COLUMN original_ended_at DROP NOT NULL,
  ALTER COLUMN original_duration_minutes DROP NOT NULL;

ALTER TABLE work_session_time_corrections
  ADD CONSTRAINT work_session_time_corrections_kind_check
    CHECK (entry_kind IN ('correction', 'manual_entry')),
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
        -- an approved manual entry always points at the period it created
        AND (status <> 'Approved' OR work_session_id IS NOT NULL))
    );

CREATE INDEX idx_work_session_time_corrections_assignment_pending
  ON work_session_time_corrections (worker_assignment_id)
  WHERE status = 'Pending';
