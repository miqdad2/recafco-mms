-- Approval Workflow Unit 4 — Closure Approval Only (follow-up).
--
-- approvals.status has its own CHECK constraint (approvals_status_check),
-- separate from work_orders.status's — requestJobCardClosure() writes an
-- approvals row with status = 'Closure Requested' to record Data Entry's
-- closure request (decided_by/comments/decided_at), the same way every
-- other Job Card decision (Approved/Closed) already has its own approvals
-- row. Discovered via this unit's own verification script hitting the
-- existing constraint live — 'Closure Requested' was missing.
--
-- Additive only: adds exactly one new allowed value. No existing value
-- removed, no column/type change, no data rewrite.

ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_status_check;

ALTER TABLE approvals
  ADD CONSTRAINT approvals_status_check CHECK (status = ANY (ARRAY[
    'Approved',
    'Rejected',
    'Closed',
    'Verified',
    'Closure Requested'
  ]));
