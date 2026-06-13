import "server-only";

import type { BackendTransaction } from "@/lib/backend/shared/transaction";

/**
 * Advances the maintenance_manager_review step when the Maintenance Manager
 * approves or rejects a work order (Phase 5-D2).
 *
 * Called inside the existing approval/rejection transaction alongside the
 * approvals table write. Safe-skips for work orders that predate Phase 5-D1
 * (no workflow instance) and for any step that is not in "pending" status.
 *
 * On approval: marks the review step completed, creates the inventory_check
 * step instance (tracking-only — not used for routing yet), and advances
 * current_step_id on the instance.
 *
 * On rejection: marks the review step rejected. No next step is created.
 * The workflow_instance stays "active" so re-submission after returning to
 * Draft can continue tracking from the beginning.
 */
export async function advanceMaintenanceManagerReview(
  tx: BackendTransaction,
  workOrderId: string,
  decision: "approved" | "rejected",
  actorUserId: string,
  comments?: string
): Promise<void> {
  const instance = await tx.workflowInstance.findFirst({
    where: { entity_type: "work_order", entity_id: workOrderId },
    select: { id: true, workflow_def_id: true }
  });
  if (!instance) return; // pre-Phase 5-D1 work order — safe skip

  const reviewStep = await tx.workflowStep.findFirst({
    where: { workflow_def_id: instance.workflow_def_id, code: "maintenance_manager_review" },
    select: { id: true }
  });
  if (!reviewStep) return;

  const stepInst = await tx.workflowStepInstance.findFirst({
    where: { workflow_inst_id: instance.id, step_id: reviewStep.id, status: "pending" },
    select: { id: true }
  });
  if (!stepInst) return; // already processed or in unexpected state

  const now = new Date();

  await tx.workflowStepInstance.update({
    where: { id: stepInst.id },
    data: {
      status: decision === "approved" ? "completed" : "rejected",
      actor_id: actorUserId,
      decision,
      comments: comments ?? null,
      completed_at: now
    }
  });

  if (decision === "approved") {
    const nextStep = await tx.workflowStep.findFirst({
      where: { workflow_def_id: instance.workflow_def_id, code: "inventory_check" },
      select: { id: true }
    });
    if (nextStep) {
      const existingNext = await tx.workflowStepInstance.findFirst({
        where: { workflow_inst_id: instance.id, step_id: nextStep.id },
        select: { id: true }
      });
      if (!existingNext) {
        await tx.workflowStepInstance.create({
          data: {
            workflow_inst_id: instance.id,
            step_id: nextStep.id,
            status: "pending",
            started_at: now
          }
        });
      }
      await tx.workflowInstance.update({
        where: { id: instance.id },
        data: { current_step_id: nextStep.id }
      });
    }
    // If inventory_check step definition is not found (unexpected), leave current_step as-is.
  }
  // On rejection: no next step, instance remains "active" for potential resubmission.
}

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
