import "server-only";

import type { Prisma } from "@prisma/client";

import type { CurrentUserContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/app-error";
import { withBackendTransaction, type BackendTransaction } from "@/lib/backend/shared/transaction";
import { syncPartsRequestStatusAfterFullIssueInTx } from "@/lib/backend/parts-requests/service";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { getMaterialFulfillmentForWorkOrder } from "@/lib/work-orders/material-fulfillment";
import { buildBalanceKey, canManageOfflineInventory } from "@/lib/store/offline-inventory-data";
import { normalizeCategory } from "@/components/store/offline-inventory-types";
import { canReceiveIssueMaterials } from "@/lib/parts-requests/visibility";

// Unified Material Processing Flow Unit 10G.23.
//
// Replaces Daily Activity's "Issue Available -> Receive Materials -> Issue
// Available again" two-step dance with one action: for every required-
// materials line that isn't fully issued yet, receive whatever shortage
// exists (skipped entirely when nothing is short), then issue the full
// remaining requirement. Writes directly against work_order_required_parts
// + offline_inventory_movements — the same tables/conventions
// getMaterialFulfillmentForWorkOrder and issueOfflineMaterialAction already
// use — deliberately bypassing the parts_request_items table for the writes
// themselves (unlike the old per-item Receive Materials modal) so the real
// required unit (work_order_required_parts.unit_of_measure) is always used
// directly, not the hardcoded-"PCS" fallback Unit 10G.14 had to work around
// on that older path. No second inventory system, no new movement_type, no
// bypassed history: every quantity that moves is still one real RECEIVED or
// ISSUED offline_inventory_movements row, exactly like every other
// Receive/Issue surface in this app already writes.

function assertCanProcessMaterials(context: CurrentUserContext) {
  // Both existing gates, not a new permission — Task 12 explicitly forbids
  // adding a new broad permission. Process Materials does both a receive and
  // an issue, so it requires whichever of the two existing checks a given
  // role's grant is missing to fail loudly rather than silently skip a step.
  if (!canManageOfflineInventory(context)) {
    throw new AppError("You do not have permission to issue materials for this Job Card.", { code: "FORBIDDEN" });
  }
  if (!canReceiveIssueMaterials(context)) {
    throw new AppError("You do not have permission to receive materials for this Job Card.", { code: "FORBIDDEN" });
  }
}

export type ProcessJobCardMaterialsResult = {
  workOrderId: string;
  workOrderNumber: string | null;
  receivedCount: number;
  issuedCount: number;
  skippedCount: number;
  message: string;
};

function buildResultMessage(receivedCount: number, issuedCount: number): string {
  if (receivedCount === 0 && issuedCount === 0) return "No remaining materials to process.";
  const parts: string[] = [];
  if (receivedCount > 0) parts.push(`received ${receivedCount} item${receivedCount === 1 ? "" : "s"}`);
  if (issuedCount > 0) parts.push(`issued ${issuedCount} item${issuedCount === 1 ? "" : "s"}`);
  // Task 4's own example: "Materials processed successfully. Received 1 item
  // and issued 2 items." — capitalize only the first clause.
  const body = parts.join(" and ");
  return `Materials processed successfully. ${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
}

async function resolveCurrentBalanceAndIssuedInTx(
  tx: BackendTransaction,
  line: { part_id: string | null; description: string; unit: string },
  workOrderId: string
): Promise<{ available: number; issuedToThisJobCard: number }> {
  const where: Prisma.offline_inventory_movementsWhereInput = line.part_id
    ? { part_id: line.part_id, deleted_at: null }
    : {
        part_id: null,
        manual_material_name: { equals: line.description, mode: "insensitive" },
        unit: { equals: line.unit, mode: "insensitive" },
        deleted_at: null,
      };
  const movements = await tx.offline_inventory_movements.findMany({
    where,
    select: { movement_type: true, quantity: true, related_work_order_id: true },
  });
  let available = 0;
  let issuedToThisJobCard = 0;
  for (const m of movements) {
    const q = Number(m.quantity);
    if (m.movement_type === "RECEIVED" || m.movement_type === "OPENING_STOCK") available += q;
    else if (m.movement_type === "ISSUED") {
      available -= q;
      if (m.related_work_order_id === workOrderId) issuedToThisJobCard += q;
    }
  }
  return { available, issuedToThisJobCard };
}

export async function processJobCardMaterials(
  context: CurrentUserContext,
  workOrderId: string
): Promise<ProcessJobCardMaterialsResult> {
  assertCanProcessMaterials(context);
  const visibilityFilter = getWorkOrderVisibilityFilter(context);

  const inner = await withBackendTransaction(context.userId, async (tx) => {
    const wo = await tx.work_orders.findFirst({
      where: { id: workOrderId, deleted_at: null, AND: [visibilityFilter] },
      select: { id: true, work_order_number: true, status: true },
    });
    if (!wo) throw new AppError("Job Card not found.", { code: "NOT_FOUND" });
    if (wo.status === "Closed") {
      throw new AppError("This Job Card is closed. Materials can no longer be processed.", { code: "WORKFLOW_ERROR" });
    }

    // Task 1/2/3 — a first, un-locked read decides which lines even need a
    // trip through the lock below; Task 6 re-derives the real remaining/
    // available numbers for each such line INSIDE its own advisory lock
    // right before writing, so a concurrent click/tab/direct Offline
    // Inventory action can never be double-counted.
    const fulfillment = await getMaterialFulfillmentForWorkOrder(tx, workOrderId);
    const alreadyDone = fulfillment.length - fulfillment.filter((f) => f.remaining_qty > 1e-9).length;
    const candidates = fulfillment.filter((f) => f.remaining_qty > 1e-9);

    if (candidates.length === 0) {
      return { workOrderNumber: wo.work_order_number, receivedCount: 0, issuedCount: 0, skippedCount: fulfillment.length };
    }

    const counterparty = `Job Card ${wo.work_order_number ?? workOrderId}`;
    let receivedCount = 0;
    let issuedCount = 0;
    let raceSkipped = 0;

    // Sequential (not Promise.all) — required materials rows rarely exceed a
    // handful per Job Card (the wizard caps at 8), and processing one
    // identity's lock at a time keeps this trivially easy to reason about
    // and matches issueOfflineMaterialAction's own one-movement-at-a-time
    // locking convention.
    for (const line of candidates) {
      const lockKey = buildBalanceKey({ part_id: line.part_id, manual_material_name: line.part_id ? null : line.description, unit: line.unit });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

      const { available, issuedToThisJobCard } = await resolveCurrentBalanceAndIssuedInTx(tx, line, workOrderId);
      const remainingNow = Math.max(line.required_qty - issuedToThisJobCard, 0);
      if (remainingNow <= 1e-9) {
        // Task 6 — already fully issued since the outer snapshot (another
        // click/tab/action beat this one to it) — skip, don't double-issue.
        raceSkipped += 1;
        continue;
      }

      let availableNow = available;
      const shortageNow = Math.max(remainingNow - availableNow, 0);

      if (shortageNow > 1e-9) {
        // Unit 10G.14 note carried forward: unit comes directly from this
        // required-parts row (line.unit), never a parts_request_items
        // fallback — the exact bug that unit fixed for the older receive
        // path never applies here because this path never reads
        // parts_request_items' own (nonexistent) unit column at all.
        await tx.offline_inventory_movements.create({
          data: {
            movement_type: "RECEIVED",
            movement_date: new Date(),
            part_id: line.part_id,
            manual_material_name: line.part_id ? null : line.description,
            manual_part_number: line.part_id ? null : line.part_number,
            category: normalizeCategory(null),
            quantity: shortageNow,
            unit: line.unit,
            counterparty,
            purpose: `Process Materials — required for ${wo.work_order_number ?? workOrderId}`,
            related_work_order_id: workOrderId,
            created_by: context.userId,
          },
        });
        availableNow += shortageNow;
        receivedCount += 1;
      }

      // Task 8 — after any needed receive, availableNow >= remainingNow
      // always holds, so issueQty is just remainingNow; min() kept anyway as
      // a defensive floor rather than trusting that invariant blindly.
      const issueQty = Math.min(remainingNow, availableNow);
      if (issueQty > 1e-9) {
        await tx.offline_inventory_movements.create({
          data: {
            movement_type: "ISSUED",
            movement_date: new Date(),
            part_id: line.part_id,
            manual_material_name: line.part_id ? null : line.description,
            manual_part_number: line.part_id ? null : line.part_number,
            category: normalizeCategory(null),
            quantity: issueQty,
            unit: line.unit,
            counterparty,
            purpose: `Required material for ${wo.work_order_number ?? workOrderId}`,
            related_work_order_id: workOrderId,
            created_by: context.userId,
          },
        });
        issuedCount += 1;
      }
    }

    // Keeps the linked Materials Request's own status (and the Job Card's
    // legacy status field) honest — the exact same helper
    // issueOfflineMaterialAction already calls after a direct Offline
    // Inventory issue, reused verbatim rather than reimplemented. A no-op
    // when there's nothing linked or materials aren't fully done yet.
    if (receivedCount > 0 || issuedCount > 0) {
      await syncPartsRequestStatusAfterFullIssueInTx(tx, context, workOrderId);
    }

    return {
      workOrderNumber: wo.work_order_number,
      receivedCount,
      issuedCount,
      skippedCount: alreadyDone + raceSkipped,
    };
  });

  return {
    workOrderId,
    workOrderNumber: inner.workOrderNumber,
    receivedCount: inner.receivedCount,
    issuedCount: inner.issuedCount,
    skippedCount: inner.skippedCount,
    message: buildResultMessage(inner.receivedCount, inner.issuedCount),
  };
}
