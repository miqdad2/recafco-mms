-- Approval Workflow Unit 4 — Closure Approval Only.
--
-- Business decision: there is no Manager approval before starting a Job
-- Card any more. Data Entry creates and starts a Job Card directly (backend
-- status goes straight to 'Approved', displayed as "Active" — see
-- lib/work-orders/simplified-status-display.ts). Manager approval is now
-- only required to CLOSE a Job Card: Data Entry requests closure, Manager
-- approves it (or closes directly).
--
-- Additive only: adds exactly one new allowed value ('Closure Requested') to
-- the existing CHECK constraint. No existing value is removed, no column
-- type change, no rename, no data backfill/rewrite — every existing row's
-- status value (however it maps under the new display rules) remains valid
-- and unchanged. 'Under Review' is kept in the allowed list for backward
-- compatibility with any pre-existing row still in that status (no new
-- record can reach it going forward — see submitWorkOrder() in
-- lib/backend/work-orders/service.ts, which now transitions straight to
-- 'Approved' instead).

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS chk_work_orders_status;

ALTER TABLE work_orders
  ADD CONSTRAINT chk_work_orders_status CHECK (status = ANY (ARRAY[
    'Created',
    'Under Review',
    'Approved',
    'Waiting Materials',
    'Partially Issued',
    'Materials Issued',
    'Assigned',
    'In Progress',
    'Closure Requested',
    'Closed'
  ]));
