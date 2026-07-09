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
  /** Number of material rows recorded against this work order. */
  materials_count: number;
};

export type AssetTechnicianRow = {
  id: string;
  full_name: string;
  job_title: string | null;
  lastAssigned: string;
};

export type AssetMaterialRow = {
  name: string;
  part_number: string | null;
  totalQty: number;
  totalAmount: number;
};

export type AssetPartsUsedRow = {
  work_order_id: string;
  work_order_number: string | null;
  date_of_order: string;
  technician_names: string[];
  material_name: string;
  part_number: string | null;
  quantity: number;
};

export type AssetMaintenanceSummary = {
  totalRepairs: number;
  openOrders: number;
  closedOrders: number;
  lastRepairedDate: string | null;
  workOrders: AssetWorkOrderRow[];
  technicians: AssetTechnicianRow[];
  materials: AssetMaterialRow[];
  partsUsed: AssetPartsUsedRow[];
};

// ─── Service function ─────────────────────────────────────────────────────────

/**
 * Fetches all maintenance data for a given asset in one batched query.
 * Provides work orders (with per-WO technician names and materials count),
 * distinct technician history, and aggregated materials list.
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
      work_order_materials: {
        select: { material_name: true, part_number: true, quantity: true, amount: true }
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
      materials_count: wo.work_order_materials.length
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

  // ── Aggregated materials (sum qty/amount per material_name, top 30) ───────
  const matMap = new Map<string, { part_number: string | null; totalQty: number; totalAmount: number }>();
  for (const wo of raw) {
    for (const m of wo.work_order_materials) {
      const key = m.material_name;
      const qty = Number(m.quantity ?? 0);
      const amt = Number(m.amount ?? 0);
      const existing = matMap.get(key);
      if (existing) {
        existing.totalQty += qty;
        existing.totalAmount += amt;
      } else {
        matMap.set(key, { part_number: m.part_number ?? null, totalQty: qty, totalAmount: amt });
      }
    }
  }
  const materials: AssetMaterialRow[] = [...matMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.totalQty - a.totalQty)
    .slice(0, 30);

  // ── Per-repair-order parts used rows (most recent first, max 100) ──────────
  const partsUsed: AssetPartsUsedRow[] = [];
  for (const wo of raw) {
    const techNames = wo.work_order_assignments
      .map((a) => {
        const p = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
        return p?.full_name ?? null;
      })
      .filter((n): n is string => Boolean(n));

    for (const m of wo.work_order_materials) {
      partsUsed.push({
        work_order_id: wo.id,
        work_order_number: wo.work_order_number,
        date_of_order: wo.date_of_order.toISOString(),
        technician_names: techNames,
        material_name: m.material_name,
        part_number: m.part_number ?? null,
        quantity: Number(m.quantity ?? 0),
      });
    }
  }
  partsUsed.sort((a, b) => new Date(b.date_of_order).getTime() - new Date(a.date_of_order).getTime());

  return {
    totalRepairs: workOrders.length,
    openOrders,
    closedOrders: closedWos.length,
    lastRepairedDate: lastRepaired,
    workOrders,
    technicians,
    materials,
    partsUsed: partsUsed.slice(0, 100),
  };
}
