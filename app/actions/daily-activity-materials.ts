"use server";

import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { getMaterialFulfillmentForWorkOrder, type MaterialFulfillment } from "@/lib/work-orders/material-fulfillment";
import { canManageOfflineInventory } from "@/lib/store/offline-inventory-data";
import { canReceiveIssueMaterials } from "@/lib/parts-requests/visibility";
import type { StoreSendMaterialsData } from "@/components/store/store-send-materials-popup";

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
            select: { id: true, description: true, quantity_requested: true, issued_quantity: true },
          },
        },
      },
    },
  });
  if (!wo) return null;

  const fulfillment = await getMaterialFulfillmentForWorkOrder(prisma, workOrderId);
  const activeRequestRow = wo.parts_requests[0] ?? null;

  return {
    workOrderId: wo.id,
    workOrderNumber: wo.work_order_number,
    workOrderStatus: wo.status,
    assetLabel: wo.assets ? `${wo.assets.asset_name}${wo.assets.plate_number ? ` (${wo.assets.plate_number})` : ""}` : null,
    canIssue: canManageOfflineInventory(context),
    canReceive: canReceiveIssueMaterials(context),
    fulfillment,
    activeRequest: activeRequestRow
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
          items: activeRequestRow.parts_request_items.map((item) => ({
            id: item.id,
            description: item.description,
            quantity_requested: Number(item.quantity_requested),
            issued_quantity: Number(item.issued_quantity),
            balance: undefined,
          })),
        }
      : null,
  };
}
