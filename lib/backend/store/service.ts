import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { assertBackendPermission } from "@/lib/backend/security/guards";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { advanceInventoryCheckStep } from "@/lib/backend/workflows/engine";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors/app-error";

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

// Disabled (Unit 5) — this parts-catalog pipeline (parts.current_stock,
// inventory_movements) is dead in practice: the parts catalog has 0 rows
// (spare parts removed), and this function wrote now-invalid statuses
// ("Waiting for Purchase", "Parts Issued") with no canTransition guard on the
// linked work order. The Offline Inventory Control ledger
// (offline_inventory_movements) is now the sole active material-issue
// pipeline — see issueMaterials in lib/backend/parts-requests/service.ts.
// Kept as a named export (rather than deleted) so any existing caller gets a
// clear, safe error instead of a broken/removed-function build failure.
export async function issuePartsToRequest(
  _context: CurrentUserContext,
  _input: StoreIssueInput
): Promise<StoreIssueResult> {
  throw new AppError("This action is no longer used in the simplified workflow.", { code: "WORKFLOW_ERROR" });
}
