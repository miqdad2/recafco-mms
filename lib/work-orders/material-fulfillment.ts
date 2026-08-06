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
  // Daily Activity Inline Materials Receive/Issue Modal Unit 10D: the
  // catalog part identity (when this required-material row is a catalog
  // part, not a manual entry) — needed by callers that issue AGAINST this
  // row's Offline Inventory balance (identityFilterFor above already uses
  // this internally; it just wasn't surfaced on the return type before,
  // since no caller needed to build its own movement yet).
  part_id: string | null;
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
      part_id: r.part_id,
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

// Daily Activity / Active Job Cards Work Tracking Unit 9, Task 11: bulk
// variant of getMaterialFulfillmentForWorkOrder above, for a page listing up
// to ~50 Job Cards at once — calling the single-work-order version in a loop
// would be 2 groupBy queries PER Job Card (N+1). This does the exact same
// two groupBy reads, just scoped across every requested Job Card at once,
// and applies the identical per-row math (remaining/available/shortage/
// status) — no calculation logic differs from the single-work-order path.
export async function getMaterialFulfillmentForWorkOrders(
  db: DbClient,
  workOrderIds: string[]
): Promise<Map<string, MaterialFulfillment[]>> {
  const result = new Map<string, MaterialFulfillment[]>();
  if (workOrderIds.length === 0) return result;

  const rows = await db.workOrderRequiredPart.findMany({
    where: { work_order_id: { in: workOrderIds } },
    orderBy: { created_at: "asc" },
    select: { id: true, work_order_id: true, description: true, part_number: true, part_id: true, unit_of_measure: true, quantity_required: true },
  });
  if (rows.length === 0) return result;

  const identityOr = rows.map(identityFilterFor);

  const [balanceGrouped, issuedGrouped] = await Promise.all([
    // Offline Inventory balance is per-material-identity, not per-Job-Card —
    // one groupBy covers every Job Card's required materials at once.
    db.offline_inventory_movements.groupBy({
      by: ["part_id", "manual_material_name", "unit", "movement_type"],
      where: { OR: identityOr },
      _sum: { quantity: true },
    }),
    // "Issued to THIS Job Card" still needs to stay scoped per work order,
    // so related_work_order_id is part of the groupBy key this time (the
    // single-work-order version doesn't need it — it's already filtered to
    // one work order in the WHERE clause).
    db.offline_inventory_movements.groupBy({
      by: ["part_id", "manual_material_name", "unit", "related_work_order_id"],
      where: { OR: identityOr, movement_type: "ISSUED", related_work_order_id: { in: workOrderIds }, deleted_at: null },
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
  const issuedByWorkOrderAndKey = new Map<string, number>();
  for (const g of issuedGrouped) {
    if (!g.related_work_order_id) continue;
    const compositeKey = `${g.related_work_order_id}::${buildBalanceKey(g)}`;
    issuedByWorkOrderAndKey.set(compositeKey, (issuedByWorkOrderAndKey.get(compositeKey) ?? 0) + Number(g._sum.quantity ?? 0));
  }

  for (const r of rows) {
    const key = buildBalanceKey({ part_id: r.part_id, manual_material_name: r.part_id ? null : r.description, unit: r.unit_of_measure });
    const required_qty = Number(r.quantity_required);
    const issued_qty = issuedByWorkOrderAndKey.get(`${r.work_order_id}::${key}`) ?? 0;
    const remaining_qty = Math.max(required_qty - issued_qty, 0);
    const available_now = Math.max(balanceByKey.get(key) ?? 0, 0);
    const shortage_qty = Math.max(remaining_qty - available_now, 0);

    let status: MaterialFulfillmentStatus;
    if (remaining_qty <= 1e-9) status = "fulfilled";
    else if (issued_qty > 1e-9) status = "partial_issued";
    else if (shortage_qty > 1e-9) status = "shortage";
    else status = "ready";

    const entry: MaterialFulfillment = {
      id: r.id,
      description: r.description,
      part_number: r.part_number,
      part_id: r.part_id,
      unit: r.unit_of_measure,
      required_qty,
      issued_qty,
      remaining_qty,
      available_now,
      shortage_qty,
      status,
    };
    const list = result.get(r.work_order_id);
    if (list) list.push(entry);
    else result.set(r.work_order_id, [entry]);
  }
  return result;
}

// Task 8 / business rule 5: true when at least one required material still
// has issued_qty < required_qty — the exact closure-blocking condition.
export function anyMaterialsIncomplete(fulfillment: MaterialFulfillment[]): boolean {
  return fulfillment.some((f) => f.remaining_qty > 1e-9);
}

// Job Card Action Clarity Fix (Materials): a single Job-Card-level summary
// of "what's the one right action for materials right now" — Issue vs
// Receive vs both vs done — used by the Job Cards list quick-view and the
// full Job Card detail page so both surfaces use the exact same wording
// instead of two independently-drifting readings of the same fulfillment
// rows. "none" means this Job Card has no `work_order_required_parts` rows
// at all (created before the Required Materials step existed, or has no
// materials) — callers fall back to their existing Materials-Request-status
// based wording in that case, since there's nothing to reason about here.
export type MaterialsAvailabilitySummary = "none" | "fulfilled" | "issuable" | "partial" | "shortage";

export function summarizeMaterialAvailability(fulfillment: MaterialFulfillment[]): MaterialsAvailabilitySummary {
  if (fulfillment.length === 0) return "none";
  const incomplete = fulfillment.filter((f) => f.remaining_qty > 1e-9);
  if (incomplete.length === 0) return "fulfilled";
  const allAvailable = incomplete.every((f) => f.available_now >= f.remaining_qty - 1e-9);
  if (allAvailable) return "issuable";
  const noneAvailable = incomplete.every((f) => f.available_now <= 1e-9);
  if (noneAvailable) return "shortage";
  return "partial";
}
