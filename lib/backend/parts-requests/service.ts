import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { assertActiveUser, assertBackendPermission } from "@/lib/backend/security/guards";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import {
  findPartsRequestForWorkflow,
  findWorkOrderForPartsRequest,
  updatePartsRequestStatus
} from "@/lib/backend/parts-requests/repository";
import { getActiveUserIdsByRoleSlugs } from "@/lib/backend/work-orders/repository";
import type {
  ApprovePartsRequestInput,
  CreatePartsRequestInput,
  RejectPartsRequestInput
} from "@/lib/backend/parts-requests/validators";
import { AppError } from "@/lib/errors/app-error";
import { canTransition, transitionError } from "@/lib/workflows/status-rules";

type PartsRequestResult = {
  partsRequestId: string;
  partsRequestNumber: string | null;
  status: string;
  workOrderId: string | null;
  requestedBy: string | null;
};

function assertCanCreatePartsRequest(context: CurrentUserContext) {
  assertActiveUser(context);
  if (context.role?.slug === "super_admin") return;
  if (context.permissions.includes("parts_requests.create")) return;
  if (context.permissions.includes("work_orders.manage")) return;
  throw new AppError("You do not have permission to create parts requests.", { code: "FORBIDDEN" });
}

export async function createPartsRequest(
  context: CurrentUserContext,
  input: CreatePartsRequestInput
): Promise<PartsRequestResult> {
  assertCanCreatePartsRequest(context);

  const inner = await withBackendTransaction(context.userId, async (tx) => {
    const workOrder = await findWorkOrderForPartsRequest(tx, input.workOrderId);
    if (!workOrder) {
      throw new AppError("Work order not found.", { code: "NOT_FOUND" });
    }

    const total = input.items.reduce(
      (sum, item) => sum + item.quantity_requested * item.unit_price,
      0
    );

    const request = await tx.parts_requests.create({
      data: {
        work_order_id: input.workOrderId,
        asset_id: workOrder.asset_id,
        department_id: workOrder.requested_by_department_id,
        serial_number: workOrder.serial_number,
        requested_by: context.userId,
        prepared_by: context.userId,
        remarks: input.remarks,
        status: "Pending Approval",
        total_price: total,
        created_by: context.userId,
        updated_by: context.userId
      },
      select: { id: true, parts_request_number: true, status: true, work_order_id: true }
    });

    if (input.items.length > 0) {
      await tx.parts_request_items.createMany({
        data: input.items.map((item) => ({
          parts_request_id: request.id,
          part_id: item.part_id,
          description: item.description,
          part_number: item.part_number,
          ss_rec_code: item.ss_rec_code,
          quantity_requested: item.quantity_requested,
          unit_price: item.unit_price,
          remarks: item.remarks
        }))
      });
    }

    const managers = await getActiveUserIdsByRoleSlugs(tx, ["super_admin", "maintenance_manager"]);

    return {
      partsRequestId: request.id,
      partsRequestNumber: request.parts_request_number,
      status: request.status,
      workOrderId: request.work_order_id,
      requestedBy: context.userId,
      managers
    };
  });

  const { managers, ...result } = inner;

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "parts_request.submitted",
      entityType: "parts_request",
      entityId: result.partsRequestId,
      actorId: context.userId,
      recipientUserIds: managers,
      title: "Parts request submitted",
      message: `${result.partsRequestNumber ?? "Parts request"} is waiting for approval.`,
      actionUrl: `/store/parts-requests/${result.partsRequestId}`,
      actionLabel: "Open parts request",
      metadata: { parts_request_number: result.partsRequestNumber }
    }),
    writeAuditLog({
      actorId: context.userId,
      action: "parts_request.create",
      entityType: "parts_request",
      entityId: result.partsRequestId,
      summary: `Created parts request ${result.partsRequestNumber ?? result.partsRequestId}`
    })
  ]);

  return result;
}

export async function approvePartsRequest(
  context: CurrentUserContext,
  input: ApprovePartsRequestInput
): Promise<PartsRequestResult> {
  assertBackendPermission(context, "parts_requests.approve");

  const inner = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findPartsRequestForWorkflow(tx, input.partsRequestId);
    if (!existing) {
      throw new AppError("Parts request not found.", { code: "NOT_FOUND" });
    }
    if (!canTransition("parts_request", existing.status, "Waiting for Store")) {
      throw new AppError(
        transitionError("parts_request", existing.status, "Waiting for Store"),
        { code: "WORKFLOW_ERROR" }
      );
    }

    const updated = await updatePartsRequestStatus(
      tx,
      input.partsRequestId,
      "Waiting for Store",
      context.userId,
      { approved_by: context.userId, approval_comments: input.comments ?? null }
    );

    await tx.approvals.create({
      data: {
        parts_request_id: input.partsRequestId,
        approval_type: "Parts Request",
        status: "Approved",
        decided_by: context.userId,
        comments: input.comments ?? null
      }
    });

    const storeUsers = await getActiveUserIdsByRoleSlugs(tx, ["super_admin", "store_keeper"]);

    return {
      partsRequestId: updated.id,
      partsRequestNumber: updated.parts_request_number,
      status: updated.status,
      workOrderId: existing.work_order_id,
      requestedBy: updated.requested_by,
      storeUsers
    };
  });

  const { storeUsers, ...result } = inner;

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "parts_request.approved",
      entityType: "parts_request",
      entityId: result.partsRequestId,
      actorId: context.userId,
      recipientUserIds: storeUsers,
      title: "Parts request approved",
      message: `${result.partsRequestNumber ?? "Parts request"} is waiting for store issue.`,
      actionUrl: `/store/parts-requests/${result.partsRequestId}`,
      actionLabel: "Open parts request",
      metadata: { parts_request_number: result.partsRequestNumber }
    }),
    writeAuditLog({
      actorId: context.userId,
      action: "parts_request.approve",
      entityType: "parts_request",
      entityId: result.partsRequestId,
      summary: `Approved ${result.partsRequestNumber ?? result.partsRequestId}`
    })
  ]);

  return result;
}

export async function rejectPartsRequest(
  context: CurrentUserContext,
  input: RejectPartsRequestInput
): Promise<PartsRequestResult> {
  assertBackendPermission(context, "parts_requests.approve");

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findPartsRequestForWorkflow(tx, input.partsRequestId);
    if (!existing) {
      throw new AppError("Parts request not found.", { code: "NOT_FOUND" });
    }
    if (!canTransition("parts_request", existing.status, "Rejected")) {
      throw new AppError(
        transitionError("parts_request", existing.status, "Rejected"),
        { code: "WORKFLOW_ERROR" }
      );
    }

    const updated = await updatePartsRequestStatus(
      tx,
      input.partsRequestId,
      "Rejected",
      context.userId,
      { approved_by: context.userId, approval_comments: input.comments ?? null }
    );

    return {
      partsRequestId: updated.id,
      partsRequestNumber: updated.parts_request_number,
      status: updated.status,
      workOrderId: existing.work_order_id,
      requestedBy: updated.requested_by
    };
  });

  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "parts_request.rejected",
      entityType: "parts_request",
      entityId: result.partsRequestId,
      actorId: context.userId,
      recipientUserIds: [result.requestedBy].filter((id): id is string => Boolean(id)),
      title: "Parts request rejected",
      message: `${result.partsRequestNumber ?? "Parts request"} was rejected.`,
      actionUrl: `/store/parts-requests/${result.partsRequestId}`,
      actionLabel: "Open parts request",
      metadata: { parts_request_number: result.partsRequestNumber }
    }),
    writeAuditLog({
      actorId: context.userId,
      action: "parts_request.reject",
      entityType: "parts_request",
      entityId: result.partsRequestId,
      summary: `Rejected ${result.partsRequestNumber ?? result.partsRequestId}`,
      metadata: { comments: input.comments }
    })
  ]);

  return result;
}
