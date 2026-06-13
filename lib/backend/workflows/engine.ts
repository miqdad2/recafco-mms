import "server-only";

import type { BackendTransaction } from "@/lib/backend/shared/transaction";

/**
 * Records a clarification request from the Maintenance Manager on the
 * maintenance_manager_review step (Phase 5-D3-B).
 *
 * Marks the step instance as "clarification_requested" and inserts a row
 * in clarification_requests. The work_orders.status is NOT changed — it
 * stays "Pending Approval". The Manager can still approve or reject after
 * the creator responds.
 *
 * Returns the clarification_requests.id, or null when no workflow instance
 * exists for this work order (old WOs — safe skip, no orphan rows created).
 *
 * Accepts step instances in "pending" or "clarification_requested" status so
 * follow-up clarification requests on the same step do not silently fail.
 */
export async function requestMaintenanceManagerClarification(
  tx: BackendTransaction,
  workOrderId: string,
  question: string,
  actorUserId: string
): Promise<string | null> {
  const instance = await tx.workflowInstance.findFirst({
    where: { entity_type: "work_order", entity_id: workOrderId },
    select: { id: true, workflow_def_id: true }
  });
  if (!instance) return null; // pre-Phase 5-D1 work order — safe skip

  const reviewStep = await tx.workflowStep.findFirst({
    where: { workflow_def_id: instance.workflow_def_id, code: "maintenance_manager_review" },
    select: { id: true }
  });
  if (!reviewStep) return null;

  const stepInst = await tx.workflowStepInstance.findFirst({
    where: {
      workflow_inst_id: instance.id,
      step_id: reviewStep.id,
      status: { in: ["pending", "clarification_requested"] }
    },
    select: { id: true }
  });
  if (!stepInst) return null; // step already completed/rejected

  const now = new Date();

  await tx.workflowStepInstance.update({
    where: { id: stepInst.id },
    data: {
      status: "clarification_requested",
      actor_id: actorUserId,
      decision: "clarification_requested",
      comments: question,
      completed_at: now
    }
  });

  const clarification = await tx.clarificationRequest.create({
    data: {
      workflow_step_inst_id: stepInst.id,
      question,
      requested_by: actorUserId,
      status: "pending"
    },
    select: { id: true }
  });

  return clarification.id;
}

/**
 * Records the creator's response to a pending clarification request on the
 * maintenance_manager_review step (Phase 5-D3-C).
 *
 * Marks the clarification_requests row as "responded" and resets the step
 * instance back to "pending" so the Maintenance Manager can approve or reject
 * normally. The work_orders.status is NOT changed — it stays "Pending Approval".
 *
 * Returns the clarification_requests.id that was updated, or null when no
 * pending clarification exists (old WOs or already responded — safe skip).
 */
export async function respondToMaintenanceManagerClarification(
  tx: BackendTransaction,
  workOrderId: string,
  response: string,
  actorUserId: string
): Promise<string | null> {
  const instance = await tx.workflowInstance.findFirst({
    where: { entity_type: "work_order", entity_id: workOrderId },
    select: { id: true, workflow_def_id: true }
  });
  if (!instance) return null; // pre-Phase 5-D1 work order — safe skip

  const reviewStep = await tx.workflowStep.findFirst({
    where: { workflow_def_id: instance.workflow_def_id, code: "maintenance_manager_review" },
    select: { id: true }
  });
  if (!reviewStep) return null;

  const stepInst = await tx.workflowStepInstance.findFirst({
    where: {
      workflow_inst_id: instance.id,
      step_id: reviewStep.id,
      status: "clarification_requested"
    },
    select: { id: true }
  });
  if (!stepInst) return null; // step is not in clarification_requested state — safe skip

  const clarification = await tx.clarificationRequest.findFirst({
    where: { workflow_step_inst_id: stepInst.id, status: "pending" },
    select: { id: true },
    orderBy: { created_at: "desc" }
  });
  if (!clarification) return null; // no pending clarification row — safe skip

  const now = new Date();

  await tx.clarificationRequest.update({
    where: { id: clarification.id },
    data: {
      status: "responded",
      response,
      responded_by: actorUserId,
      responded_at: now
    }
  });

  // Reset the review step to "pending" so the manager can approve/reject normally.
  // actor_id and decision are cleared; comments records that a response was received.
  await tx.workflowStepInstance.update({
    where: { id: stepInst.id },
    data: {
      status: "pending",
      actor_id: null,
      decision: null,
      comments: `Responded: ${response}`,
      completed_at: null
    }
  });

  // Ensure current_step_id points back to the review step.
  await tx.workflowInstance.update({
    where: { id: instance.id },
    data: { current_step_id: reviewStep.id }
  });

  return clarification.id;
}

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
