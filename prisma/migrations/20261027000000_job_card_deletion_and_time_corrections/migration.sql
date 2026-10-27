-- Job Card Deletion Requests and Worker Time Corrections.
--
-- 1. job_card_deletion_requests — Maintenance Data Entry asks to delete a
--    Job Card; the Maintenance Manager approves or rejects. Approval is a
--    soft delete (work_orders.deleted_at, a column that already exists and
--    that the lists, dashboards and detail pages already filter on). The
--    Job Card row, its number and every linked record stay in the database.
--    One pending request per Job Card (partial unique index). Foreign keys
--    are RESTRICT so history can never be removed by a cascade.
--
-- 2. work_session_time_corrections — Data Entry proposes corrected start/end
--    times for one finished work period (a work_order_work_sessions row);
--    the Manager approves or rejects. Until approval nothing changes in the
--    session row, so every labor-hour and cost total keeps using the
--    recorded time. On approval the session row takes the corrected values
--    (every existing total reads that row, so the change is counted once,
--    everywhere) and the original system values are kept in the three new
--    nullable original_* columns below plus in the correction row itself.
--    One pending correction per work period (partial unique index).
--
-- Additive only: two new tables, three new nullable columns, no existing row
-- is changed, no backfill.

CREATE TABLE job_card_deletion_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id      uuid NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  -- Snapshots taken when the request was sent, so the request stays readable
  -- even after the Job Card is hidden.
  work_order_number  text,
  asset_label        text,
  status_at_request  text NOT NULL,
  reason             text NOT NULL,
  status             text NOT NULL DEFAULT 'Pending',
  requested_by       uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  decided_by         uuid REFERENCES profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  decided_at         timestamptz,
  decision_remarks   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_card_deletion_requests_status_check CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  CONSTRAINT job_card_deletion_requests_reason_not_blank CHECK (btrim(reason) <> '')
);

CREATE UNIQUE INDEX uq_job_card_deletion_requests_one_pending
  ON job_card_deletion_requests (work_order_id) WHERE status = 'Pending';
CREATE INDEX idx_job_card_deletion_requests_work_order
  ON job_card_deletion_requests (work_order_id, requested_at DESC);
CREATE INDEX idx_job_card_deletion_requests_status
  ON job_card_deletion_requests (status, requested_at DESC);

ALTER TABLE work_order_work_sessions
  ADD COLUMN original_started_at       timestamptz,
  ADD COLUMN original_ended_at         timestamptz,
  ADD COLUMN original_duration_minutes integer;

CREATE TABLE work_session_time_corrections (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_session_id             uuid NOT NULL REFERENCES work_order_work_sessions(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  work_order_id               uuid NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  worker_id                   uuid NOT NULL REFERENCES worker_profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  -- The work period's values when the request was sent.
  original_started_at         timestamptz NOT NULL,
  original_ended_at           timestamptz NOT NULL,
  original_duration_minutes   integer NOT NULL,
  corrected_started_at        timestamptz NOT NULL,
  corrected_ended_at          timestamptz NOT NULL,
  corrected_duration_minutes  integer NOT NULL,
  reason                      text NOT NULL,
  status                      text NOT NULL DEFAULT 'Pending',
  requested_by                uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  requested_at                timestamptz NOT NULL DEFAULT now(),
  reviewed_by                 uuid REFERENCES profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  reviewed_at                 timestamptz,
  review_remarks              text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_session_time_corrections_status_check CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  CONSTRAINT work_session_time_corrections_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT work_session_time_corrections_corrected_order CHECK (corrected_ended_at > corrected_started_at)
);

CREATE UNIQUE INDEX uq_work_session_time_corrections_one_pending
  ON work_session_time_corrections (work_session_id) WHERE status = 'Pending';
CREATE INDEX idx_work_session_time_corrections_work_order
  ON work_session_time_corrections (work_order_id, requested_at DESC);
CREATE INDEX idx_work_session_time_corrections_status
  ON work_session_time_corrections (status);
