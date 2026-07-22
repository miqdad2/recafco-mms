import "server-only";

import type { BackendTransaction } from "@/lib/backend/shared/transaction";
import { AppError } from "@/lib/errors/app-error";

// Materials Request statuses that still represent open, in-flight work
// against a Job Card (Maintenance Workflow Redesign Unit 3). "Issued" is
// terminal — a Job Card can have a new Materials Request created once its
// prior one reaches Issued, but never two open ones at once.
export const ACTIVE_MATERIALS_REQUEST_STATUSES = [
  "Requested",
  "Approved",
  "Waiting Stock",
  "Partially Issued"
] as const;

/**
 * Returns the existing active (non-Issued) Materials Request for a Job Card,
 * if one exists, or null. "Active" query only — does not throw.
 */
export async function getActiveMaterialsRequestForJobCard(
  tx: BackendTransaction,
  workOrderId: string
) {
  return tx.parts_requests.findFirst({
    where: {
      work_order_id: workOrderId,
      status: { in: [...ACTIVE_MATERIALS_REQUEST_STATUSES] }
    },
    select: { id: true, parts_request_number: true, status: true }
  });
}

/**
 * Throws a clear AppError if the Job Card already has an active Materials
 * Request, so callers can block a duplicate create before writing anything.
 */
export async function assertNoActiveDuplicateMaterialsRequest(
  tx: BackendTransaction,
  workOrderId: string
) {
  const existing = await getActiveMaterialsRequestForJobCard(tx, workOrderId);
  if (existing) {
    throw new AppError(
      "This Job Card already has an active Materials Request. Please update the existing request instead.",
      { code: "CONFLICT" }
    );
  }
}

export async function findPartsRequestForWorkflow(tx: BackendTransaction, id: string) {
  return tx.parts_requests.findUnique({
    where: { id },
    select: {
      id: true,
      parts_request_number: true,
      status: true,
      work_order_id: true,
      requested_by: true
    }
  });
}

type LockedPartsRequestRow = {
  id: string;
  status: string;
  work_order_id: string | null;
  parts_request_number: string | null;
  requested_by: string | null;
};

/**
 * Locks the parts_requests row with SELECT ... FOR UPDATE (Unit 5 — Task 7
 * race-condition safety). Must be called inside a transaction. Serializes
 * concurrent issueMaterials/markWaitingStock calls against the SAME request —
 * a second transaction attempting to lock the same row blocks until the first
 * commits or rolls back, so both never read the same stale issued_quantity.
 * Does NOT lock across different requests competing for the same ledger
 * balance — see Unit 5 report for that residual race and recommended fix.
 */
export async function lockPartsRequestForUpdate(tx: BackendTransaction, id: string) {
  const rows = await tx.$queryRaw<LockedPartsRequestRow[]>`
    SELECT id, status, work_order_id, parts_request_number, requested_by
    FROM public.parts_requests
    WHERE id = ${id}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function findWorkOrderForPartsRequest(tx: BackendTransaction, workOrderId: string) {
  return tx.work_orders.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      asset_id: true,
      requested_by_department_id: true,
      serial_number: true,
      work_order_number: true,
      created_by: true
    }
  });
}

/** Job Card number for a Materials Request notification message (Unit 6). */
export async function getJobCardNumber(tx: BackendTransaction, workOrderId: string | null | undefined): Promise<string | null> {
  if (!workOrderId) return null;
  const wo = await tx.work_orders.findUnique({ where: { id: workOrderId }, select: { work_order_number: true } });
  return wo?.work_order_number ?? null;
}

export async function updatePartsRequestStatus(
  tx: BackendTransaction,
  id: string,
  status: string,
  actorId: string,
  extra: { approved_by?: string | null; approval_comments?: string | null } = {}
) {
  return tx.parts_requests.update({
    where: { id },
    data: { status, updated_by: actorId, ...extra },
    select: {
      id: true,
      parts_request_number: true,
      status: true,
      requested_by: true
    }
  });
}
