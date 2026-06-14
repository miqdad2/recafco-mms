import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { assertActiveUser, assertBackendPermission } from "@/lib/backend/security/guards";
import { type BackendTransaction, withBackendTransaction } from "@/lib/backend/shared/transaction";
import { getActiveUserIdsByRoleSlugs } from "@/lib/backend/work-orders/repository";
import type {
  CeoClarificationInput,
  CeoDecisionInput,
  CreatePurchaseFromPartsRequestInput,
  FinanceDecisionInput,
  ReceivePurchaseInput,
  UpdatePurchaseWorkflowInput
} from "@/lib/backend/purchase-requests/validators";
import { AppError } from "@/lib/errors/app-error";
import { canTransition, transitionError } from "@/lib/workflows/status-rules";

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

type PurchaseDecisionResult = {
  purchaseRequestId: string;
  purchaseRequestNumber: string | null;
  status: string;
  workOrderId: string | null;
  partsRequestId: string | null;
};

async function findDecisionPurchase(tx: BackendTransaction, id: string) {
  return tx.purchase_requests.findUnique({
    where: { id },
    select: {
      id: true,
      purchase_request_number: true,
      status: true,
      work_order_id: true,
      parts_request_id: true
    }
  });
}

async function decisionRecipients(tx: BackendTransaction) {
  return getActiveUserIdsByRoleSlugs(tx, ["super_admin", "purchase_officer", "finance_manager", "maintenance_manager"]);
}

async function auditPurchaseWorkflow(context: CurrentUserContext, action: string, result: PurchaseDecisionResult, summary: string, metadata: Record<string, unknown> = {}) {
  await writeAuditLog({
    actorId: context.userId,
    action,
    entityType: "purchase_request",
    entityId: result.purchaseRequestId,
    summary,
    metadata: {
      status: result.status,
      workOrderId: result.workOrderId,
      partsRequestId: result.partsRequestId,
      ...metadata
    }
  });
}

function labelFor(result: Pick<PurchaseDecisionResult, "purchaseRequestNumber">) {
  return result.purchaseRequestNumber ?? "Purchase request";
}

async function getPurchaseSettings(tx: BackendTransaction) {
  return tx.app_settings.findUnique({
    where: { id: SETTINGS_ID },
    select: {
      ceo_approval_enabled: true,
      finance_approval_enabled: true,
      ceo_approval_threshold: true
    }
  });
}

function nextPurchaseApprovalStatus(settings: Awaited<ReturnType<typeof getPurchaseSettings>>, total: number) {
  if (settings?.finance_approval_enabled) return "Pending Finance Approval";
  if (settings?.ceo_approval_enabled && total > Number(settings.ceo_approval_threshold ?? 0)) return "Pending CEO Approval";
  return "Pending Purchase";
}

function recipientsForPurchaseStatus(status: string) {
  if (status === "Pending Finance Approval") return ["super_admin", "finance_manager"];
  if (status === "Pending CEO Approval") return ["super_admin", "ceo_management"];
  return ["super_admin", "purchase_officer"];
}

export async function createPurchaseFromUnavailableParts(context: CurrentUserContext, input: CreatePurchaseFromPartsRequestInput) {
  assertActiveUser(context);
  assertBackendPermission(context, "purchase_requests.manage");

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const request = await tx.parts_requests.findUnique({
      where: { id: input.partsRequestId },
      include: {
        parts_request_items: {
          where: { stock_availability: "Unavailable" }
        }
      }
    });

    if (!request) {
      throw new AppError("Parts request was not found.", { code: "NOT_FOUND" });
    }
    if (!request.parts_request_items.length) {
      throw new AppError("No unavailable parts exist for this request.", { code: "WORKFLOW_ERROR" });
    }
    if (!["Waiting for Purchase", "Partially Issued"].includes(request.status)) {
      throw new AppError("Purchase request can be created only for parts waiting for purchase.", { code: "WORKFLOW_ERROR" });
    }

    const total = request.parts_request_items.reduce((sum, item) => sum + Number(item.quantity_requested) * Number(item.unit_price), 0);
    const settings = await getPurchaseSettings(tx);
    const status = nextPurchaseApprovalStatus(settings, total);
    if (!canTransition("purchase_request", "Draft", status)) {
      throw new AppError(transitionError("purchase_request", "Draft", status), { code: "WORKFLOW_ERROR" });
    }

    const purchase = await tx.purchase_requests.create({
      data: {
        work_order_id: request.work_order_id,
        parts_request_id: request.id,
        estimated_total: total,
        status,
        created_by: context.userId,
        updated_by: context.userId,
        purchase_request_items: {
          create: request.parts_request_items.map((item) => ({
            parts_request_item_id: item.id,
            part_id: item.part_id,
            description: item.description,
            quantity: item.quantity_requested,
            estimated_unit_price: item.unit_price
          }))
        }
      },
      select: {
        id: true,
        purchase_request_number: true,
        status: true,
        work_order_id: true,
        parts_request_id: true
      }
    });

    await tx.parts_requests.update({
      where: { id: request.id },
      data: { status: "Waiting for Purchase", updated_by: context.userId }
    });

    return {
      result: {
        purchaseRequestId: purchase.id,
        purchaseRequestNumber: purchase.purchase_request_number,
        status: purchase.status,
        workOrderId: purchase.work_order_id,
        partsRequestId: purchase.parts_request_id
      },
      recipients: await getActiveUserIdsByRoleSlugs(tx, recipientsForPurchaseStatus(status))
    };
  });

  const label = labelFor(result.result);
  await Promise.all([
    notifyWorkflowEvent({
      eventKey: result.result.status === "Pending Finance Approval" ? "purchase_request.pending_finance" : result.result.status === "Pending CEO Approval" ? "purchase_request.pending_ceo" : "purchase_request.created",
      entityType: "purchase_request",
      entityId: result.result.purchaseRequestId,
      actorId: context.userId,
      recipientUserIds: result.recipients,
      title: result.result.status === "Pending Finance Approval" ? "Finance approval required" : result.result.status === "Pending CEO Approval" ? "CEO approval required" : "Purchase request created",
      message: `${label} requires workflow action.`,
      actionUrl: `/purchase/requests/${result.result.purchaseRequestId}`,
      actionLabel: "Open purchase request",
      metadata: { purchase_request_number: label, status: result.result.status }
    }),
    auditPurchaseWorkflow(context, "purchase_request.create", result.result, `Created ${label}`, { status: result.result.status })
  ]);

  return result.result;
}

export async function updatePurchaseWorkflow(context: CurrentUserContext, input: UpdatePurchaseWorkflowInput) {
  assertActiveUser(context);
  assertBackendPermission(context, "purchase_requests.manage");

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findDecisionPurchase(tx, input.purchaseRequestId);
    if (!existing) {
      throw new AppError("Purchase request was not found.", { code: "NOT_FOUND" });
    }
    if (!canTransition("purchase_request", existing.status, input.status)) {
      throw new AppError(transitionError("purchase_request", existing.status, input.status), { code: "WORKFLOW_ERROR" });
    }

    const updated = await tx.purchase_requests.update({
      where: { id: input.purchaseRequestId },
      data: {
        supplier: input.supplier || null,
        status: input.status,
        purchase_officer_notes: input.purchaseOfficerNotes || null,
        quotation_file_name: input.quotationFileName || null,
        quotation_file_path: input.quotationFilePath || null,
        updated_by: context.userId
      },
      select: {
        id: true,
        purchase_request_number: true,
        status: true,
        work_order_id: true,
        parts_request_id: true
      }
    });

    return {
      result: {
        purchaseRequestId: updated.id,
        purchaseRequestNumber: updated.purchase_request_number,
        status: updated.status,
        workOrderId: updated.work_order_id,
        partsRequestId: updated.parts_request_id
      },
      recipients: input.status === "Ordered" ? await getActiveUserIdsByRoleSlugs(tx, ["super_admin", "store_keeper", "maintenance_supervisor"]) : []
    };
  });

  const label = labelFor(result.result);
  await Promise.all([
    result.recipients.length
      ? notifyWorkflowEvent({
          eventKey: "purchase_request.ordered",
          entityType: "purchase_request",
          entityId: result.result.purchaseRequestId,
          actorId: context.userId,
          recipientUserIds: result.recipients,
          title: "Purchase ordered",
          message: `${label} was marked as ordered.`,
          actionUrl: `/purchase/requests/${result.result.purchaseRequestId}`,
          actionLabel: "Open purchase request",
          metadata: { purchase_request_number: label }
        })
      : Promise.resolve(),
    auditPurchaseWorkflow(context, "purchase_request.update", result.result, `Updated ${label} to ${result.result.status}`)
  ]);

  return result.result;
}

export async function decidePurchaseAsFinance(context: CurrentUserContext, input: FinanceDecisionInput) {
  assertActiveUser(context);
  assertBackendPermission(context, "finance.approve");

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const purchase = await tx.purchase_requests.findUnique({
      where: { id: input.purchaseRequestId },
      select: {
        id: true,
        purchase_request_number: true,
        status: true,
        estimated_total: true,
        work_order_id: true,
        parts_request_id: true
      }
    });

    if (!purchase) {
      throw new AppError("Purchase request was not found.", { code: "NOT_FOUND" });
    }
    if (purchase.status !== "Pending Finance Approval") {
      throw new AppError("This purchase request is not waiting for finance approval.", { code: "WORKFLOW_ERROR" });
    }

    const settings = await getPurchaseSettings(tx);
    const nextStatus = input.decision === "Rejected" ? "Rejected" : settings?.ceo_approval_enabled && Number(purchase.estimated_total) > Number(settings.ceo_approval_threshold ?? 0) ? "Pending CEO Approval" : "Approved";
    if (!canTransition("purchase_request", purchase.status, nextStatus)) {
      throw new AppError(transitionError("purchase_request", purchase.status, nextStatus), { code: "WORKFLOW_ERROR" });
    }

    const updated = await tx.purchase_requests.update({
      where: { id: input.purchaseRequestId },
      data: {
        status: nextStatus,
        finance_comments: input.comments || null,
        finance_approved_by: context.userId,
        finance_approved_at: new Date(),
        updated_by: context.userId
      },
      select: {
        id: true,
        purchase_request_number: true,
        status: true,
        work_order_id: true,
        parts_request_id: true
      }
    });

    return {
      result: {
        purchaseRequestId: updated.id,
        purchaseRequestNumber: updated.purchase_request_number,
        status: updated.status,
        workOrderId: updated.work_order_id,
        partsRequestId: updated.parts_request_id
      },
      recipients: await getActiveUserIdsByRoleSlugs(tx, nextStatus === "Pending CEO Approval" ? ["super_admin", "ceo_management"] : ["super_admin", "purchase_officer"])
    };
  });

  const label = labelFor(result.result);
  await Promise.all([
    notifyWorkflowEvent({
      eventKey: result.result.status === "Pending CEO Approval" ? "purchase_request.pending_ceo" : input.decision === "Approved" ? "finance.approved" : "finance.rejected",
      entityType: "purchase_request",
      entityId: result.result.purchaseRequestId,
      actorId: context.userId,
      recipientUserIds: result.recipients,
      title: result.result.status === "Pending CEO Approval" ? "CEO approval required" : `Finance ${input.decision.toLowerCase()}`,
      message: `${label} finance decision: ${input.decision}.`,
      actionUrl: result.result.status === "Pending CEO Approval" ? "/ceo/approvals" : `/purchase/requests/${result.result.purchaseRequestId}`,
      actionLabel: result.result.status === "Pending CEO Approval" ? "Open CEO approvals" : "Open purchase request",
      metadata: { purchase_request_number: label, decision: input.decision, status: result.result.status }
    }),
    auditPurchaseWorkflow(context, `finance.${input.decision.toLowerCase()}`, result.result, `Finance ${input.decision.toLowerCase()} ${label}`, { comments: input.comments })
  ]);

  return result.result;
}

export async function decidePurchaseAsCeo(context: CurrentUserContext, input: CeoDecisionInput) {
  assertActiveUser(context);
  assertBackendPermission(context, "ceo.approve");

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findDecisionPurchase(tx, input.purchaseRequestId);
    if (!existing) {
      throw new AppError("Purchase request was not found.", { code: "NOT_FOUND" });
    }

    if (existing.status !== "Pending CEO Approval") {
      throw new AppError("This purchase request is not waiting for CEO approval.", { code: "WORKFLOW_ERROR" });
    }

    if (!canTransition("purchase_request", existing.status, input.decision)) {
      throw new AppError(transitionError("purchase_request", existing.status, input.decision), { code: "WORKFLOW_ERROR" });
    }

    const updated = await tx.purchase_requests.update({
      where: { id: input.purchaseRequestId },
      data: {
        status: input.decision,
        ceo_comments: input.comments || null,
        ceo_approved_by: context.userId,
        ceo_approved_at: new Date(),
        updated_by: context.userId
      },
      select: {
        id: true,
        purchase_request_number: true,
        status: true,
        work_order_id: true,
        parts_request_id: true
      }
    });

    return {
      result: {
        purchaseRequestId: updated.id,
        purchaseRequestNumber: updated.purchase_request_number,
        status: updated.status,
        workOrderId: updated.work_order_id,
        partsRequestId: updated.parts_request_id
      },
      recipients: await decisionRecipients(tx)
    };
  });

  const label = labelFor(result.result);
  await Promise.all([
    notifyWorkflowEvent({
      eventKey: input.decision === "Approved" ? "ceo.approved" : "ceo.rejected",
      entityType: "purchase_request",
      entityId: result.result.purchaseRequestId,
      actorId: context.userId,
      recipientUserIds: result.recipients,
      title: input.decision === "Approved" ? "CEO approved purchase request" : "CEO rejected purchase request",
      message: `${label} CEO decision: ${input.decision}.`,
      actionUrl: `/purchase/requests/${result.result.purchaseRequestId}`,
      actionLabel: "Open purchase request",
      metadata: { purchase_request_number: label, decision: input.decision }
    }),
    auditPurchaseWorkflow(context, `ceo.${input.decision.toLowerCase()}`, result.result, `CEO ${input.decision.toLowerCase()} ${label}`, { comments: input.comments })
  ]);

  return result.result;
}

export async function requestCeoClarification(context: CurrentUserContext, input: CeoClarificationInput) {
  assertActiveUser(context);
  assertBackendPermission(context, "ceo.approve");

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await findDecisionPurchase(tx, input.purchaseRequestId);
    if (!existing) {
      throw new AppError("Purchase request was not found.", { code: "NOT_FOUND" });
    }

    if (existing.status !== "Pending CEO Approval") {
      throw new AppError("Clarification can be requested only while the request is waiting for CEO approval.", { code: "WORKFLOW_ERROR" });
    }

    const updated = await tx.purchase_requests.update({
      where: { id: input.purchaseRequestId },
      data: {
        ceo_comments: input.comments,
        updated_by: context.userId
      },
      select: {
        id: true,
        purchase_request_number: true,
        status: true,
        work_order_id: true,
        parts_request_id: true
      }
    });

    return {
      result: {
        purchaseRequestId: updated.id,
        purchaseRequestNumber: updated.purchase_request_number,
        status: updated.status,
        workOrderId: updated.work_order_id,
        partsRequestId: updated.parts_request_id
      },
      recipients: await decisionRecipients(tx)
    };
  });

  const label = labelFor(result.result);
  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "ceo.clarification_requested",
      entityType: "purchase_request",
      entityId: result.result.purchaseRequestId,
      actorId: context.userId,
      recipientUserIds: result.recipients,
      title: "CEO requested clarification",
      message: `${label} needs clarification before CEO decision.`,
      actionUrl: `/purchase/requests/${result.result.purchaseRequestId}`,
      actionLabel: "Open purchase request",
      metadata: { purchase_request_number: label }
    }),
    auditPurchaseWorkflow(context, "ceo.clarification_requested", result.result, `CEO requested clarification for ${label}`, { comments: input.comments })
  ]);

  return result.result;
}

export async function receivePurchaseIntoInventory(context: CurrentUserContext, input: ReceivePurchaseInput) {
  assertActiveUser(context);
  assertBackendPermission(context, "purchase_requests.manage");

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const purchase = await tx.purchase_requests.findUnique({
      where: { id: input.purchaseRequestId },
      include: {
        purchase_request_items: true,
        work_orders: {
          select: {
            id: true,
            status: true
          }
        }
      }
    });

    if (!purchase) {
      throw new AppError("Purchase request was not found.", { code: "NOT_FOUND" });
    }
    if (!canTransition("purchase_request", purchase.status, "Received")) {
      throw new AppError(transitionError("purchase_request", purchase.status, "Received"), { code: "WORKFLOW_ERROR" });
    }

    for (const item of purchase.purchase_request_items) {
      if (!item.part_id) continue;

      await tx.parts.update({
        where: { id: item.part_id },
        data: {
          current_stock: { increment: item.quantity },
          updated_by: context.userId
        }
      });

      await tx.inventory_movements.create({
        data: {
          part_id: item.part_id,
          movement_type: "Purchase Receive",
          quantity: item.quantity,
          unit_price: item.estimated_unit_price,
          purchase_request_id: purchase.id,
          parts_request_id: purchase.parts_request_id,
          work_order_id: purchase.work_order_id,
          reference: purchase.purchase_request_number,
          comments: "Purchase received",
          created_by: context.userId
        }
      });
    }

    const updated = await tx.purchase_requests.update({
      where: { id: purchase.id },
      data: {
        status: "Received",
        updated_by: context.userId
      },
      select: {
        id: true,
        purchase_request_number: true,
        status: true,
        work_order_id: true,
        parts_request_id: true
      }
    });

    if (purchase.work_orders && canTransition("work_order", purchase.work_orders.status, "Parts Issued")) {
      await tx.work_orders.update({
        where: { id: purchase.work_orders.id },
        data: {
          status: "Parts Issued",
          updated_by: context.userId
        }
      });
    }

    return {
      result: {
        purchaseRequestId: updated.id,
        purchaseRequestNumber: updated.purchase_request_number,
        status: updated.status,
        workOrderId: updated.work_order_id,
        partsRequestId: updated.parts_request_id
      },
      recipients: await getActiveUserIdsByRoleSlugs(tx, ["super_admin", "store_keeper", "maintenance_supervisor"])
    };
  });

  const label = labelFor(result.result);
  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "purchase_request.received",
      entityType: "purchase_request",
      entityId: result.result.purchaseRequestId,
      actorId: context.userId,
      recipientUserIds: result.recipients,
      title: "Purchase received",
      message: `${label} was received and inventory was updated.`,
      actionUrl: `/purchase/requests/${result.result.purchaseRequestId}`,
      actionLabel: "Open purchase request",
      metadata: { purchase_request_number: label }
    }),
    auditPurchaseWorkflow(context, "purchase.receive", result.result, `Received ${label}`)
  ]);

  return result.result;
}
