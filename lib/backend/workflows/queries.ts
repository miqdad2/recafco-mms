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

/**
 * Returns the latest pending clarification request for a work order's
 * maintenance_manager_review step, or null if none exists (Phase 5-D3-C).
 *
 * Used by the work order detail page to show the manager's question and
 * the creator's response form. Returns null for old WOs, WOs with no
 * workflow instance, and WOs whose clarification has already been responded to.
 */
export async function getPendingClarificationForWorkOrder(workOrderId: string) {
  const instance = await prisma.workflowInstance.findFirst({
    where: { entity_type: "work_order", entity_id: workOrderId },
    select: { id: true, workflow_def_id: true }
  });
  if (!instance) return null;

  const reviewStep = await prisma.workflowStep.findFirst({
    where: { workflow_def_id: instance.workflow_def_id, code: "maintenance_manager_review" },
    select: { id: true }
  });
  if (!reviewStep) return null;

  const stepInst = await prisma.workflowStepInstance.findFirst({
    where: {
      workflow_inst_id: instance.id,
      step_id: reviewStep.id,
      status: "clarification_requested"
    },
    select: { id: true }
  });
  if (!stepInst) return null;

  return prisma.clarificationRequest.findFirst({
    where: { workflow_step_inst_id: stepInst.id, status: "pending" },
    select: {
      id: true,
      question: true,
      requested_by: true,
      requested_at: true,
      status: true,
      response: true,
      responded_at: true
    },
    orderBy: { created_at: "desc" }
  });
}

export type PendingClarification = NonNullable<Awaited<ReturnType<typeof getPendingClarificationForWorkOrder>>>;
