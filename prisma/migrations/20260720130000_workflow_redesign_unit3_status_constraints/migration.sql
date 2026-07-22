-- Maintenance Workflow Redesign Unit 3 — simplified status CHECK constraints.
--
-- work_orders.status and parts_requests.status each currently carry TWO
-- overlapping CHECK constraints (chk_* plus a Prisma-introspected *_status_check),
-- and the two parts_requests ones do not even agree with each other (only one
-- of them allows 'Rejected'). Both constraints per table are dropped and
-- replaced with exactly one, reflecting the new simplified status model.
--
-- No column type change, no rename, no enum — status stays String, per the
-- locked design decision. No data backfill: local baseline has 0 work_orders
-- and 0 parts_requests at migration time (verified before this migration was
-- written). Production still has old-format rows and must NOT run this
-- migration until a backfill/mapping strategy is defined (see Unit 3 report).

ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS chk_work_orders_status;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_status_check;

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
    'Closed'
  ]));

ALTER TABLE work_orders ALTER COLUMN status SET DEFAULT 'Created';

ALTER TABLE parts_requests DROP CONSTRAINT IF EXISTS chk_parts_requests_status;
ALTER TABLE parts_requests DROP CONSTRAINT IF EXISTS parts_requests_status_check;

ALTER TABLE parts_requests
  ADD CONSTRAINT chk_parts_requests_status CHECK (status = ANY (ARRAY[
    'Requested',
    'Approved',
    'Waiting Stock',
    'Partially Issued',
    'Issued'
  ]));

ALTER TABLE parts_requests ALTER COLUMN status SET DEFAULT 'Requested';
