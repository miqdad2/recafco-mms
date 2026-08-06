-- Work Session Time Tracking and Labor Cost Calculation Unit 8.
--
-- Purely additive: one new table, FK'd to work_order_worker_assignments.id
-- (Unit 7) so each session inherits that assignment's frozen
-- hourly_rate_snapshot lineage rather than the worker profile's live rate.
-- No existing table is altered. No permission changes — reuses
-- work_orders.assign (session actions) / the existing Manager role check
-- (edit/correct), matching Unit 7's "reuse existing" precedent.

CREATE TABLE IF NOT EXISTS work_order_work_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id        UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  worker_assignment_id UUID NOT NULL REFERENCES work_order_worker_assignments(id),
  worker_id            UUID NOT NULL REFERENCES worker_profiles(id),
  started_at           TIMESTAMPTZ NOT NULL,
  paused_at            TIMESTAMPTZ,
  stopped_at           TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'Active',
  duration_minutes     INTEGER NOT NULL DEFAULT 0,
  hourly_rate_snapshot NUMERIC(12, 3) NOT NULL,
  calculated_amount    NUMERIC(12, 3) NOT NULL DEFAULT 0,
  is_manual_entry      BOOLEAN NOT NULL DEFAULT false,
  notes                TEXT,
  correction_reason    TEXT,
  entered_by           UUID REFERENCES profiles(id),
  edited_by             UUID REFERENCES profiles(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wows_work_order ON work_order_work_sessions (work_order_id);
CREATE INDEX IF NOT EXISTS idx_wows_assignment_status ON work_order_work_sessions (worker_assignment_id, status);
CREATE INDEX IF NOT EXISTS idx_wows_status ON work_order_work_sessions (status);
