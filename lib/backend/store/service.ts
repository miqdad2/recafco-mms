import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { assertBackendPermission } from "@/lib/backend/security/guards";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { advanceInventoryCheckStep } from "@/lib/backend/workflows/engine";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors/app-error";
import { canTransition } from "@/lib/workflows/status-rules";

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

async function getInventoryCheckEnabled(): Promise<boolean> {
  const settings = await prisma.app_settings
    .findUnique({ where: { id: SETTINGS_ID }, select: { inventory_check_enabled: true } })
    .catch(() => null);
  return settings?.inventory_check_enabled ?? false;
}

export type RequiredPartAvailabilityStatus = "available" | "partial" | "unavailable";

/**
 * Store Keeper confirms the availability of a single required part row
 * (Phase 5-E3). Feature-flagged by app_settings.inventory_check_enabled.
 *
 * Updates availability_status, confirmed_by, confirmed_at, and optional notes.
 * Does NOT deduct stock, create inventory_movements, or create parts_requests.
 * Does NOT change work_orders.status.
 *
 * When all required parts for the WO are confirmed (none remain "unchecked"),
 * advances the inventory_check workflow step to "completed" (tracking-only).
 */
export async function confirmRequiredPartAvailability(
  context: CurrentUserContext,
  requiredPartId: string,
  availabilityStatus: RequiredPartAvailabilityStatus,
  notes: string | null
): Promise<{ workOrderId: string }> {
  assertBackendPermission(context, "store.issue");

  const enabled = await getInventoryCheckEnabled();
  if (!enabled) {
    throw new AppError("Inventory check workflow is not active.", { code: "WORKFLOW_ERROR" });
  }

  const { workOrderId, workOrderNumber, description, allPartsChecked, wasUnchecked, supervisorId } =
    await withBackendTransaction(context.userId, async (tx) => {
      const reqPart = await tx.workOrderRequiredPart.findUnique({
        where: { id: requiredPartId },
        select: {
          id: true,
          work_order_id: true,
          description: true,
          availability_status: true,
          work_orders: { select: { status: true, work_order_number: true, assigned_supervisor_id: true } }
        }
      });

      if (!reqPart) throw new AppError("Required part not found.", { code: "NOT_FOUND" });
      if (reqPart.work_orders.status !== "Approved") {
        throw new AppError(
          `Work order is not in Approved status (current: ${reqPart.work_orders.status}).`,
          { code: "WORKFLOW_ERROR" }
        );
      }

      // Capture "before" state for duplicate-notification prevention in E4-D.
      const wasUnchecked = reqPart.availability_status === "unchecked";

      await tx.workOrderRequiredPart.update({
        where: { id: requiredPartId },
        data: {
          availability_status: availabilityStatus,
          confirmed_by: context.userId,
          confirmed_at: new Date(),
          notes: notes ?? null
        }
      });

      const uncheckedCount = await tx.workOrderRequiredPart.count({
        where: { work_order_id: reqPart.work_order_id, availability_status: "unchecked" }
      });

      if (uncheckedCount === 0) {
        await advanceInventoryCheckStep(tx, reqPart.work_order_id, context.userId);
      }

      return {
        workOrderId: reqPart.work_order_id,
        workOrderNumber: reqPart.work_orders.work_order_number,
        description: reqPart.description,
        allPartsChecked: uncheckedCount === 0,
        wasUnchecked,
        supervisorId: reqPart.work_orders.assigned_supervisor_id ?? null
      };
    });

  await writeAuditLog({
    actorId: context.userId,
    action: "work_order.required_part_checked",
    entityType: "work_order_required_part",
    entityId: requiredPartId,
    summary: `Store Keeper confirmed availability of "${description}": ${availabilityStatus}`,
    metadata: { workOrderId, workOrderNumber, availabilityStatus, allPartsChecked }
  });

  // E4-D: notify assigners when ALL required parts are confirmed for the first time
  // (i.e. this confirmation cleared the last "unchecked" row).
  // wasUnchecked guards against repeat notifications when the user later edits a
  // partial/unavailable part — that change cannot trigger a second "ready" alert.
  if (allPartsChecked && wasUnchecked) {
    await notifyWorkflowEvent({
      eventKey: "work_order.inventory_check_completed",
      entityType: "work_order",
      entityId: workOrderId,
      actorId: context.userId,
      recipientUserIds: supervisorId ? [supervisorId] : [],
      recipientRoles: ["maintenance_manager", "maintenance_supervisor"],
      title: `Inventory check complete — ${workOrderNumber ?? "work order"}`,
      message: "All required parts have been confirmed. The work order is ready for technician assignment.",
      actionUrl: "/maintenance/assignments",
      actionLabel: "Open assignments",
      metadata: { work_order_number: workOrderNumber ?? "" }
    });
  }

  return { workOrderId };
}

export type StoreIssueItem = {
  itemId: string;
  partId: string | null;
  description: string;
  partNumber: string | null;
  ssRecCode: string | null;
  quantityRequested: number;
  unitPrice: number;
  issuedQuantity: number;
  isUnavailable: boolean;
};

export type StoreIssueInput = {
  partsRequestId: string;
  items: StoreIssueItem[];
  storeIssueComments: string | null;
};

type StoreIssueResult = {
  partsRequestId: string;
  partsRequestNumber: string | null;
  status: string;
  workOrderId: string | null;
  requestedBy: string | null;
};

const ISSUABLE_STATUSES = ["Waiting for Store", "Partially Issued", "Waiting for Purchase"];

export async function issuePartsToRequest(
  context: CurrentUserContext,
  input: StoreIssueInput
): Promise<StoreIssueResult> {
  assertBackendPermission(context, "store.issue");

  const inner = await withBackendTransaction(context.userId, async (tx) => {
    const request = await tx.parts_requests.findUnique({
      where: { id: input.partsRequestId },
      select: {
        id: true,
        parts_request_number: true,
        status: true,
        work_order_id: true,
        requested_by: true
      }
    });

    if (!request) {
      throw new AppError("Parts request not found.", { code: "NOT_FOUND" });
    }
    if (!ISSUABLE_STATUSES.includes(request.status)) {
      throw new AppError("Parts request is not in a valid status for store issue.", { code: "WORKFLOW_ERROR" });
    }

    let anyIssued = false;
    let anyUnavailable = false;
    let allIssued = true;

    for (const item of input.items) {
      const issued = item.issuedQuantity;
      const unavailable = item.isUnavailable;
      const availability = unavailable
        ? "Unavailable"
        : issued >= item.quantityRequested
          ? "Available"
          : issued > 0
            ? "Partial"
            : "Unchecked";

      if (issued > 0 && item.partId) {
        anyIssued = true;

        // Atomic conditional UPDATE: deducts only if stock >= issued.
        // Inside the transaction so a failed deduction rolls back all prior item changes,
        // preventing partial inventory deduction across the item set.
        const rowsUpdated = await tx.$executeRaw`
          UPDATE public.parts
          SET current_stock = current_stock - ${issued},
              updated_by = ${context.userId},
              updated_at = now()
          WHERE id = ${item.partId}::uuid
            AND current_stock >= ${issued}
        `;

        if (rowsUpdated === 0) {
          throw new AppError(
            `Insufficient stock for: ${item.description}`,
            { code: "WORKFLOW_ERROR" }
          );
        }

        await tx.inventory_movements.create({
          data: {
            part_id: item.partId,
            movement_type: "Issue to Work Order",
            quantity: issued,
            unit_price: item.unitPrice,
            work_order_id: request.work_order_id,
            parts_request_id: input.partsRequestId,
            reference: request.parts_request_number,
            comments: "Store issue",
            created_by: context.userId
          }
        });

        await tx.work_order_materials.create({
          data: {
            work_order_id: request.work_order_id,
            part_id: item.partId,
            material_name: item.description,
            part_number: item.partNumber,
            ss_rec_code: item.ssRecCode,
            quantity: issued,
            unit_price: item.unitPrice
          }
        });
      }

      if (unavailable) anyUnavailable = true;
      if (issued < item.quantityRequested) allIssued = false;

      await tx.parts_request_items.update({
        where: { id: item.itemId },
        data: { issued_quantity: issued, stock_availability: availability }
      });
    }

    const nextStatus = anyUnavailable
      ? "Waiting for Purchase"
      : allIssued
        ? "Issued"
        : anyIssued
          ? "Partially Issued"
          : "Waiting for Store";

    if (!canTransition("parts_request", request.status, nextStatus)) {
      throw new AppError(
        `Cannot move parts request from ${request.status} to ${nextStatus}.`,
        { code: "WORKFLOW_ERROR" }
      );
    }

    await tx.parts_requests.update({
      where: { id: input.partsRequestId },
      data: {
        status: nextStatus,
        store_issue_comments: input.storeIssueComments,
        updated_by: context.userId
      }
    });

    // Preserve original behaviour: unconditional work order status push (no canTransition guard).
    if (request.work_order_id) {
      if (anyUnavailable) {
        await tx.work_orders.update({
          where: { id: request.work_order_id },
          data: { status: "Waiting for Purchase", updated_by: context.userId }
        });
      } else if (anyIssued) {
        await tx.work_orders.update({
          where: { id: request.work_order_id },
          data: { status: "Parts Issued", updated_by: context.userId }
        });
      }
    }

    return {
      partsRequestId: input.partsRequestId,
      partsRequestNumber: request.parts_request_number,
      status: nextStatus,
      workOrderId: request.work_order_id,
      requestedBy: request.requested_by,
      nextStatus
    };
  });

  const { nextStatus, ...result } = inner;

  const notifEventKey =
    nextStatus === "Issued"
      ? "parts_request.issued"
      : nextStatus === "Partially Issued"
        ? "parts_request.partially_issued"
        : nextStatus === "Waiting for Purchase"
          ? "parts_request.unavailable"
          : null;

  const notifTitle =
    nextStatus === "Issued"
      ? "Parts issued"
      : nextStatus === "Partially Issued"
        ? "Parts partially issued"
        : nextStatus === "Waiting for Purchase"
          ? "Part unavailable"
          : null;

  await Promise.all([
    notifEventKey && result.requestedBy
      ? notifyWorkflowEvent({
          eventKey: notifEventKey,
          entityType: "parts_request",
          entityId: result.partsRequestId,
          actorId: context.userId,
          recipientUserIds: [result.requestedBy],
          title: notifTitle ?? notifEventKey,
          message: `${result.partsRequestNumber ?? "Parts request"} store status: ${nextStatus}.`,
          actionUrl: `/store/parts-requests/${result.partsRequestId}`,
          actionLabel: "Open parts request",
          metadata: { status: nextStatus }
        })
      : Promise.resolve(),
    writeAuditLog({
      actorId: context.userId,
      action: "store.issue",
      entityType: "parts_request",
      entityId: result.partsRequestId,
      summary: `Store updated ${result.partsRequestNumber ?? result.partsRequestId}`,
      metadata: { nextStatus }
    })
  ]);

  return result;
}
