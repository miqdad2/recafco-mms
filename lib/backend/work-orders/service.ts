import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { assertActiveUser, assertBackendPermission } from "@/lib/backend/security/guards";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { advanceMaintenanceManagerReview, requestMaintenanceManagerClarification } from "@/lib/backend/workflows/engine";
import {
  findWorkflowWorkOrder,
  getActiveUserIdsByRoleSlugs,
  isTechnicianAssigned,
  updateWorkOrderStatus
} from "@/lib/backend/work-orders/repository";
import type { BackendTransaction } from "@/lib/backend/shared/transaction";
import type { TechnicianAssignmentInput, TechnicianUpdateInput } from "@/lib/backend/work-orders/validators";
import { writeAuditLog } from "@/lib/audit/log";
import { AppError } from "@/lib/errors/app-error";
import { canTransition, transitionError } from "@/lib/workflows/status-rules";

type WorkflowResult = {
  workOrderId: string;
  workOrderNumber: string | null;
  status: string;
};

async function transitionWorkOrder(context: CurrentUserContext, workOrderId: string, nextStatus: string) {
  assertActiveUser(context);

  return withBackendTransaction(context.userId, (tx) => transitionWorkOrderInTransaction(tx, context, workOrderId, nextStatus));
}

async function transitionWorkOrderInTransaction(tx: BackendTransaction, context: CurrentUserContext, workOrderId: string, nextStatus: string): Promise<WorkflowResult & { createdBy: string | null }> {
  const existing = await findWorkflowWorkOrder(tx, workOrderId);
  if (!existing) {
    throw new AppError("Work order was not found.", { code: "NOT_FOUND" });
  }

  if (!canTransition("work_order", existing.status, nextStatus)) {
    throw new AppError(transitionError("work_order", existing.status, nextStatus), { code: "WORKFLOW_ERROR" });
  }

  const row = existing.status === nextStatus ? existing : await updateWorkOrderStatus(tx, workOrderId, nextStatus, context.userId);

  return {
    workOrderId: row.id,
    workOrderNumber: row.work_order_number,
    status: row.status,
    createdBy: row.created_by
  };
}

async function auditWorkflow(context: CurrentUserContext, action: string, result: WorkflowResult, summary: string, metadata: Record<string, unknown> = {}) {
  await writeAuditLog({
    actorId: context.userId,
    action,
    entityType: "work_order",
    entityId: result.workOrderId,
    summary,
    metadata: { status: result.status, ...metadata }
  });
}

export async function submitWorkOrder(context: CurrentUserContext, workOrderId: string) {
  assertBackendPermission(context, "work_orders.manage");
  const result = await transitionWorkOrder(context, workOrderId, "Pending Approval");

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "work_order.submitted",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientRoles: ["super_admin", "maintenance_manager"],
      metadata: { work_order_number: result.workOrderNumber ?? "Work order" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`,
      actionLabel: "Review work order"
    }),
    auditWorkflow(context, "work_order.submit", result, `Submitted ${result.workOrderNumber ?? "work order"} for approval`)
  ]);

  return result;
}

export async function approveWorkOrder(context: CurrentUserContext, workOrderId: string, comments?: string) {
  assertBackendPermission(context, "work_orders.approve");
  const result = await transitionWorkOrder(context, workOrderId, "Approved");
  const supervisors = await withBackendTransaction(context.userId, async (tx) => {
    await tx.approvals.create({
      data: { work_order_id: result.workOrderId, status: "Approved", decided_by: context.userId, comments: comments || null }
    });
    try {
      await advanceMaintenanceManagerReview(tx, result.workOrderId, "approved", context.userId, comments);
    } catch (err) {
      console.error("[workflow] Tracking update failed on work order approve:", err);
    }
    return getActiveUserIdsByRoleSlugs(tx, ["super_admin", "maintenance_supervisor"]);
  });

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "work_order.approved",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: supervisors,
      metadata: { work_order_number: result.workOrderNumber ?? "Work order" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`,
      actionLabel: "Open work order"
    }),
    auditWorkflow(context, "work_order.approve", result, `Approved ${result.workOrderNumber ?? "work order"}`, { comments })
  ]);

  return result;
}

export async function rejectWorkOrder(context: CurrentUserContext, workOrderId: string, comments?: string) {
  assertBackendPermission(context, "work_orders.approve");
  const result = await transitionWorkOrder(context, workOrderId, "Rejected");

  await withBackendTransaction(context.userId, async (tx) => {
    await tx.approvals.create({
      data: { work_order_id: result.workOrderId, status: "Rejected", decided_by: context.userId, comments: comments || null }
    });
    try {
      await advanceMaintenanceManagerReview(tx, result.workOrderId, "rejected", context.userId, comments);
    } catch (err) {
      console.error("[workflow] Tracking update failed on work order reject:", err);
    }
  });

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "work_order.rejected",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: [result.createdBy, context.userId].filter((id): id is string => Boolean(id)),
      metadata: { work_order_number: result.workOrderNumber ?? "Work order" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`,
      actionLabel: "Open work order"
    }),
    auditWorkflow(context, "work_order.reject", result, `Rejected ${result.workOrderNumber ?? "work order"}`, { comments })
  ]);

  return result;
}

export async function requestWorkOrderClarification(context: CurrentUserContext, workOrderId: string, question: string) {
  assertBackendPermission(context, "work_orders.approve");

  if (question.trim().length < 10) {
    throw new AppError("Clarification question must be at least 10 characters.", { code: "VALIDATION_ERROR" });
  }

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findWorkflowWorkOrder(tx, workOrderId);
    if (!existing) {
      throw new AppError("Work order was not found.", { code: "NOT_FOUND" });
    }
    if (!["Submitted", "Pending Approval"].includes(existing.status)) {
      throw new AppError(
        `Clarification can only be requested on a Submitted or Pending Approval work order. Current status: "${existing.status}".`,
        { code: "WORKFLOW_ERROR" }
      );
    }

    await requestMaintenanceManagerClarification(tx, workOrderId, question.trim(), context.userId);

    return {
      workOrderId: existing.id,
      workOrderNumber: existing.work_order_number,
      status: existing.status,
      createdBy: existing.created_by
    };
  });

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "work_order.clarification_requested",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: [result.createdBy].filter((id): id is string => Boolean(id)),
      metadata: { work_order_number: result.workOrderNumber ?? "Work order", question: question.trim() },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`,
      actionLabel: "View work order"
    }),
    auditWorkflow(context, "work_order.clarification_requested", result, `Requested clarification on ${result.workOrderNumber ?? "work order"}`, { question: question.trim() })
  ]);

  return result;
}

export async function assignTechnicians(context: CurrentUserContext, input: TechnicianAssignmentInput) {
  assertBackendPermission(context, "work_orders.assign");

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findWorkflowWorkOrder(tx, input.workOrderId);
    if (!existing) throw new AppError("Work order was not found.", { code: "NOT_FOUND" });
    if (!canTransition("work_order", existing.status, "Assigned")) {
      throw new AppError(transitionError("work_order", existing.status, "Assigned"), { code: "WORKFLOW_ERROR" });
    }

    const technicians = await tx.profiles.findMany({
      where: { id: { in: input.technicianIds }, is_active: true },
      select: { id: true }
    });
    const technicianIds = technicians.map((technician) => technician.id);
    if (!technicianIds.length) {
      throw new AppError("Select at least one active technician.", { code: "VALIDATION_ERROR" });
    }

    await tx.work_order_assignments.deleteMany({ where: { work_order_id: input.workOrderId } });
    await tx.work_order_assignments.createMany({
      data: technicianIds.map((technicianId) => ({
        work_order_id: input.workOrderId,
        technician_id: technicianId,
        assigned_by: context.userId
      }))
    });
    const row = existing.status === "Assigned" ? existing : await updateWorkOrderStatus(tx, input.workOrderId, "Assigned", context.userId);

    return {
      workOrderId: row.id,
      workOrderNumber: row.work_order_number,
      status: row.status,
      technicianIds
    };
  });

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "work_order.assigned",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: result.technicianIds,
      metadata: { work_order_number: result.workOrderNumber ?? "Work order" },
      actionUrl: `/technician/jobs/${result.workOrderId}`,
      actionLabel: "Open job"
    }),
    auditWorkflow(context, "work_order.assign", result, `Assigned technicians to ${result.workOrderNumber ?? "work order"}`, { technicianIds: result.technicianIds })
  ]);

  return result;
}

export async function startTechnicianJob(context: CurrentUserContext, workOrderId: string) {
  assertBackendPermission(context, "technician.jobs.update");
  const result = await withBackendTransaction(context.userId, async (tx) => {
    if (!(await isTechnicianAssigned(tx, workOrderId, context.userId))) {
      throw new AppError("This job is not assigned to you.", { code: "FORBIDDEN" });
    }

    return transitionWorkOrderInTransaction(tx, context, workOrderId, "In Progress");
  });

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "technician.job_started",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientRoles: ["maintenance_manager", "maintenance_supervisor"],
      metadata: { work_order_number: result.workOrderNumber ?? "Work order" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    auditWorkflow(context, "work_order.start", result, `Started ${result.workOrderNumber ?? "work order"}`)
  ]);

  return result;
}

export async function addTechnicianUpdate(context: CurrentUserContext, input: TechnicianUpdateInput) {
  assertBackendPermission(context, "technician.jobs.update");

  const result = await withBackendTransaction(context.userId, async (tx) => {
    if (!(await isTechnicianAssigned(tx, input.workOrderId, context.userId))) {
      throw new AppError("This job is not assigned to you.", { code: "FORBIDDEN" });
    }

    const existing = await findWorkflowWorkOrder(tx, input.workOrderId);
    if (!existing) throw new AppError("Work order was not found.", { code: "NOT_FOUND" });
    if (!["Assigned", "In Progress", "Waiting for Parts", "Parts Issued"].includes(existing.status)) {
      throw new AppError("Technician updates are not allowed in the current work order status.", { code: "WORKFLOW_ERROR" });
    }

    await tx.work_order_technician_notes.create({
      data: {
        work_order_id: input.workOrderId,
        technician_id: context.userId,
        note: input.note,
        labor_hours: input.laborHours,
        photo_file_name: input.photoFileName || null,
        photo_file_path: input.photoFilePath || null
      }
    });

    if (input.laborHours > 0) {
      await tx.work_order_labor.create({
        data: {
          work_order_id: input.workOrderId,
          technician_id: context.userId,
          labor_name: context.profile.full_name,
          employee_number: context.profile.employee_number,
          hours: input.laborHours,
          rate: 0
        }
      });
    }

    if (input.photoFileName && input.photoFilePath) {
      await tx.work_order_attachments.create({
        data: {
          work_order_id: input.workOrderId,
          attachment_type: "Technician Photo",
          file_name: input.photoFileName,
          file_path: input.photoFilePath,
          uploaded_by: context.userId
        }
      });
    }

    return {
      workOrderId: existing.id,
      workOrderNumber: existing.work_order_number,
      status: existing.status,
      photoUploaded: Boolean(input.photoFileName && input.photoFilePath),
      laborHours: input.laborHours
    };
  });

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: result.laborHours > 0 ? "technician.labor_added" : "technician.note_added",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientRoles: ["maintenance_supervisor"],
      metadata: { labor_hours: result.laborHours },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`
    }),
    result.photoUploaded
      ? notifyWorkflowEvent({
          eventKey: "technician.photo_uploaded",
          entityType: "work_order",
          entityId: result.workOrderId,
          actorId: context.userId,
          recipientRoles: ["maintenance_supervisor"],
          metadata: { work_order_id: result.workOrderId },
          actionUrl: `/maintenance/work-orders/${result.workOrderId}`
        })
      : Promise.resolve(),
    auditWorkflow(context, "work_order.technician_update", result, "Added technician update to work order", { laborHours: result.laborHours })
  ]);

  return result;
}

export async function completeTechnicianJob(context: CurrentUserContext, workOrderId: string) {
  assertBackendPermission(context, "technician.jobs.update");
  const result = await withBackendTransaction(context.userId, async (tx) => {
    if (!(await isTechnicianAssigned(tx, workOrderId, context.userId))) {
      throw new AppError("This job is not assigned to you.", { code: "FORBIDDEN" });
    }

    return transitionWorkOrderInTransaction(tx, context, workOrderId, "Completed by Technician");
  });
  const supervisors = await withBackendTransaction(context.userId, (tx) => getActiveUserIdsByRoleSlugs(tx, ["super_admin", "maintenance_supervisor"]));

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "work_order.completed",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: supervisors,
      metadata: { work_order_number: result.workOrderNumber ?? "Work order" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`,
      actionLabel: "Verify work order"
    }),
    auditWorkflow(context, "work_order.complete", result, `Completed ${result.workOrderNumber ?? "work order"}`)
  ]);

  return result;
}

export async function verifyWorkOrder(context: CurrentUserContext, workOrderId: string, comments?: string) {
  assertBackendPermission(context, "work_orders.assign");
  const result = await transitionWorkOrder(context, workOrderId, "Verified by Supervisor");
  const managers = await withBackendTransaction(context.userId, async (tx) => {
    await tx.approvals.create({
      data: { work_order_id: result.workOrderId, status: "Verified", decided_by: context.userId, comments: comments || null }
    });
    return getActiveUserIdsByRoleSlugs(tx, ["super_admin", "maintenance_manager"]);
  });

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "work_order.verified",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: managers,
      metadata: { work_order_number: result.workOrderNumber ?? "Work order" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`,
      actionLabel: "Close work order"
    }),
    auditWorkflow(context, "work_order.verify", result, `Verified ${result.workOrderNumber ?? "work order"}`, { comments })
  ]);

  return result;
}

export async function closeWorkOrder(context: CurrentUserContext, workOrderId: string, comments?: string) {
  assertBackendPermission(context, "work_orders.approve");
  const result = await transitionWorkOrder(context, workOrderId, "Closed");

  await withBackendTransaction(context.userId, async (tx) => {
    await tx.approvals.create({
      data: { work_order_id: result.workOrderId, status: "Closed", decided_by: context.userId, comments: comments || null }
    });
  });

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "work_order.closed",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: [context.userId],
      metadata: { work_order_number: result.workOrderNumber ?? "Work order" },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`,
      actionLabel: "View work order"
    }),
    auditWorkflow(context, "work_order.close", result, `Closed ${result.workOrderNumber ?? "work order"}`, { comments })
  ]);

  return result;
}

// Allows the original submitter or an authorized manager to return a Rejected work order
// back to Draft so it can be revised and resubmitted. Status history is written automatically
// by the work_orders_status_change DB trigger when the UPDATE fires.
export async function returnWorkOrderToDraft(context: CurrentUserContext, workOrderId: string) {
  assertBackendPermission(context, "work_orders.manage");
  const result = await transitionWorkOrder(context, workOrderId, "Draft");
  await auditWorkflow(context, "work_order.return_to_draft", result, `Returned ${result.workOrderNumber ?? "work order"} to Draft for revision`);
  return result;
}
