import "server-only";

import { prisma } from "@/lib/db/prisma";

export type { SimplifiedStatus } from "@/lib/work-orders/simplified-status-display";
export {
  OPEN_JOB_CARD_STATUSES,
  ACTIVE_JOB_CARD_STATUSES,
  CLOSURE_REQUESTED_STATUS,
  displaySimplifiedStatus,
  simplifiedStatusTone,
  NEEDS_UPDATE_LABEL,
  NEEDS_UPDATE_TONE,
} from "@/lib/work-orders/simplified-status-display";

// Batched version of getPendingClarificationForWorkOrder (lib/backend/
// workflows/queries.ts) — same 4-table join (WorkflowInstance ->
// WorkflowStep(code="maintenance_manager_review") -> WorkflowStepInstance
// (status="clarification_requested") -> ClarificationRequest
// (status="pending")), but resolved for many work orders in one pass
// instead of one at a time, for dashboard/list pages. Mirrors the shape of
// getReviewedWorkOrderIds (lib/work-orders/review-status.ts).
export async function getPendingCorrectionWorkOrderIds(workOrderIds: string[]): Promise<Set<string>> {
  if (workOrderIds.length === 0) return new Set();

  const instances = await prisma.workflowInstance.findMany({
    where: { entity_type: "work_order", entity_id: { in: workOrderIds } },
    select: { id: true, entity_id: true, workflow_def_id: true },
  });
  if (instances.length === 0) return new Set();

  const defIds = [...new Set(instances.map((i) => i.workflow_def_id))];
  const reviewSteps = await prisma.workflowStep.findMany({
    where: { workflow_def_id: { in: defIds }, code: "maintenance_manager_review" },
    select: { id: true, workflow_def_id: true },
  });
  const stepIdsByDef = new Map(reviewSteps.map((s) => [s.workflow_def_id, s.id]));
  const stepIds = [...new Set(reviewSteps.map((s) => s.id))];
  if (stepIds.length === 0) return new Set();

  // Only instances whose def actually has a maintenance_manager_review step.
  const instancesWithReviewStep = instances.filter((i) => stepIdsByDef.has(i.workflow_def_id));
  const instanceIds = instancesWithReviewStep.map((i) => i.id);
  if (instanceIds.length === 0) return new Set();

  const stepInstances = await prisma.workflowStepInstance.findMany({
    where: { workflow_inst_id: { in: instanceIds }, step_id: { in: stepIds }, status: "clarification_requested" },
    select: { id: true, workflow_inst_id: true },
  });
  if (stepInstances.length === 0) return new Set();

  const stepInstIds = stepInstances.map((s) => s.id);
  const pendingClarifications = await prisma.clarificationRequest.findMany({
    where: { workflow_step_inst_id: { in: stepInstIds }, status: "pending" },
    select: { workflow_step_inst_id: true },
    distinct: ["workflow_step_inst_id"],
  });
  const pendingStepInstIds = new Set(pendingClarifications.map((c) => c.workflow_step_inst_id));

  const instanceIdToWorkOrderId = new Map(instancesWithReviewStep.map((i) => [i.id, i.entity_id]));
  const result = new Set<string>();
  for (const si of stepInstances) {
    if (!pendingStepInstIds.has(si.id)) continue;
    const workOrderId = instanceIdToWorkOrderId.get(si.workflow_inst_id);
    if (workOrderId) result.add(workOrderId);
  }
  return result;
}
