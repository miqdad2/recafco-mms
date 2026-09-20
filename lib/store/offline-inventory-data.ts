import "server-only";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { requireUser, type CurrentUserContext } from "@/lib/auth/context";
import { normalizeMaterialKey } from "@/lib/materials/normalize-material";
import {
  normalizeCategory,
  OTHER_CATEGORY,
  MATERIAL_CATEGORIES,
  type BalanceItem,
  type RecentMovementRow,
  type WorkOrderOption,
  type StockStatus,
  type CategoryCostSummary,
  type TopIssuedMaterial,
  type InventorySpendingSummary,
} from "@/components/store/offline-inventory-types";

// Offline Inventory Control's own "can manage" gate — deliberately separate
// from broader work_orders/parts_requests permissions.
//
// Offline Inventory canManage Fix: the role-slug-only removal below this
// comment previously left this gate checking `store.issue` alone. On the
// deployed environment, Maintenance Manager was granted the dedicated
// `offline_inventory.issue` permission (seeded in migration
// 20260720130100_workflow_redesign_unit3_roles_permissions) instead of/in
// addition to `store.issue` — a permission this function never checked — so
// canManage came back false even though the DB grant was correct. Mirrors
// the same explicit role-slug + permission-fallback pattern already used by
// `canReceiveIssueMaterials()` in lib/parts-requests/visibility.ts: System
// Administrator (super_admin), Maintenance Manager, and Maintenance Data
// Entry are always allowed regardless of which permission key their grant
// happens to use; anyone else still needs the real `offline_inventory.issue`
// or `store.issue` permission. Viewer/read-only roles remain excluded.
export function canManageOfflineInventory(context: CurrentUserContext): boolean {
  return (
    context.role?.slug === "super_admin" ||
    context.role?.slug === "maintenance_manager" ||
    context.role?.slug === "maintenance_data_entry" ||
    context.permissions.includes("offline_inventory.issue") ||
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
//
// Performance Optimization Unit 3, Task 1: previously ran one unaggregated
// findMany per requested item (loading every matching movement row and
// summing in JS) — now a single SQL-side groupBy covering every requested
// item at once, summing quantities in Postgres instead of pulling full rows.
// Matches the original per-item semantics exactly: manual-name matching is
// case-insensitive and NOT scoped by unit (this function never filtered by
// unit, unlike buildBalanceKey() elsewhere), so quantities across different
// units for the same manual name are still summed together, same as before.
export async function getMaterialBalancesForItems(
  items: { part_id: string | null; description: string }[]
): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  if (items.length === 0) return results;

  const partIds = [...new Set(items.filter((i) => i.part_id).map((i) => i.part_id!))];
  const manualNames = [...new Set(items.filter((i) => !i.part_id).map((i) => i.description))];

  const orConditions: Array<Record<string, unknown>> = [];
  if (partIds.length) orConditions.push({ part_id: { in: partIds }, deleted_at: null });
  if (manualNames.length) {
    orConditions.push({
      part_id: null,
      deleted_at: null,
      OR: manualNames.map((name) => ({ manual_material_name: { equals: name, mode: "insensitive" } })),
    });
  }
  if (orConditions.length === 0) return results;

  const grouped = await prisma.offline_inventory_movements.groupBy({
    by: ["part_id", "manual_material_name", "movement_type"],
    where: { OR: orConditions },
    _sum: { quantity: true },
  });

  const balanceByPartId = new Map<string, number>();
  const balanceByManualNameLower = new Map<string, number>();
  for (const g of grouped) {
    const qty = Number(g._sum.quantity ?? 0);
    const delta = g.movement_type === "ISSUED" ? -qty : g.movement_type === "RECEIVED" || g.movement_type === "OPENING_STOCK" ? qty : 0;
    if (g.part_id) {
      balanceByPartId.set(g.part_id, (balanceByPartId.get(g.part_id) ?? 0) + delta);
    } else if (g.manual_material_name) {
      const nameKey = g.manual_material_name.toLowerCase();
      balanceByManualNameLower.set(nameKey, (balanceByManualNameLower.get(nameKey) ?? 0) + delta);
    }
  }

  for (const item of items) {
    const key = item.part_id ?? item.description;
    const bal = item.part_id
      ? balanceByPartId.get(item.part_id) ?? 0
      : balanceByManualNameLower.get(item.description.toLowerCase()) ?? 0;
    results.set(key, bal);
  }
  return results;
}

// Exported so app/actions/offline-inventory.ts can derive the same per-material
// identity key for its advisory-lock-based concurrency guard on Issue Material
// (Backend Reliability Fix Unit 1, Task 1) — the lock key must match this
// function exactly, or two different code paths could compute different keys
// for the same physical material and fail to serialize against each other.
export function buildBalanceKey(m: {
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
  // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 6 — sums of
  // the per-item values below, for the page's cost summary card(s). Callers
  // without cost permission simply never read these (the UI gates on
  // canViewCosts before rendering anything cost-related), so there's no
  // separate "stripped" variant of this function.
  totalStockValue: number;
  totalReceivedValue: number;
  totalIssuedValue: number;
  // Inventory Dashboard Spending and Simple Low Stock Rules Unit 10G.63,
  // Task 2 — "Low Stock / Needs Attention": count of items whose
  // stock_status is Low Stock, Out of Stock, Negative Stock, OR Review
  // Required (Unit 10G.62 excluded Review Required here; this unit
  // explicitly folds it back in, per the task's own redefinition).
  lowStockCount: number;
};

// Performance Optimization Unit 3, Task 1: previously loaded every non-deleted
// movement row (unbounded — grows forever with history) and aggregated
// balances in JS. Now does the summing in Postgres via groupBy, and fetches
// only ONE metadata row per material identity (via distinct+orderBy, which
// Prisma/Postgres implement as `DISTINCT ON`) instead of every row — so this
// query's cost scales with the number of distinct materials, not the number
// of movements ever recorded. Returns the exact same BalanceItem[] shape the
// UI already expects; the client-side search/filter behavior in
// store-balance-view.tsx (material name, part number, SS Rec. Code, category,
// location/bin) is unaffected since it already operated on one row per
// material, not raw movements.
//
// Known, accepted behavior difference from the old JS-aggregation version:
// grouping/distinct is by exact (part_id, manual_material_name, unit), not
// the case-normalized key buildBalanceKey() uses. In practice this never
// differs — Receive/Issue always reuse an existing material's exact stored
// casing via a <select> (see receive-material-form.tsx); free-typed manual
// names only happen once, at first creation. If two movements for "the same"
// material genuinely used different casing (a pre-existing data-entry
// mistake, not something this change introduces), their balances still merge
// correctly under the same normalized key below, but which movement's
// category/location "wins" for display is no longer strictly guaranteed to
// be the single most-recent one across both variants.
export async function getOfflineInventoryBalance(): Promise<OfflineInventoryBalance> {
  const distinctOrderBy = [
    { part_id: "asc" as const },
    { manual_material_name: "asc" as const },
    { unit: "asc" as const },
    { movement_date: "desc" as const },
    { created_at: "desc" as const },
  ];

  const [grouped, latestPerMaterial, latestOpeningStock, latestCostPerMaterial, settingsRows] = await Promise.all([
    // One row per (material identity, movement_type) — summed in SQL.
    // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 2: also
    // sums total_cost per (identity, movement_type) — null-safe (Prisma/SQL
    // SUM ignores nulls), so a mix of priced and unpriced movements for the
    // same material still yields a meaningful partial total rather than null.
    prisma.offline_inventory_movements.groupBy({
      by: ["part_id", "manual_material_name", "unit", "movement_type"],
      where: { deleted_at: null },
      _sum: { quantity: true, total_cost: true },
    }),
    // One row per material identity — its single most recent movement, for
    // display_name/part_number/ss_rec_code/category/last_movement_date.
    prisma.offline_inventory_movements.findMany({
      where: { deleted_at: null },
      distinct: ["part_id", "manual_material_name", "unit"],
      orderBy: distinctOrderBy,
      select: {
        part_id: true,
        manual_material_name: true,
        manual_part_number: true,
        ss_rec_code: true,
        unit: true,
        category: true,
        movement_date: true,
        parts: { select: { part_name: true, part_number: true } },
      },
    }),
    // Location / Bin is only ever captured on Opening Stock movements —
    // one row per material identity, its most recent Opening Stock entry.
    prisma.offline_inventory_movements.findMany({
      where: { deleted_at: null, movement_type: "OPENING_STOCK", counterparty: { not: null } },
      distinct: ["part_id", "manual_material_name", "unit"],
      orderBy: distinctOrderBy,
      select: { part_id: true, manual_material_name: true, unit: true, counterparty: true },
    }),
    // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 9 — the
    // "simple last unit cost method": one row per material identity, its
    // single most recent movement AMONG THOSE THAT RECORDED A unit_cost
    // (any movement type — Received, Opening Stock, or a future priced
    // Adjustment). A material with no priced movement at all simply isn't
    // in this list, so last_unit_cost stays null for it below.
    prisma.offline_inventory_movements.findMany({
      where: { deleted_at: null, unit_cost: { not: null } },
      distinct: ["part_id", "manual_material_name", "unit"],
      orderBy: distinctOrderBy,
      select: { part_id: true, manual_material_name: true, unit: true, unit_cost: true },
    }),
    // Inventory Clarity, Low Stock, and Bulk Unit Balance Unit 10G.62, Task
    // 2 — every configured minimum-stock/reorder-quantity row; the table is
    // one row per material identity (no distinct/orderBy needed).
    prisma.inventory_material_settings.findMany({
      select: { part_id: true, manual_material_name: true, unit: true, minimum_stock_quantity: true, reorder_quantity: true },
    }),
  ]);

  const metaByKey = new Map(latestPerMaterial.map((m) => [buildBalanceKey(m), m]));
  const locationByKey = new Map(latestOpeningStock.map((m) => [buildBalanceKey(m), m.counterparty]));
  const lastUnitCostByKey = new Map(
    latestCostPerMaterial.map((m) => [buildBalanceKey(m), m.unit_cost !== null ? Number(m.unit_cost) : null])
  );
  const settingsByKey = new Map(settingsRows.map((s) => [buildBalanceKey(s), s]));

  let totalOpeningStock = 0;
  let totalReceived     = 0;
  let totalIssued       = 0;
  let totalReceivedValue = 0;
  let totalIssuedValue   = 0;

  const balanceAccum = new Map<string, BalanceItem>();

  for (const g of grouped) {
    const key = buildBalanceKey(g);
    const qty = Number(g._sum.quantity ?? 0);
    const costSum = g._sum.total_cost !== null ? Number(g._sum.total_cost) : 0;

    if (!balanceAccum.has(key)) {
      const meta = metaByKey.get(key);
      if (!meta) continue; // every grouped key has at least one movement, so a meta row must exist
      const settings = settingsByKey.get(key);
      balanceAccum.set(key, {
        key,
        part_id:              meta.part_id,
        display_name:         meta.parts?.part_name ?? meta.manual_material_name ?? "Unknown",
        part_number:          meta.parts?.part_number ?? meta.manual_part_number ?? null,
        ss_rec_code:          meta.ss_rec_code,
        category:             meta.category ? normalizeCategory(meta.category) : OTHER_CATEGORY,
        location:             locationByKey.get(key) ?? null,
        manual_material_name: meta.manual_material_name,
        unit:                 meta.unit,
        total_opening_stock:  0,
        total_received:       0,
        total_issued:         0,
        balance:              0,
        last_movement_date:   meta.movement_date.toISOString(),
        last_unit_cost:       lastUnitCostByKey.get(key) ?? null,
        stock_value:          0,
        received_value:       0,
        issued_value:         0,
        minimum_stock_quantity: settings?.minimum_stock_quantity !== undefined && settings?.minimum_stock_quantity !== null ? Number(settings.minimum_stock_quantity) : null,
        reorder_quantity:       settings?.reorder_quantity !== undefined && settings?.reorder_quantity !== null ? Number(settings.reorder_quantity) : null,
        stock_status:           "ok", // finalized below, once every movement has been summed
      });
    }

    const item = balanceAccum.get(key)!;
    if (g.movement_type === "OPENING_STOCK") {
      totalOpeningStock  += qty;
      item.total_opening_stock += qty;
      item.balance        += qty;
      // Opening Stock's own cost counts toward stock value via
      // last_unit_cost below, not as a separate "received value" bucket —
      // it isn't a receipt from a supplier, it's the starting balance.
    } else if (g.movement_type === "RECEIVED") {
      totalReceived       += qty;
      item.total_received += qty;
      item.balance        += qty;
      item.received_value += costSum;
      totalReceivedValue  += costSum;
    } else if (g.movement_type === "ISSUED") {
      totalIssued          += qty;
      item.total_issued    += qty;
      item.balance         -= qty;
      item.issued_value    += costSum;
      totalIssuedValue     += costSum;
    }
  }

  // Inventory Clarity, Low Stock, and Bulk Unit Balance Unit 10G.62, Task 4
  // — a manual (non-catalog) material identity is flagged for review when
  // the SAME material name (case-insensitive) also appears under a
  // DIFFERENT unit elsewhere in Offline Inventory — a real, computable
  // "unit mismatch detected" signal (e.g. "Engine Oil" once entered as
  // LITER and once as LTR would otherwise silently sit as two unrelated
  // balances with no indication anything is off).
  const unitsByManualNameLower = new Map<string, Set<string>>();
  for (const item of balanceAccum.values()) {
    if (item.part_id) continue;
    const nameKey = (item.manual_material_name ?? "").toLowerCase().trim();
    if (!nameKey) continue;
    if (!unitsByManualNameLower.has(nameKey)) unitsByManualNameLower.set(nameKey, new Set());
    unitsByManualNameLower.get(nameKey)!.add(item.unit.toLowerCase().trim());
  }

  // Task 9/10 — stock value = balance * last unit cost, except a negative
  // (or zero-with-unknown-cost) balance always shows as 0 rather than a
  // negative or fabricated amount; the UI shows a "Review required" note
  // for the negative case instead of hiding it.
  let totalStockValue = 0;
  let lowStockCount = 0;
  for (const item of balanceAccum.values()) {
    item.stock_value = item.balance > 0 && item.last_unit_cost !== null ? item.balance * item.last_unit_cost : 0;
    totalStockValue += item.stock_value;

    // Inventory Dashboard Spending and Simple Low Stock Rules Unit 10G.63,
    // Task 1 — priority: Negative Stock, then Out of Stock, then Low Stock,
    // THEN Review Required, then OK. Unit 10G.62 had Review Required
    // ahead of Out of Stock/Low Stock, which could silently replace a more
    // basic, actionable "this is low/out" reading with a vaguer "review
    // this" one — moving it to just above OK means a genuinely low/out/
    // negative item always shows that plain meaning first, and Review
    // Required only ever shows for an item that would otherwise look "OK"
    // but has a real, separate data-quality concern (a unit mismatch)
    // worth a second look.
    //
    // Low Stock itself: a configured minimum_stock_quantity always wins
    // when present (balance <= minimum). With NO minimum configured, Task
    // 1's simple default rule applies instead of the old "any balance > 0
    // is fine" behavior — balance === 1 is Low Stock, balance >= 2 is OK.
    const nameKey = (item.manual_material_name ?? "").toLowerCase().trim();
    const hasUnitMismatch = !item.part_id && (unitsByManualNameLower.get(nameKey)?.size ?? 0) > 1;
    const isLowStock =
      item.minimum_stock_quantity !== null ? item.balance <= item.minimum_stock_quantity : item.balance === 1;
    const status: StockStatus =
      item.balance < 0
        ? "negative"
        : item.balance === 0
          ? "out_of_stock"
          : isLowStock
            ? "low_stock"
            : hasUnitMismatch
              ? "review_required"
              : "ok";
    item.stock_status = status;
    // Task 2 — "Low Stock Items" (Needs Attention) now also counts Review
    // Required, matching the task's explicit redefinition of that card/
    // filter (Unit 10G.62 deliberately excluded it; this unit reverses
    // that call at the task's own request).
    if (status === "low_stock" || status === "out_of_stock" || status === "negative" || status === "review_required") {
      lowStockCount += 1;
    }
  }

  const balance      = totalOpeningStock + totalReceived - totalIssued;
  const balanceItems = Array.from(balanceAccum.values())
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  return {
    balanceItems,
    totalOpeningStock,
    totalReceived,
    totalIssued,
    balance,
    totalStockValue,
    totalReceivedValue,
    totalIssuedValue,
    lowStockCount,
  };
}

// Closure Review Work and Material Cost Unit 10G.72, Task 5 — the exact same
// "last unit cost" method Unit 10G.61 established (getOfflineInventoryBalance's
// own latestCostPerMaterial query above: the single most recent movement,
// of any type, AMONG THOSE THAT RECORDED a unit_cost, per material
// identity), scoped to only the identities the caller needs rather than a
// full store-wide balance sweep. Returns null (never 0) for any identity
// with no priced movement recorded at all — callers must show "Unpriced"
// for those, never invent a cost.
export async function getLastUnitCostsForIdentities(
  identities: { part_id: string | null; manual_material_name: string | null; unit: string }[]
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  for (const id of identities) result.set(buildBalanceKey(id), null);
  if (identities.length === 0) return result;

  const identityOr: Prisma.offline_inventory_movementsWhereInput[] = identities.map((id) =>
    id.part_id
      ? { part_id: id.part_id, deleted_at: null }
      : {
          part_id: null,
          manual_material_name: { equals: id.manual_material_name ?? "", mode: "insensitive" as const },
          unit: { equals: id.unit, mode: "insensitive" as const },
          deleted_at: null,
        }
  );

  const rows = await prisma.offline_inventory_movements.findMany({
    where: { OR: identityOr, unit_cost: { not: null } },
    distinct: ["part_id", "manual_material_name", "unit"],
    orderBy: [
      { part_id: "asc" as const },
      { manual_material_name: "asc" as const },
      { unit: "asc" as const },
      { movement_date: "desc" as const },
      { created_at: "desc" as const },
    ],
    select: { part_id: true, manual_material_name: true, unit: true, unit_cost: true },
  });

  for (const r of rows) result.set(buildBalanceKey(r), r.unit_cost !== null ? Number(r.unit_cost) : null);
  return result;
}

// Inventory Clarity, Low Stock, and Bulk Unit Balance Unit 10G.62, Task 2/3
// — called only from addNewMaterialAction, and only when the user actually
// entered a minimum stock and/or reorder quantity (never creates an empty
// settings row just because a material was added). find-then-create/update
// rather than a DB-level upsert — this table has no single Prisma-visible
// unique constraint to upsert against (its real uniqueness is two partial,
// case-insensitive indexes the migration created directly in SQL), and
// Add New Material's own pre-existing duplicate-material guard already
// prevents two rows from ever being created for the same identity through
// this one call site.
export async function upsertInventoryMaterialSettings(opts: {
  partId: string | null;
  manualMaterialName: string | null;
  unit: string;
  minimumStockQuantity: number | null;
  reorderQuantity: number | null;
  createdBy: string;
}): Promise<void> {
  const where = opts.partId
    ? { part_id: opts.partId }
    : {
        part_id: null,
        manual_material_name: { equals: opts.manualMaterialName ?? "", mode: "insensitive" as const },
        unit: { equals: opts.unit, mode: "insensitive" as const },
      };

  const existing = await prisma.inventory_material_settings.findFirst({ where });
  if (existing) {
    await prisma.inventory_material_settings.update({
      where: { id: existing.id },
      data: {
        minimum_stock_quantity: opts.minimumStockQuantity,
        reorder_quantity: opts.reorderQuantity,
        updated_at: new Date(),
      },
    });
  } else {
    await prisma.inventory_material_settings.create({
      data: {
        part_id: opts.partId,
        manual_material_name: opts.manualMaterialName,
        unit: opts.unit,
        minimum_stock_quantity: opts.minimumStockQuantity,
        reorder_quantity: opts.reorderQuantity,
        created_by: opts.createdBy,
      },
    });
  }
}

// Inventory Dashboard Spending and Simple Low Stock Rules Unit 10G.63,
// Task 4/5/6/7 — one bounded query (every RECEIVED/ISSUED movement in the
// current calendar year — a reasonable bound for a first version, same
// "good enough for now" scope as the rest of this ledger's dashboard-style
// reads) does all the bucketing in JS: issued value this week/month/year,
// received value this month, cost-by-category (month/year issued, month
// received, plus current stock value folded in from the already-computed
// balanceItems so this needs no second stock-value calculation), and top
// issued materials this month. "This Week" = the rolling last 7 days
// (today back 6 days); "This Month"/"This Year" = calendar month/year to
// date — simple, predictable definitions for a first version.
//
// Every value here is cost data — the caller (the page) is responsible
// for stripping/zeroing this entire summary for a viewer without cost
// permission before it reaches a client component, exactly like
// balanceItemsForClient does for BalanceItem's cost fields.
export async function getInventorySpendingSummary(balanceItems: BalanceItem[]): Promise<InventorySpendingSummary> {
  const now = new Date();
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));

  const currentStockValueByCategory = new Map<string, number>();
  for (const item of balanceItems) {
    currentStockValueByCategory.set(item.category, (currentStockValueByCategory.get(item.category) ?? 0) + item.stock_value);
  }

  const rows = await prisma.offline_inventory_movements.findMany({
    where: { deleted_at: null, movement_type: { in: ["ISSUED", "RECEIVED"] }, movement_date: { gte: startOfYear } },
    select: {
      part_id: true,
      manual_material_name: true,
      unit: true,
      category: true,
      movement_type: true,
      movement_date: true,
      quantity: true,
      unit_cost: true,
      total_cost: true,
      parts: { select: { part_name: true } },
    },
  });

  let issuedValueThisWeek = 0;
  let issuedValueThisMonth = 0;
  let issuedValueThisYear = 0;
  let receivedValueThisMonth = 0;
  let unpricedIssuedCount = 0;
  const categoryMap = new Map<string, { issuedThisMonth: number; issuedThisYear: number; receivedThisMonth: number }>();
  const materialMap = new Map<string, TopIssuedMaterial>();

  for (const r of rows) {
    const qty = Number(r.quantity);
    // Task 4 — total_cost where available; quantity * unit_cost when only
    // that's present; excluded from every value sum when neither exists.
    const effectiveCost =
      r.total_cost !== null ? Number(r.total_cost) : r.unit_cost !== null ? qty * Number(r.unit_cost) : null;
    const category = normalizeCategory(r.category);
    const cat = categoryMap.get(category) ?? { issuedThisMonth: 0, issuedThisYear: 0, receivedThisMonth: 0 };
    categoryMap.set(category, cat);

    if (r.movement_type === "ISSUED") {
      if (effectiveCost === null) unpricedIssuedCount += 1;
      const cost = effectiveCost ?? 0;
      if (r.movement_date >= startOfYear) {
        issuedValueThisYear += cost;
        cat.issuedThisYear += cost;
      }
      if (r.movement_date >= startOfMonth) {
        issuedValueThisMonth += cost;
        cat.issuedThisMonth += cost;

        const key = buildBalanceKey(r);
        const existing = materialMap.get(key);
        if (existing) {
          existing.issuedQuantity += qty;
          existing.issuedValue += cost;
          if (r.movement_date.toISOString() > existing.lastIssuedDate) existing.lastIssuedDate = r.movement_date.toISOString();
        } else {
          materialMap.set(key, {
            key,
            display_name: r.parts?.part_name ?? r.manual_material_name ?? "Unknown",
            unit: r.unit,
            issuedQuantity: qty,
            issuedValue: cost,
            lastIssuedDate: r.movement_date.toISOString(),
          });
        }
      }
      if (r.movement_date >= startOfWeek) issuedValueThisWeek += cost;
    } else if (r.movement_type === "RECEIVED") {
      const cost = effectiveCost ?? 0;
      if (r.movement_date >= startOfMonth) {
        receivedValueThisMonth += cost;
        cat.receivedThisMonth += cost;
      }
    }
  }

  const categoryCostSummary: CategoryCostSummary[] = Array.from(categoryMap.entries())
    .map(([category, v]) => ({ category, ...v, currentStockValue: currentStockValueByCategory.get(category) ?? 0 }))
    .sort((a, b) => b.issuedThisMonth - a.issuedThisMonth);

  const topIssuedMaterials = Array.from(materialMap.values())
    .sort((a, b) => b.issuedValue - a.issuedValue)
    .slice(0, 10);

  return {
    issuedValueThisWeek,
    issuedValueThisMonth,
    issuedValueThisYear,
    receivedValueThisMonth,
    unpricedIssuedCount,
    categoryCostSummary,
    topIssuedMaterials,
  };
}

export type OfflineInventorySearchMatch = {
  key: string;
  part_id: string | null;
  manual_material_name: string | null;
  display_name: string;
  part_number: string | null;
  ss_rec_code: string | null;
  unit: string;
  category: string;
  location: string | null;
  balance: number;
  last_movement_date: string;
  // Job Card Required Materials Estimated Cost Visibility Unit 10G.73
  // (second unit of this name), Task 1/5 — the same Unit 10G.61 "last unit
  // cost" method (getLastUnitCostsForIdentities), null when the caller
  // lacks cost permission (never computed/queried at all in that case — see
  // searchOfflineInventoryMaterials's own canViewCosts parameter) or when
  // the material genuinely has no priced movement recorded.
  last_unit_cost: number | null;
};

// Required Materials Inventory Matching Unit 5, Task 2: Required Materials
// autocomplete search. Same balance-aggregation shape as
// getOfflineInventoryBalance() above (groupBy in Postgres, one metadata row
// per distinct material identity via `distinct`) but scoped to a small
// top-N candidate set instead of every material, so this stays cheap enough
// to call on every keystroke (debounced client-side). Never loads raw
// movement rows — only grouped sums and one metadata row per candidate.
export async function searchOfflineInventoryMaterials(opts: {
  query: string;
  unit?: string | null;
  partNumber?: string | null;
  limit?: number;
  // Job Card Required Materials Estimated Cost Visibility Unit 10G.73
  // (second unit of this name), Task 1/5 — defaults to false so every other
  // existing caller of this function keeps its current behavior (no cost
  // query run, last_unit_cost always null) unless it explicitly opts in.
  canViewCosts?: boolean;
}): Promise<OfflineInventorySearchMatch[]> {
  const trimmed = opts.query.trim();
  if (trimmed.length < 2) return [];
  const limit = Math.min(opts.limit ?? 10, 25);

  const filters: Prisma.offline_inventory_movementsWhereInput[] = [
    { deleted_at: null },
    {
      OR: [
        { manual_material_name: { contains: trimmed, mode: "insensitive" } },
        { manual_part_number: { contains: trimmed, mode: "insensitive" } },
        { ss_rec_code: { contains: trimmed, mode: "insensitive" } },
        { parts: { part_name: { contains: trimmed, mode: "insensitive" } } },
        { parts: { part_number: { contains: trimmed, mode: "insensitive" } } },
      ],
    },
  ];
  if (opts.unit?.trim()) {
    filters.push({ unit: { equals: opts.unit.trim(), mode: "insensitive" } });
  }
  if (opts.partNumber?.trim()) {
    const pn = opts.partNumber.trim();
    filters.push({
      OR: [
        { manual_part_number: { contains: pn, mode: "insensitive" } },
        { parts: { part_number: { contains: pn, mode: "insensitive" } } },
      ],
    });
  }

  const distinctOrderBy = [
    { part_id: "asc" as const },
    { manual_material_name: "asc" as const },
    { unit: "asc" as const },
    { movement_date: "desc" as const },
    { created_at: "desc" as const },
  ];

  const candidates = await prisma.offline_inventory_movements.findMany({
    where: { AND: filters },
    distinct: ["part_id", "manual_material_name", "unit"],
    orderBy: distinctOrderBy,
    select: {
      part_id: true,
      manual_material_name: true,
      manual_part_number: true,
      ss_rec_code: true,
      unit: true,
      category: true,
      movement_date: true,
      parts: { select: { part_name: true, part_number: true } },
    },
    take: limit,
  });

  if (candidates.length === 0) return [];

  const identityOr = candidates.map((c) =>
    c.part_id
      ? { part_id: c.part_id, deleted_at: null }
      : {
          part_id: null,
          manual_material_name: { equals: c.manual_material_name ?? "", mode: "insensitive" as const },
          unit: { equals: c.unit, mode: "insensitive" as const },
          deleted_at: null,
        }
  );

  const [grouped, locationRows, lastUnitCostByKey] = await Promise.all([
    prisma.offline_inventory_movements.groupBy({
      by: ["part_id", "manual_material_name", "unit", "movement_type"],
      where: { OR: identityOr },
      _sum: { quantity: true },
    }),
    prisma.offline_inventory_movements.findMany({
      where: { OR: identityOr, movement_type: "OPENING_STOCK", counterparty: { not: null }, deleted_at: null },
      distinct: ["part_id", "manual_material_name", "unit"],
      orderBy: distinctOrderBy,
      select: { part_id: true, manual_material_name: true, unit: true, counterparty: true },
    }),
    // Job Card Required Materials Estimated Cost Visibility Unit 10G.73
    // (second unit of this name), Task 1/5 — skipped entirely (never even
    // queried) for a caller without cost permission, same "no leak by
    // design" pattern this codebase already uses for every other cost read.
    opts.canViewCosts ? getLastUnitCostsForIdentities(candidates) : Promise.resolve(new Map<string, number | null>()),
  ]);

  const balanceByKey = new Map<string, number>();
  for (const g of grouped) {
    const key = buildBalanceKey(g);
    const qty = Number(g._sum.quantity ?? 0);
    const delta =
      g.movement_type === "ISSUED" ? -qty : g.movement_type === "RECEIVED" || g.movement_type === "OPENING_STOCK" ? qty : 0;
    balanceByKey.set(key, (balanceByKey.get(key) ?? 0) + delta);
  }
  const locationByKey = new Map(locationRows.map((r) => [buildBalanceKey(r), r.counterparty]));

  return candidates
    .map((c) => {
      const key = buildBalanceKey(c);
      return {
        key,
        part_id: c.part_id,
        manual_material_name: c.manual_material_name,
        display_name: c.parts?.part_name ?? c.manual_material_name ?? "Unknown",
        part_number: c.parts?.part_number ?? c.manual_part_number ?? null,
        ss_rec_code: c.ss_rec_code,
        unit: c.unit,
        category: c.category ? normalizeCategory(c.category) : OTHER_CATEGORY,
        location: locationByKey.get(key) ?? null,
        balance: balanceByKey.get(key) ?? 0,
        last_movement_date: c.movement_date.toISOString(),
        last_unit_cost: opts.canViewCosts ? lastUnitCostByKey.get(key) ?? null : null,
      };
    })
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
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
    unit_cost: m.unit_cost !== null ? Number(m.unit_cost) : null,
    total_cost: m.total_cost !== null ? Number(m.total_cost) : null,
  }));
}

export type MaterialMatchResolution = {
  matched: boolean;
  key: string | null;
  part_id: string | null;
  balance: number;
};

// Required Materials Inventory Matching Unit 5, Task 6: re-verify a
// Required Materials row's earlier-selected Offline Inventory match at
// save time — the balance may have moved since the row was picked in the
// wizard, or (rarely) every movement for that identity may have since been
// soft-deleted. Deliberately does NOT search by name: if `key` is blank
// (row was typed manually and never matched a suggestion) or the identity
// no longer resolves to any movement, this returns matched:false and the
// caller falls back to plain manual-text behavior — it can never silently
// swap in a different material than the one the user actually selected.
export async function resolveMaterialMatchByKey(key: string | null | undefined): Promise<MaterialMatchResolution> {
  const trimmedKey = (key ?? "").trim();
  if (!trimmedKey) return { matched: false, key: null, part_id: null, balance: 0 };

  const isPart = trimmedKey.startsWith("part:");
  const partId = isPart ? trimmedKey.slice("part:".length) : null;
  let manualName = "";
  let unit = "";
  if (!isPart) {
    const rest = trimmedKey.startsWith("manual:") ? trimmedKey.slice("manual:".length) : trimmedKey;
    const sepIndex = rest.lastIndexOf("|");
    manualName = sepIndex === -1 ? rest : rest.slice(0, sepIndex);
    unit = sepIndex === -1 ? "" : rest.slice(sepIndex + 1);
  }

  const where = isPart
    ? { part_id: partId, deleted_at: null }
    : {
        part_id: null,
        manual_material_name: { equals: manualName, mode: "insensitive" as const },
        unit: { equals: unit, mode: "insensitive" as const },
        deleted_at: null,
      };

  const movements = await prisma.offline_inventory_movements.findMany({
    where,
    select: { movement_type: true, quantity: true },
  });

  if (movements.length === 0) {
    return { matched: false, key: null, part_id: null, balance: 0 };
  }

  let balance = 0;
  for (const m of movements) {
    const qty = Number(m.quantity);
    if (m.movement_type === "RECEIVED" || m.movement_type === "OPENING_STOCK") balance += qty;
    else if (m.movement_type === "ISSUED") balance -= qty;
  }

  return { matched: true, key: trimmedKey, part_id: partId, balance };
}

export type ExistingMaterialMatch = {
  key: string;
  display_name: string;
  unit: string;
  part_number: string | null;
};

// Required Materials Inventory Matching Unit 5, Task 8. The existing
// duplicate guard in app/actions/offline-inventory.ts's
// findDuplicateOpeningStock() already catches case-only differences
// ("OIL FILTER" vs "Oil Filter") via Postgres `mode: "insensitive"` — but
// that equality check does not collapse internal whitespace runs, so
// " oil   filter " would still slip through as "new". This is a second,
// looser pass: it loads only one row per distinct manual-material identity
// (bounded by the number of materials in Offline Inventory, never by
// movement history — same pattern as getOfflineInventoryBalance() above)
// and compares using normalizeMaterialKey() on name + unit. Only used as a
// fallback when the exact-match check finds nothing, so it never changes
// behavior for the common case.
export async function findExistingMaterialByNormalizedName(opts: {
  manualName: string;
  unit: string;
}): Promise<ExistingMaterialMatch | null> {
  const targetName = normalizeMaterialKey(opts.manualName);
  const targetUnit = normalizeMaterialKey(opts.unit);
  if (!targetName) return null;

  const distinct = await prisma.offline_inventory_movements.findMany({
    where: { deleted_at: null, part_id: null, manual_material_name: { not: null } },
    distinct: ["manual_material_name", "unit"],
    select: { manual_material_name: true, manual_part_number: true, unit: true },
  });

  const match = distinct.find(
    (d) => normalizeMaterialKey(d.manual_material_name) === targetName && normalizeMaterialKey(d.unit) === targetUnit
  );
  if (!match || !match.manual_material_name) return null;

  return {
    key: buildBalanceKey({ part_id: null, manual_material_name: match.manual_material_name, unit: match.unit }),
    display_name: match.manual_material_name,
    unit: match.unit,
    part_number: match.manual_part_number,
  };
}

// Add New Material Category Flexibility Cleanup Task 2/3: resolves a
// user-typed new category name against every category already known to the
// system — the fixed MATERIAL_CATEGORIES list plus any custom category a
// previous "+ Add New Category" already saved — case-insensitively, so
// e.g. "electrical materials" reuses the existing "Electrical Materials"
// canonical spelling instead of creating a near-duplicate. Returns null only
// when the name is genuinely new, in which case the caller saves it as-is.
export async function findExistingCategoryMatch(name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  const knownMatch = MATERIAL_CATEGORIES.find((c) => c.toLowerCase() === lower);
  if (knownMatch) return knownMatch;

  const distinct = await prisma.offline_inventory_movements.findMany({
    where: { deleted_at: null, category: { not: null } },
    select: { category: true },
    distinct: ["category"],
  });
  const existing = distinct.find((d) => (d.category ?? "").trim().toLowerCase() === lower);
  return existing?.category ?? null;
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
