-- Phase 1 Batch 2: Database Integrity Constraints
-- Adds CHECK constraints for workflow status columns and links approvals to parts/purchase requests.
--
-- Safe to run multiple times: DROP CONSTRAINT IF EXISTS before each ADD CONSTRAINT.
-- Idempotent column additions use ADD COLUMN IF NOT EXISTS.
-- Pre-flight checks confirmed all existing work_order statuses are valid.
-- parts_requests and purchase_requests tables are empty, so no pre-migration cleanup needed.


-- ============================================================
-- 1. Extend the approvals table with entity foreign keys
-- ============================================================

ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS parts_request_id uuid REFERENCES public.parts_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_request_id uuid REFERENCES public.purchase_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_approvals_parts_request_id
  ON public.approvals(parts_request_id);

CREATE INDEX IF NOT EXISTS idx_approvals_purchase_request_id
  ON public.approvals(purchase_request_id);


-- ============================================================
-- 2. CHECK constraint: work_orders.status
--    Values match lib/workflows/status-rules.ts work_order transitions.
-- ============================================================

ALTER TABLE public.work_orders
  DROP CONSTRAINT IF EXISTS chk_work_orders_status;

ALTER TABLE public.work_orders
  ADD CONSTRAINT chk_work_orders_status
  CHECK (status IN (
    'Draft',
    'Submitted',
    'Pending Approval',
    'Approved',
    'Rejected',
    'Assigned',
    'In Progress',
    'Waiting for Parts',
    'Waiting for Purchase',
    'Parts Issued',
    'Completed by Technician',
    'Verified by Supervisor',
    'Confirmed by Requester',
    'Closed',
    'Reopened',
    'Cancelled'
  ));


-- ============================================================
-- 3. CHECK constraint: parts_requests.status
--    Values match lib/workflows/status-rules.ts parts_request transitions.
-- ============================================================

ALTER TABLE public.parts_requests
  DROP CONSTRAINT IF EXISTS chk_parts_requests_status;

ALTER TABLE public.parts_requests
  ADD CONSTRAINT chk_parts_requests_status
  CHECK (status IN (
    'Draft',
    'Submitted',
    'Pending Approval',
    'Approved',
    'Waiting for Store',
    'Partially Issued',
    'Issued',
    'Waiting for Purchase',
    'Rejected',
    'Closed',
    'Cancelled'
  ));


-- ============================================================
-- 4. CHECK constraint: purchase_requests.status
--    Values match lib/workflows/status-rules.ts purchase_request transitions.
-- ============================================================

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS chk_purchase_requests_status;

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT chk_purchase_requests_status
  CHECK (status IN (
    'Draft',
    'Submitted',
    'Pending Purchase',
    'Pending Finance Approval',
    'Pending CEO Approval',
    'Approved',
    'Ordered',
    'Received',
    'Rejected',
    'Cancelled'
  ));
