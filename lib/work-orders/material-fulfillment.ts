import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { buildBalanceKey } from "@/lib/store/offline-inventory-data";
import type { BackendTransaction } from "@/lib/backend/shared/transaction";

// Required Materials Issue and Shortage Tracking Unit 6.
//
// Everything here is DERIVED — no new column, no stored "issued" total.
// required_qty comes from work_order_required_parts.quantity_required
// (Unit 5). issued_qty is summed live from offline_inventory_movements rows
// with movement_type "ISSUED" and related_work_order_id = this Job Card,
// matched to the required-parts row by material identity (buildBalanceKey —
// the same part_id-or-manual-name+unit identity used across Offline
// Inventory Control since Unit 3). available_now is that same identity's
// current Offline Inventory balance, Job-Card-independent. Nothing here
// writes to offline_inventory_movements — Job Card creation/save never
// deducts stock; only Offline Inventory Control's own Issue Material action
// (movement_type "ISSUED") does, and it already enforces "cannot issue more
// than the current balance".

type DbClient = typeof prisma | BackendTransaction;

export type MaterialFulfillmentStatus = "fulfilled" | "partial_issued" | "shortage" | "ready";

export type MaterialFulfillment = {
  id: string;
  description: string;
  part_number: string | null;
  unit: string;
  required_qty: number;
  issued_qty: number;
  remaining_qty: number;
  available_now: number;
  shortage_qty: number;
  status: MaterialFulfillmentStatus;
};

function identityFilterFor(row: { part_id: string | null; description: string; unit_of_measure: string }): Prisma.offline_inventory_movementsWhereInput {
  return row.part_id
    ? { part_id: row.part_id, deleted_at: null }
    : {
        part_id: null,
        manual_material_name: { equals: row.description, mode: "insensitive" as const },
        unit: { equals: row.unit_of_measure, mode: "insensitive" as const },
        deleted_at: null,
      };
}

// Fetches Required/Issued/Remaining/Available now/Shortage for every
// Required Materials row on a Job Card. Pass `prisma` for a plain read
// (Job Card detail/quick view) or a transaction client for a
// consistency-locked read inside a closure guard.
export async function getMaterialFulfillmentForWorkOrder(
  db: DbClient,
  workOrderId: string
): Promise<MaterialFulfillment[]> {
  const rows = await db.workOrderRequiredPart.findMany({
    where: { work_order_id: workOrderId },
    orderBy: { created_at: "asc" },
    select: { id: true, description: true, part_number: true, part_id: true, unit_of_measure: true, quantity_required: true },
  });
  if (rows.length === 0) return [];

  const identityOr = rows.map(identityFilterFor);

  const [balanceGrouped, issuedGrouped] = await Promise.all([
    db.offline_inventory_movements.groupBy({
      by: ["part_id", "manual_material_name", "unit", "movement_type"],
      where: { OR: identityOr },
      _sum: { quantity: true },
    }),
    db.offline_inventory_movements.groupBy({
      by: ["part_id", "manual_material_name", "unit"],
      where: { OR: identityOr, movement_type: "ISSUED", related_work_order_id: workOrderId, deleted_at: null },
      _sum: { quantity: true },
    }),
  ]);

  const balanceByKey = new Map<string, number>();
  for (const g of balanceGrouped) {
    const key = buildBalanceKey(g);
    const qty = Number(g._sum.quantity ?? 0);
    const delta =
      g.movement_type === "ISSUED" ? -qty : g.movement_type === "RECEIVED" || g.movement_type === "OPENING_STOCK" ? qty : 0;
    balanceByKey.set(key, (balanceByKey.get(key) ?? 0) + delta);
  }
  const issuedByKey = new Map<string, number>();
  for (const g of issuedGrouped) {
    const key = buildBalanceKey(g);
    issuedByKey.set(key, (issuedByKey.get(key) ?? 0) + Number(g._sum.quantity ?? 0));
  }

  return rows.map((r) => {
    const key = buildBalanceKey({ part_id: r.part_id, manual_material_name: r.part_id ? null : r.description, unit: r.unit_of_measure });
    const required_qty = Number(r.quantity_required);
    const issued_qty = issuedByKey.get(key) ?? 0;
    const remaining_qty = Math.max(required_qty - issued_qty, 0);
    const available_now = Math.max(balanceByKey.get(key) ?? 0, 0);
    const shortage_qty = Math.max(remaining_qty - available_now, 0);

    let status: MaterialFulfillmentStatus;
    if (remaining_qty <= 1e-9) status = "fulfilled";
    else if (issued_qty > 1e-9) status = "partial_issued";
    else if (shortage_qty > 1e-9) status = "shortage";
    else status = "ready";

    return {
      id: r.id,
      description: r.description,
      part_number: r.part_number,
      unit: r.unit_of_measure,
      required_qty,
      issued_qty,
      remaining_qty,
      available_now,
      shortage_qty,
      status,
    };
  });
}

// Task 8 / business rule 5: true when at least one required material still
// has issued_qty < required_qty — the exact closure-blocking condition.
export function anyMaterialsIncomplete(fulfillment: MaterialFulfillment[]): boolean {
  return fulfillment.some((f) => f.remaining_qty > 1e-9);
}
