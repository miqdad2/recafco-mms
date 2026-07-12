-- Phase Workflow-03: Assignment Type Support (Internal / Freelancer / External Company)
-- Adds external assignment tracking fields to work_order_assignments.
-- All new columns are nullable (or have a safe default) so existing records are unaffected.

ALTER TABLE "work_order_assignments"
  ADD COLUMN IF NOT EXISTS "assignment_type"              TEXT NOT NULL DEFAULT 'INTERNAL_TECHNICIAN',
  ADD COLUMN IF NOT EXISTS "external_name"                TEXT,
  ADD COLUMN IF NOT EXISTS "external_company"             TEXT,
  ADD COLUMN IF NOT EXISTS "external_contact_person"      TEXT,
  ADD COLUMN IF NOT EXISTS "external_phone"               TEXT,
  ADD COLUMN IF NOT EXISTS "external_trade"               TEXT,
  ADD COLUMN IF NOT EXISTS "external_expected_visit_date" DATE;
