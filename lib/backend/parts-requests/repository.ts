import "server-only";

import type { BackendTransaction } from "@/lib/backend/shared/transaction";

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

export async function findWorkOrderForPartsRequest(tx: BackendTransaction, workOrderId: string) {
  return tx.work_orders.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      asset_id: true,
      requested_by_department_id: true,
      serial_number: true
    }
  });
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
