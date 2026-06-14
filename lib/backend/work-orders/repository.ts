import "server-only";

import type { BackendTransaction } from "@/lib/backend/shared/transaction";

export async function findWorkflowWorkOrder(tx: BackendTransaction, id: string) {
  return tx.work_orders.findUnique({
    where: { id },
    select: {
      id: true,
      work_order_number: true,
      status: true,
      created_by: true
    }
  });
}

export async function updateWorkOrderStatus(tx: BackendTransaction, id: string, status: string, actorId: string) {
  return tx.work_orders.update({
    where: { id },
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
