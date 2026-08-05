-- Work Assignment and Worker Profiles Foundation Unit 7.
--
-- Purely additive: one new nullable column on the existing
-- work_order_assignments table, plus two brand-new tables. Nothing existing
-- is renamed, dropped, or made non-nullable. No permission changes — the new
-- worker-profile and internal-team-roster actions reuse the existing
-- work_orders.assign permission (already granted to Data Entry, Manager, and
-- Engineer), matching this unit's "reuse existing" preference.

-- 1. Freelancer / External Company "agreed amount or hourly rate optional".
ALTER TABLE work_order_assignments
  ADD COLUMN IF NOT EXISTS agreed_amount NUMERIC(12, 3);

-- 2. Worker profiles — maintenance labor roster (Supervisor / Technician /
--    Helper / Labor) that does not require a system login.
CREATE TABLE IF NOT EXISTS worker_profiles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  worker_type    TEXT NOT NULL,
  hourly_rate    NUMERIC(12, 3) NOT NULL DEFAULT 0,
  phone          TEXT,
  skill_category TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES profiles(id),
  updated_by     UUID REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_worker_profiles_is_active ON worker_profiles (is_active);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_worker_type ON worker_profiles (worker_type);

-- 3. Per-Job-Card internal labor roster, additive and separate from
--    work_order_assignments. hourly_rate_snapshot is copied from
--    worker_profiles.hourly_rate at assignment time and frozen thereafter.
--    status stays "active"/"removed" (soft delete) so a future work-session/
--    timer table can FK onto this table's id without losing history when a
--    roster is edited.
CREATE TABLE IF NOT EXISTS work_order_worker_assignments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id        UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  worker_id            UUID NOT NULL REFERENCES worker_profiles(id),
  worker_role          TEXT NOT NULL,
  hourly_rate_snapshot NUMERIC(12, 3) NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active',
  assigned_by          UUID REFERENCES profiles(id),
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wowa_work_order_status ON work_order_worker_assignments (work_order_id, status);
CREATE INDEX IF NOT EXISTS idx_wowa_worker_id ON work_order_worker_assignments (worker_id);
