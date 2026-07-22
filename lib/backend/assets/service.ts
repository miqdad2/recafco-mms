import "server-only";

import { prisma } from "@/lib/db/prisma";

const TERMINAL_STATUSES = new Set(["Closed", "Cancelled", "Rejected"]);

// ─── Exported types ───────────────────────────────────────────────────────────

export type AssetWorkOrderRow = {
  id: string;
  work_order_number: string | null;
  status: string;
  maintenance_type: string;
  worker_type: string;
  priority: string;
  date_of_order: string;
  ending_datetime: string | null;
  operator_complaint: string | null;
  total_work_order_cost: string | null;
  /** Names of assigned technicians (up to 3). Empty when unassigned. */
  technician_names: string[];
};

export type AssetTechnicianRow = {
  id: string;
  full_name: string;
  job_title: string | null;
  lastAssigned: string;
};

// A Materials Request line requested for this asset through a linked Job
// Card — assets.id -> work_orders.asset_id -> parts_requests.work_order_id ->
// parts_request_items, per the workflow-redesign business rule (Materials
// Requests are children of Job Cards, never linked to an asset directly).
export type AssetMaterialsHistoryRow = {
  work_order_id: string;
  work_order_number: string | null;
  work_order_status: string;
  parts_request_id: string;
  parts_request_number: string | null;
  parts_request_status: string;
  item_id: string;
  material_name: string;
  quantity_requested: number;
  issued_quantity: number;
  remaining_quantity: number;
  requested_date: string;
};

export type AssetMaintenanceSummary = {
  totalRepairs: number;
  openOrders: number;
  closedOrders: number;
  lastRepairedDate: string | null;
  workOrders: AssetWorkOrderRow[];
  technicians: AssetTechnicianRow[];
  materialsHistory: AssetMaterialsHistoryRow[];
  /** Most recently requested material line, for the Overview "Recent Materials" card. */
  recentMaterial: AssetMaterialsHistoryRow | null;
  totalMaterialsRequests: number;
};

// ─── Service function ─────────────────────────────────────────────────────────

/**
 * Fetches all maintenance data for a given asset in one batched query.
 * Provides work orders (with per-WO technician names), distinct technician
 * history, and Materials Request history derived through the Job Card
 * relationship (never from the legacy work_order_materials table, which the
 * current Materials Request workflow does not write to).
 */
export async function getAssetMaintenanceSummary(assetId: string): Promise<AssetMaintenanceSummary> {
  const raw = await prisma.work_orders.findMany({
    select: {
      id: true,
      work_order_number: true,
      status: true,
      maintenance_type: true,
      worker_type: true,
      priority: true,
      date_of_order: true,
      ending_datetime: true,
      operator_complaint: true,
      total_work_order_cost: true,
      work_order_assignments: {
        select: {
          assigned_at: true,
          profiles: { select: { id: true, full_name: true, job_title: true } }
        },
        where: { technician_id: { not: null } },
        orderBy: { assigned_at: "desc" }
      },
      parts_requests: {
        select: {
          id: true,
          parts_request_number: true,
          status: true,
          request_date: true,
          created_at: true,
          parts_request_items: {
            select: { id: true, description: true, quantity_requested: true, issued_quantity: true }
          }
        },
        orderBy: { created_at: "desc" }
      }
    },
    where: { asset_id: assetId, deleted_at: null },
    orderBy: { date_of_order: "desc" },
    take: 100
  });

  // ── Work order rows ───────────────────────────────────────────────────────
  const workOrders: AssetWorkOrderRow[] = raw.map((wo) => {
    const techNames = wo.work_order_assignments
      .map((a) => {
        const p = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
        return p?.full_name ?? null;
      })
      .filter((n): n is string => Boolean(n))
      .slice(0, 3);

    return {
      id: wo.id,
      work_order_number: wo.work_order_number,
      status: wo.status,
      maintenance_type: wo.maintenance_type,
      worker_type: wo.worker_type,
      priority: wo.priority,
      date_of_order: wo.date_of_order.toISOString(),
      ending_datetime: wo.ending_datetime?.toISOString() ?? null,
      operator_complaint: wo.operator_complaint,
      total_work_order_cost: wo.total_work_order_cost?.toFixed(3) ?? null,
      technician_names: techNames,
    };
  });

  // ── Summary stats ─────────────────────────────────────────────────────────
  const openOrders = workOrders.filter((wo) => !TERMINAL_STATUSES.has(wo.status)).length;
  const closedWos = workOrders.filter((wo) => TERMINAL_STATUSES.has(wo.status));
  const lastRepaired = closedWos[0]?.ending_datetime ?? closedWos[0]?.date_of_order ?? null;

  // ── Distinct technician history ───────────────────────────────────────────
  const techMap = new Map<string, AssetTechnicianRow>();
  for (const wo of raw) {
    for (const assignment of wo.work_order_assignments) {
      const p = Array.isArray(assignment.profiles) ? assignment.profiles[0] : assignment.profiles;
      if (!p) continue;
      if (!techMap.has(p.id)) {
        techMap.set(p.id, {
          id: p.id,
          full_name: p.full_name,
          job_title: p.job_title ?? null,
          lastAssigned: assignment.assigned_at.toISOString()
        });
      }
    }
  }
  const technicians = [...techMap.values()];

  // ── Materials History: assets.id -> work_orders.asset_id ->
  // parts_requests.work_order_id -> parts_request_items. Every Materials
  // Request line requested for this asset through a linked Job Card. ───────
  const materialsHistory: AssetMaterialsHistoryRow[] = [];
  for (const wo of raw) {
    for (const pr of wo.parts_requests) {
      const requestedDate = (pr.request_date ?? pr.created_at).toISOString();
      for (const item of pr.parts_request_items) {
        const requested = Number(item.quantity_requested);
        const issued = Number(item.issued_quantity);
        materialsHistory.push({
          work_order_id: wo.id,
          work_order_number: wo.work_order_number,
          work_order_status: wo.status,
          parts_request_id: pr.id,
          parts_request_number: pr.parts_request_number,
          parts_request_status: pr.status,
          item_id: item.id,
          material_name: item.description,
          quantity_requested: requested,
          issued_quantity: issued,
          remaining_quantity: Math.max(requested - issued, 0),
          requested_date: requestedDate,
        });
      }
    }
  }
  materialsHistory.sort(
    (a, b) => new Date(b.requested_date).getTime() - new Date(a.requested_date).getTime()
  );

  return {
    totalRepairs: workOrders.length,
    openOrders,
    closedOrders: closedWos.length,
    lastRepairedDate: lastRepaired,
    workOrders,
    technicians,
    materialsHistory,
    recentMaterial: materialsHistory[0] ?? null,
    totalMaterialsRequests: new Set(materialsHistory.map((m) => m.parts_request_id)).size,
  };
}
