import "server-only";

import type { BackendTransaction } from "@/lib/backend/shared/transaction";
import { AppError } from "@/lib/errors/app-error";

// Job Card Deletion: a deleted (soft-deleted) Job Card is treated as not
// found by every workflow transition.
export async function findWorkflowWorkOrder(tx: BackendTransaction, id: string) {
  return tx.work_orders.findFirst({
    where: { id, deleted_at: null },
    select: {
      id: true,
      work_order_number: true,
      status: true,
      created_by: true,
      assets: { select: { asset_name: true } }
    }
  });
}

// Job Card Deletion: every write that adds work, stock or a request to a Job
// Card (timer start/manual entry, roster save, Materials Request, stock
// issue) and the Manager's deletion approval take this same per-Job-Card
// transaction lock first. Whichever commits first wins: an approval then
// sees the new activity and refuses, or the activity write then sees the
// Job Card is deleted and refuses. Callers take no other row lock on the Job
// Card before this one, so it cannot deadlock.
export async function lockJobCardActivity(tx: BackendTransaction, workOrderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`job-card-activity:${workOrderId}`}, 0))`;
}

export async function lockOpenJobCardForActivity(tx: BackendTransaction, workOrderId: string) {
  await lockJobCardActivity(tx, workOrderId);
  const wo = await tx.work_orders.findUnique({
    where: { id: workOrderId },
    select: { id: true, work_order_number: true, status: true, created_by: true, deleted_at: true },
  });
  if (!wo) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
  if (wo.deleted_at) throw new AppError("This Job Card has been deleted. No more work can be added to it.", { code: "WORKFLOW_ERROR" });
  return wo;
}

export async function updateWorkOrderStatus(tx: BackendTransaction, id: string, status: string, actorId: string) {
  return tx.work_orders.update({
    where: { id, deleted_at: null },
    data: {
      status,
      updated_by: actorId
    },
    select: {
      id: true,
      work_order_number: true,
      status: true,
      created_by: true
    }
  });
}

export async function getActiveUserIdsByRoleSlugs(tx: BackendTransaction, roleSlugs: string[]) {
  const profiles = await tx.profiles.findMany({
    where: { is_active: true },
    include: { roles: true }
  });

  return profiles.filter((profile) => profile.roles?.slug && roleSlugs.includes(profile.roles.slug)).map((profile) => profile.id);
}

export async function isTechnicianAssigned(tx: BackendTransaction, workOrderId: string, technicianId: string) {
  const assignment = await tx.work_order_assignments.findFirst({
    where: { work_order_id: workOrderId, technician_id: technicianId },
    select: { id: true }
  });

  return Boolean(assignment);
}
