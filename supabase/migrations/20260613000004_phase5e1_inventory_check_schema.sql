-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5-E1: Inventory Check Schema Foundation
--
-- Adds the minimum schema support for a future inventory check workflow step.
-- Additive only — no existing tables altered destructively.
-- No workflow behavior is activated. inventory_check_enabled defaults false,
-- so all existing assignment and approval flows remain unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. app_settings: feature flag ───────────────────────────────────────────
-- Defaults false so all existing behavior (Approved → Assigned direct) is
-- preserved until an admin explicitly enables the inventory check workflow.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS inventory_check_enabled boolean NOT NULL DEFAULT false;

-- ─── 2. work_order_required_parts: Store Keeper confirmation fields ───────────
-- availability_status: tracks whether Store Keeper has confirmed availability.
--   Values: unchecked (default) | available | partial | unavailable
-- confirmed_by / confirmed_at: audit trail for who confirmed and when.
ALTER TABLE work_order_required_parts
  ADD COLUMN IF NOT EXISTS availability_status text        NOT NULL DEFAULT 'unchecked',
  ADD COLUMN IF NOT EXISTS confirmed_by        uuid        NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at        timestamptz NULL;

-- ─── 3. FK: confirmed_by → profiles(id) ──────────────────────────────────────
-- Named to match Prisma's generated convention: {table}_{field}_fkey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'work_order_required_parts_confirmed_by_fkey'
       AND table_name      = 'work_order_required_parts'
  ) THEN
    ALTER TABLE work_order_required_parts
      ADD CONSTRAINT work_order_required_parts_confirmed_by_fkey
      FOREIGN KEY (confirmed_by)
      REFERENCES profiles(id)
      ON UPDATE NO ACTION
      ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 4. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_work_order_required_parts_availability
  ON work_order_required_parts(availability_status);

CREATE INDEX IF NOT EXISTS idx_work_order_required_parts_confirmed_by
  ON work_order_required_parts(confirmed_by);
