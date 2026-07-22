import "server-only";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireUser, type CurrentUserContext } from "@/lib/auth/context";
import {
  normalizeCategory,
  OTHER_CATEGORY,
  type BalanceItem,
  type RecentMovementRow,
  type WorkOrderOption,
} from "@/components/store/offline-inventory-types";

// Offline Inventory Control's own "can manage" gate — deliberately separate
// from broader work_orders/parts_requests permissions. Store issues
// materials; Data Entry / Engineer / Manager track what's issued and update
// consumed/used materials for their Job Cards, but do not manage opening
// stock, imports, receiving, or issuing themselves unless they hold the real
// `store.issue` permission (Data Entry Dashboard/Job Card Tabs/Material
// Tracking Alignment, Task 6 — this previously also special-cased the
// maintenance_data_entry role slug directly, silently granting every Data
// Entry account full store-management actions regardless of their actual
// granted permissions; that bypass has been removed so this now matches
// "Do not broaden permissions silently"). Store Keeper / Maintenance Manager
// / Super Admin keep working exactly as before via `store.issue`.
export function canManageOfflineInventory(context: CurrentUserContext): boolean {
  return (
    context.role?.slug === "super_admin" ||
    context.permissions.includes("store.issue")
  );
}

export async function requireOfflineInventoryManage() {
  const context = await requireUser();
  if (!canManageOfflineInventory(context)) {
    redirect("/store/offline-inventory?error=permission-denied");
  }
  return context;
}

// Store Materials Issue Page Simplification Unit Task 2: read-only, purely
// informational — the balance this returns is never used to block a send
// (issueMaterials has no balance check at all). It only drives a soft
// "no store balance recorded" helper note so Store isn't left wondering why
// the number here doesn't match what's physically on the shelf.
export async function getMaterialBalancesForItems(
  items: { part_id: string | null; description: string }[]
): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  await Promise.all(
    items.map(async (item) => {
      const key = item.part_id ?? item.description;
      const movements = await prisma.offline_inventory_movements.findMany({
        where: item.part_id
          ? { part_id: item.part_id, deleted_at: null }
          : {
              part_id: null,
              manual_material_name: { equals: item.description, mode: "insensitive" },
              deleted_at: null,
            },
        select: { movement_type: true, quantity: true },
      });
      let balance = 0;
      for (const m of movements) {
        const qty = Number(m.quantity);
        if (m.movement_type === "RECEIVED" || m.movement_type === "OPENING_STOCK") balance += qty;
        else if (m.movement_type === "ISSUED") balance -= qty;
      }
      results.set(key, balance);
    })
  );
  return results;
}

function buildBalanceKey(m: {
  part_id: string | null;
  manual_material_name: string | null;
  unit: string;
}): string {
  if (m.part_id) return `part:${m.part_id}`;
  return `manual:${(m.manual_material_name ?? "").toLowerCase().trim()}|${m.unit.toLowerCase().trim()}`;
}

export type OfflineInventoryBalance = {
  balanceItems: BalanceItem[];
  totalOpeningStock: number;
  totalReceived: number;
  totalIssued: number;
  balance: number;
};

export async function getOfflineInventoryBalance(): Promise<OfflineInventoryBalance> {
  const allMovementsRaw = await prisma.offline_inventory_movements.findMany({
    where: { deleted_at: null },
    select: {
      movement_type: true,
      movement_date: true,
      part_id: true,
      manual_material_name: true,
      manual_part_number: true,
      ss_rec_code: true,
      category: true,
      counterparty: true,
      quantity: true,
      unit: true,
      parts: { select: { part_name: true, part_number: true } },
    },
    orderBy: [{ movement_date: "desc" }, { created_at: "desc" }],
  });

  let totalOpeningStock = 0;
  let totalReceived     = 0;
  let totalIssued       = 0;

  // Results are ordered most-recent-first, so the first movement seen per
  // material key that carries a category/location is the most recent one.
  const balanceAccum = new Map<
    string,
    { item: BalanceItem; lastDate: Date; categorySet: boolean; locationSet: boolean }
  >();

  for (const m of allMovementsRaw) {
    const qty = Number(m.quantity);
    const key = buildBalanceKey(m);

    if (!balanceAccum.has(key)) {
      balanceAccum.set(key, {
        item: {
          key,
          part_id:              m.part_id,
          display_name:         m.parts?.part_name ?? m.manual_material_name ?? "Unknown",
          part_number:          m.parts?.part_number ?? m.manual_part_number ?? null,
          ss_rec_code:          m.ss_rec_code,
          category:             OTHER_CATEGORY,
          location:             null,
          manual_material_name: m.manual_material_name,
          unit:                 m.unit,
          total_opening_stock:  0,
          total_received:       0,
          total_issued:         0,
          balance:              0,
          last_movement_date:   m.movement_date.toISOString(),
        },
        lastDate: m.movement_date,
        categorySet: false,
        locationSet: false,
      });
    }

    const entry = balanceAccum.get(key)!;

    if (m.movement_type === "OPENING_STOCK") {
      totalOpeningStock              += qty;
      entry.item.total_opening_stock += qty;
      entry.item.balance             += qty;
    } else if (m.movement_type === "RECEIVED") {
      totalReceived              += qty;
      entry.item.total_received  += qty;
      entry.item.balance         += qty;
    } else if (m.movement_type === "ISSUED") {
      totalIssued                += qty;
      entry.item.total_issued    += qty;
      entry.item.balance         -= qty;
    }

    if (!entry.categorySet && m.category) {
      entry.item.category = normalizeCategory(m.category);
      entry.categorySet = true;
    }
    // Location / Bin is only captured on Opening Stock movements.
    if (!entry.locationSet && m.movement_type === "OPENING_STOCK" && m.counterparty) {
      entry.item.location = m.counterparty;
      entry.locationSet = true;
    }

    if (m.movement_date > entry.lastDate) {
      entry.lastDate                 = m.movement_date;
      entry.item.last_movement_date  = m.movement_date.toISOString();
    }
  }

  const balance      = totalOpeningStock + totalReceived - totalIssued;
  const balanceItems = Array.from(balanceAccum.values())
    .map((e) => e.item)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  return { balanceItems, totalOpeningStock, totalReceived, totalIssued, balance };
}

// Latest N movements across every material, for the Recent Movements section
// on the Offline Inventory Control main page. Same shape/ordering as the full
// Movement History page's query, just capped short — every write path
// (manual opening stock, Excel import, receive, issue, and the Materials
// Request receive/issue flows, all of which write to this same table) shows
// up here automatically with no extra wiring.
export async function getRecentOfflineInventoryMovements(limit = 15): Promise<RecentMovementRow[]> {
  const rows = await prisma.offline_inventory_movements.findMany({
    where: { deleted_at: null },
    include: {
      parts: { select: { part_name: true } },
      work_orders: { select: { work_order_number: true } },
      profiles: { select: { full_name: true } },
    },
    orderBy: [{ movement_date: "desc" }, { created_at: "desc" }],
    take: limit,
  });

  return rows.map((m) => ({
    id: m.id,
    movement_type: m.movement_type,
    movement_date: m.movement_date.toISOString(),
    material_name: m.parts?.part_name ?? m.manual_material_name ?? "Unknown",
    category: normalizeCategory(m.category),
    quantity: Number(m.quantity),
    unit: m.unit,
    related_work_order_id: m.related_work_order_id,
    work_order_number: m.work_orders?.work_order_number ?? null,
    reference_number: m.reference_number,
    created_by_name: m.profiles.full_name,
    remarks: m.remarks,
  }));
}

export async function getWorkOrderOptions(): Promise<WorkOrderOption[]> {
  const workOrdersRaw = await prisma.work_orders.findMany({
    select: { id: true, work_order_number: true },
    orderBy: { created_at: "desc" },
    take: 100,
  });

  return workOrdersRaw.map((wo) => ({
    id:                wo.id,
    work_order_number: wo.work_order_number,
  }));
}
