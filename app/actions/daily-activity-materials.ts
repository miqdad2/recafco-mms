"use server";

import { requirePermission, requireUser } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { revalidatePath } from "next/cache";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { getMaterialFulfillmentForWorkOrder, type MaterialFulfillment } from "@/lib/work-orders/material-fulfillment";
import { canManageOfflineInventory } from "@/lib/store/offline-inventory-data";
import { canReceiveIssueMaterials } from "@/lib/parts-requests/visibility";
import type { StoreSendMaterialsData } from "@/components/store/store-send-materials-popup";
import { processJobCardMaterials, type ProcessJobCardMaterialsResult } from "@/lib/backend/work-orders/material-processing";
import { AppError } from "@/lib/errors/app-error";
import { emitJobCardRealtimeEvent, emitOfflineInventoryRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";

// Daily Activity Inline Materials Receive/Issue Modal Unit 10D.
//
// One read-only fetch, called by the client-side Issue Material / Receive
// Materials modals (Pattern B — same "modal fetches its own data on open"
// shape as getWorkerActivityDetailAction from Unit 10C) — the Daily Activity
// board only ever passes a workOrderId down; the modals load everything else
// themselves so the server page doesn't have to eagerly fetch full
// fulfillment/Materials-Request detail for every one of up to 50 Job Cards
// just in case one gets clicked.
//
// getWorkOrderVisibilityFilter is applied here (mandatory invariant) even
// though the workOrderId always comes from a Job Card the Daily Activity
// page already rendered for this same user — a direct client call with an
// arbitrary id must not be able to read a Job Card outside that scope.

export type JobCardMaterialsModalData = {
  workOrderId: string;
  workOrderNumber: string | null;
  workOrderStatus: string;
  assetLabel: string | null;
  canIssue: boolean;
  canReceive: boolean;
  fulfillment: MaterialFulfillment[];
  // The one active (Requested/Approved/Waiting Stock/Partially Issued)
  // Materials Request linked to this Job Card, if any — same "active
  // request" definition Daily Activity's own page.tsx already uses. null
  // means there is nothing open to receive against right now.
  activeRequest: StoreSendMaterialsData | null;
};

const ACTIVE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];

export async function getJobCardMaterialsModalDataAction(workOrderId: string): Promise<JobCardMaterialsModalData | null> {
  const context = await requirePermission("work_orders.view");
  const visibilityFilter = getWorkOrderVisibilityFilter(context);

  const wo = await prisma.work_orders.findFirst({
    where: { id: workOrderId, deleted_at: null, AND: [visibilityFilter] },
    select: {
      id: true,
      work_order_number: true,
      status: true,
      operator_complaint: true,
      description_of_work: true,
      assets: { select: { asset_name: true, plate_number: true } },
      parts_requests: {
        where: { status: { in: ACTIVE_MATERIALS_REQUEST_STATUSES } },
        orderBy: { created_at: "desc" },
        take: 1,
        select: {
          id: true,
          parts_request_number: true,
          status: true,
          parts_request_items: {
            select: { id: true, description: true, part_id: true, quantity_requested: true, issued_quantity: true },
          },
        },
      },
    },
  });
  if (!wo) return null;

  const fulfillment = await getMaterialFulfillmentForWorkOrder(prisma, workOrderId);
  const activeRequestRow = wo.parts_requests[0] ?? null;

  // Unit 10G.14, Task 6 (the confirmed root cause of "both materials need to
  // be received" when only one actually does): a Materials Request's own
  // line items are copied 1:1 from Required Materials at Job Card creation
  // (app/actions/maintenance.ts's auto-create), regardless of whether
  // Offline Inventory already has enough stock for that line — so this list
  // used to be shown completely unfiltered here. Cross-reference each item
  // against the same fulfillment rows the rest of Daily Activity already
  // uses (matched by part_id when the item is a catalog part, else by
  // description — the same identity convention material-fulfillment.ts's
  // own identityFilterFor already uses) and only keep items whose remaining
  // requirement isn't already fully covered by current stock. An item with
  // no fulfillment match at all (e.g. a Materials Request created outside
  // the Required Materials flow) is kept — conservative default, same as
  // before this fix for that edge case.
  function findFulfillment(item: { part_id: string | null; description: string }) {
    if (item.part_id) return fulfillment.find((f) => f.part_id === item.part_id) ?? null;
    return fulfillment.find((f) => !f.part_id && f.description.toLowerCase() === item.description.toLowerCase()) ?? null;
  }
  const receivableItems = (activeRequestRow?.parts_request_items ?? []).filter((item) => {
    const match = findFulfillment(item);
    if (!match) return true;
    return match.status === "partial_available" || match.status === "needs_receiving";
  });

  return {
    workOrderId: wo.id,
    workOrderNumber: wo.work_order_number,
    workOrderStatus: wo.status,
    assetLabel: wo.assets ? `${wo.assets.asset_name}${wo.assets.plate_number ? ` (${wo.assets.plate_number})` : ""}` : null,
    canIssue: canManageOfflineInventory(context),
    canReceive: canReceiveIssueMaterials(context),
    fulfillment,
    // null when there's an active request but every one of its lines is
    // already ready_to_issue/fulfilled — "nothing left that needs
    // receiving" reads the same as "no active request" to the Receive
    // Materials modal (Task 3: never show Receive Materials once stock is
    // already available to issue).
    activeRequest:
      activeRequestRow && receivableItems.length > 0
        ? {
            id: activeRequestRow.id,
            parts_request_number: activeRequestRow.parts_request_number,
            status: activeRequestRow.status,
            work_order_id: wo.id,
            work_order_number: wo.work_order_number,
            work_order_status: wo.status,
            problem_summary: wo.operator_complaint || wo.description_of_work || null,
            asset_name: wo.assets?.asset_name ?? null,
            plate_number: wo.assets?.plate_number ?? null,
            items: receivableItems.map((item) => ({
              id: item.id,
              description: item.description,
              quantity_requested: Number(item.quantity_requested),
              issued_quantity: Number(item.issued_quantity),
              // Task 6 — the matched fulfillment row's current Offline
              // Inventory balance, so the popup can default "Quantity
              // received now" to the actual shortage (remaining - already
              // available) instead of the full remaining requirement.
              balance: findFulfillment(item)?.available_now,
            })),
          }
        : null,
  };
}

// Unified Material Processing Flow Unit 10G.23.
//
// Thin "use server" wrapper (same convention as every other action in this
// file/app/actions/offline-inventory.ts): resolves the real auth context and
// calls the plain, independently-importable service function that does the
// actual work (lib/backend/work-orders/material-processing.ts) — kept
// separate so that function stays testable without a request context, the
// same split issueMaterials()/storeIssueModalAction already use.
export type ProcessMaterialsActionState = { ok: true; result: ProcessJobCardMaterialsResult } | { ok: false; error: string } | null;

export async function processJobCardMaterialsAction(workOrderId: string): Promise<ProcessMaterialsActionState> {
  const context = await requireUser();
  try {
    const result = await processJobCardMaterials(context, workOrderId);

    await Promise.all([
      emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_UPDATED, workOrderId, context.userId),
      emitOfflineInventoryRealtimeEvent(REALTIME_EVENTS.OFFLINE_INVENTORY_USED, null, context.userId),
    ]);
    revalidatePath("/maintenance/daily-activity");
    revalidatePath(`/maintenance/work-orders/${workOrderId}`);
    revalidatePath("/store/offline-inventory");
    revalidatePath("/store/offline-inventory/movements");

    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : "Failed to process materials for this Job Card." };
  }
}
