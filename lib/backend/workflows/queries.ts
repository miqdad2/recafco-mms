import "server-only";

import { prisma } from "@/lib/db/prisma";

export async function getWorkflowInstanceForWorkOrder(workOrderId: string) {
  return prisma.workflowInstance.findFirst({
    where: { entity_type: "work_order", entity_id: workOrderId },
    select: {
      id: true,
      status: true,
      started_at: true,
      workflow_definition: { select: { name: true, code: true } },
      current_step: { select: { code: true, name: true, step_order: true } },
      step_instances: {
        select: {
          id: true,
          status: true,
          actor_id: true,
          decision: true,
          comments: true,
          started_at: true,
          completed_at: true,
          workflow_step: { select: { code: true, name: true, step_order: true } }
        },
        orderBy: { created_at: "asc" }
      }
    }
  });
}

export type WorkflowTrackingData = NonNullable<Awaited<ReturnType<typeof getWorkflowInstanceForWorkOrder>>>;
