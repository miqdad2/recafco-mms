import "server-only";

import type { BackendTransaction } from "@/lib/backend/shared/transaction";

/**
 * Creates workflow_instances and workflow_step_instances rows when a new
 * maintenance work order is submitted for approval (Phase 5-D1).
 *
 * Must be called inside a transaction that also creates the work_orders row
 * so both succeed or both fail atomically.
 *
 * Records two step instances:
 *   - draft_submission: status=completed (actor submitted it)
 *   - maintenance_manager_review: status=pending (awaiting approval)
 *
 * No approval advancement happens here. Approving the work order in a later
 * phase will advance current_step_id and add further step_instances.
 */
export async function createMaintenanceWorkflowInstanceForWorkOrder(
  tx: BackendTransaction,
  workOrderId: string,
  actorUserId: string
): Promise<void> {
  const def = await tx.workflowDefinition.findUnique({
    where: { code: "maintenance_work_order" },
    select: { id: true }
  });
  if (!def) {
    throw new Error("workflow_definition 'maintenance_work_order' not found — run Phase 5-D0 seed");
  }

  const [stepDraft, stepReview] = await Promise.all([
    tx.workflowStep.findFirst({
      where: { workflow_def_id: def.id, code: "draft_submission" },
      select: { id: true }
    }),
    tx.workflowStep.findFirst({
      where: { workflow_def_id: def.id, code: "maintenance_manager_review" },
      select: { id: true }
    })
  ]);
  if (!stepDraft) {
    throw new Error("workflow_step 'draft_submission' not found — run Phase 5-D0 seed");
  }
  if (!stepReview) {
    throw new Error("workflow_step 'maintenance_manager_review' not found — run Phase 5-D0 seed");
  }

  const now = new Date();

  const instance = await tx.workflowInstance.upsert({
    where: {
      entity_type_entity_id: {
        entity_type: "work_order",
        entity_id: workOrderId
      }
    },
    create: {
      workflow_def_id: def.id,
      entity_type: "work_order",
      entity_id: workOrderId,
      current_step_id: stepReview.id,
      status: "active",
      created_by: actorUserId
    },
    update: {
      current_step_id: stepReview.id,
      status: "active"
    },
    select: { id: true }
  });

  const [existingDraft, existingReview] = await Promise.all([
    tx.workflowStepInstance.findFirst({
      where: { workflow_inst_id: instance.id, step_id: stepDraft.id },
      select: { id: true }
    }),
    tx.workflowStepInstance.findFirst({
      where: { workflow_inst_id: instance.id, step_id: stepReview.id },
      select: { id: true }
    })
  ]);

  if (!existingDraft) {
    await tx.workflowStepInstance.create({
      data: {
        workflow_inst_id: instance.id,
        step_id: stepDraft.id,
        status: "completed",
        actor_id: actorUserId,
        decision: "submitted",
        started_at: now,
        completed_at: now
      }
    });
  }

  if (!existingReview) {
    await tx.workflowStepInstance.create({
      data: {
        workflow_inst_id: instance.id,
        step_id: stepReview.id,
        status: "pending",
        started_at: now
      }
    });
  }
}
