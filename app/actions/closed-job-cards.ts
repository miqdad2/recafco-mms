"use server";

import { requireUser, type CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { canViewCosts as canViewCostsForContext } from "@/lib/security/permissions";
import {
  getMaterialFulfillmentForWorkOrder,
  getMaterialFulfillmentForWorkOrders,
  type MaterialFulfillment,
} from "@/lib/work-orders/material-fulfillment";
import { getWorkOrderLaborSummary, getWorkOrderLaborSummariesBulk } from "@/lib/work-orders/work-session-totals";

// Manager Closed Job Cards Summary and Global Navigation Improvements Unit
// 10E, Part A.
//
// Read-only reporting only — no write path here touches closure, materials,
// or work-session logic. Both functions below are Pattern B (client modal
// fetches its own data, keyed by filter/id), matching WorkerActivityDetailModal
// (Unit 10C) and the Daily Activity materials modal (Unit 10D): the list is
// only computed when the modal is actually open, and per-Job-Card worker/
// material detail is only computed for the ONE row a Manager clicks into,
// never for the whole list at once (Task 6 — avoid N+1).
//
// Task 5 — closed-date source, in preference order:
//   1. work_orders has no `closed_at` column (confirmed by schema read).
//   2. work_order_status_history exists but is never written to by any
//      current backend function (confirmed by a full-codebase search) — an
//      unused legacy table, not a real source.
//   3. `approvals` rows with status "Closed" ARE written by both closure
//      paths (closeWorkOrder() and approveJobCardClosure(), both in
//      lib/backend/work-orders/service.ts) — decided_at/decided_by are
//      exactly "when"/"who". This is the audit-adjacent source Task 5 asks
//      to prefer when there's no closed_at column, and it's already read
//      the same way by the Job Card print page's "Approval History" table.
//   4. Fallback: work_orders.updated_at when no such approvals row exists
//      (legacy rows closed before this convention, if any).
// The list/detail queries below resolve the precise per-row date from (3)
// falling back to (4); the cheap KPI week/month COUNT on the dashboard page
// itself deliberately filters on updated_at alone (already indexed via
// idx_work_orders_status_updated_at) — Closed is a terminal status with no
// further transitions, so updated_at is frozen at the same moment (3) would
// report for every row this codebase's own closure functions produced.

// Data Entry Dashboard Closure and Closed Jobs Clarity Unit 10G.9, Task 3/8:
// widened from Manager-only to also allow Data Entry — a "role-safe variant"
// per Task 8, reusing this file directly rather than duplicating it, because
// every cost/pay field below was ALREADY gated by canViewCosts (never
// hardcoded to "Manager sees this"), not by this role check. Data Entry
// simply had no way to call it at all before this unit; now that it can,
// canViewCosts already resolves to false for Data Entry (no costs.view
// permission, no can_view_costs flag by default) exactly as it does
// everywhere else in the app — so cost/pay stays hidden from Data Entry with
// no new gating logic needed here. visibilityFilter (applied below, per
// role) still scopes every row to what that caller could already see
// elsewhere, so this grants no new Job Card visibility either.
function assertCanViewClosedJobCards(context: CurrentUserContext) {
  const slug = context.role?.slug;
  if (slug !== "super_admin" && slug !== "maintenance_manager" && slug !== "maintenance_data_entry") {
    throw new Error("You do not have permission to view Closed Job Cards.");
  }
}

function getWeekStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // Sunday-start week — same Kuwait Sunday-Thursday work week convention
  // established in getWorkerActivityDetail() (Unit 10C).
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function getMonthStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function materialsStatusLabel(status: MaterialFulfillment["status"]): "Fully Issued" | "Partially Issued" | "Not Issued" {
  if (status === "fulfilled") return "Fully Issued";
  if (status === "partial_issued") return "Partially Issued";
  // "shortage" and "ready" both mean nothing has been issued yet against
  // this row (available or not) — Task 4's 3-state model doesn't distinguish
  // them, matching the deliberate per-page wording simplification already
  // established for Daily Activity's own materials chip (Unit 9B).
  return "Not Issued";
}

function materialsSummaryLabel(fulfillment: MaterialFulfillment[]): string {
  if (fulfillment.length === 0) return "No materials";
  const fulfilledCount = fulfillment.filter((f) => f.status === "fulfilled").length;
  if (fulfilledCount === fulfillment.length) return `Fully Issued (${fulfillment.length})`;
  if (fulfilledCount === 0) return `Not Issued (${fulfillment.length})`;
  return `Partially Issued (${fulfilledCount}/${fulfillment.length})`;
}

export type ClosedJobCardsFilter = {
  // Data Entry Dashboard Closure and Closed Jobs Clarity Unit 10G.9, Task 3:
  // "last14days" added alongside the existing week/month/custom options —
  // the Data Entry "Closed Recently" card's own default (its dashboard tile
  // already counts on this exact rolling 14-day window), matching Task 3's
  // "Options: Last 14 days / This Month / Custom range." Manager's own
  // default ("week") is untouched.
  period: "week" | "month" | "custom" | "last14days";
  from?: string;
  to?: string;
  search?: string;
};

export type ClosedJobCardListRow = {
  id: string;
  workOrderNumber: string | null;
  assetLabel: string | null;
  issue: string;
  closedAtLabel: string;
  closedByName: string | null;
  totalHours: number;
  totalAmount: number | null;
  workersCount: number;
  materialsSummary: string;
};

// Task 6 — list caps: This Week/Last 14 Days default max 50, This Month max 100.
const WEEK_LIMIT = 50;
const MONTH_LIMIT = 100;
const LAST_14_DAYS_LIMIT = 50;

export async function getClosedJobCardsListAction(filter: ClosedJobCardsFilter): Promise<ClosedJobCardListRow[]> {
  const context = await requireUser();
  assertCanViewClosedJobCards(context);
  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  const canViewCosts = canViewCostsForContext(context);

  let rangeStart: Date;
  let rangeEnd: Date | null = null;
  let limit: number;
  if (filter.period === "week") {
    rangeStart = getWeekStart();
    limit = WEEK_LIMIT;
  } else if (filter.period === "last14days") {
    // Task 3 — same rolling 14-day window as the Data Entry dashboard's own
    // "Closed Recently" tile count (app/(dashboard)/dashboard/page.tsx's
    // recentlyClosedSince), so the tile's number and this list never disagree.
    rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 14);
    limit = LAST_14_DAYS_LIMIT;
  } else if (filter.period === "month") {
    rangeStart = getMonthStart();
    limit = MONTH_LIMIT;
  } else {
    rangeStart = filter.from ? new Date(filter.from) : getMonthStart();
    rangeEnd = filter.to ? new Date(`${filter.to}T23:59:59.999`) : null;
    limit = MONTH_LIMIT;
  }

  const search = (filter.search ?? "").trim().slice(0, 80);

  const rows = await prisma.work_orders.findMany({
    where: {
      AND: [
        visibilityFilter,
        { deleted_at: null },
        { status: "Closed" },
        { updated_at: { gte: rangeStart, ...(rangeEnd ? { lte: rangeEnd } : {}) } },
        ...(search
          ? [
              {
                OR: [
                  { work_order_number: { contains: search, mode: "insensitive" as const } },
                  { operator_complaint: { contains: search, mode: "insensitive" as const } },
                  { description_of_work: { contains: search, mode: "insensitive" as const } },
                  { assets: { asset_name: { contains: search, mode: "insensitive" as const } } },
                  { assets: { plate_number: { contains: search, mode: "insensitive" as const } } },
                  {
                    work_order_worker_assignments: {
                      some: { status: "active", worker_profiles: { name: { contains: search, mode: "insensitive" as const } } },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: { updated_at: "desc" },
    take: limit,
    select: {
      id: true,
      work_order_number: true,
      updated_at: true,
      operator_complaint: true,
      description_of_work: true,
      assets: { select: { asset_name: true, plate_number: true } },
      approvals: {
        where: { status: "Closed" },
        orderBy: { decided_at: "desc" },
        take: 1,
        select: { decided_at: true, decided_by: true },
      },
    },
  });

  const closedByIds = [...new Set(rows.map((r) => r.approvals[0]?.decided_by).filter((id): id is string => Boolean(id)))];
  const [closedByProfiles, fulfillmentMap, laborMap] = await Promise.all([
    closedByIds.length ? prisma.profiles.findMany({ where: { id: { in: closedByIds } }, select: { id: true, full_name: true } }) : Promise.resolve([]),
    getMaterialFulfillmentForWorkOrders(prisma, rows.map((r) => r.id)),
    getWorkOrderLaborSummariesBulk(prisma, rows.map((r) => r.id)),
  ]);
  const closedByNameById = new Map(closedByProfiles.map((p) => [p.id, p.full_name]));

  return rows.map((r) => {
    const approval = r.approvals[0] ?? null;
    const closedAt = approval?.decided_at ?? r.updated_at;
    const laborSummary = laborMap.get(r.id);
    const fulfillment = fulfillmentMap.get(r.id) ?? [];
    return {
      id: r.id,
      workOrderNumber: r.work_order_number,
      assetLabel: r.assets ? `${r.assets.asset_name}${r.assets.plate_number ? ` (${r.assets.plate_number})` : ""}` : null,
      issue: r.operator_complaint || r.description_of_work || "No issue description",
      closedAtLabel: closedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      closedByName: approval?.decided_by ? closedByNameById.get(approval.decided_by) ?? null : null,
      totalHours: laborSummary?.total_hours ?? 0,
      totalAmount: canViewCosts ? laborSummary?.total_amount ?? 0 : null,
      workersCount: laborSummary?.workers.length ?? 0,
      materialsSummary: materialsSummaryLabel(fulfillment),
    };
  });
}

export type ClosedJobCardDetailWorker = {
  name: string;
  role: string;
  hours: number;
  hourlyRate: number | null;
  totalPay: number | null;
};

export type ClosedJobCardDetailMaterial = {
  description: string;
  requiredQty: number;
  issuedQty: number;
  unit: string;
  status: "Fully Issued" | "Partially Issued" | "Not Issued";
};

export type ClosedJobCardDetail = {
  id: string;
  workOrderNumber: string | null;
  assetLabel: string | null;
  issue: string;
  createdAtLabel: string;
  closedAtLabel: string;
  requestedByName: string | null;
  closedByName: string | null;
  workers: ClosedJobCardDetailWorker[];
  totalHours: number;
  totalAmount: number | null;
  materials: ClosedJobCardDetailMaterial[];
  canViewCosts: boolean;
};

export async function getClosedJobCardDetailAction(workOrderId: string): Promise<ClosedJobCardDetail | null> {
  const context = await requireUser();
  assertCanViewClosedJobCards(context);
  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  const canViewCosts = canViewCostsForContext(context);

  const wo = await prisma.work_orders.findFirst({
    where: { id: workOrderId, deleted_at: null, status: "Closed", AND: [visibilityFilter] },
    select: {
      id: true,
      work_order_number: true,
      created_at: true,
      updated_at: true,
      operator_complaint: true,
      description_of_work: true,
      created_by: true,
      assets: { select: { asset_name: true, plate_number: true } },
      approvals: {
        where: { status: "Closed" },
        orderBy: { decided_at: "desc" },
        take: 1,
        select: { decided_at: true, decided_by: true },
      },
    },
  });
  if (!wo) return null;

  const [laborSummary, fulfillment] = await Promise.all([
    getWorkOrderLaborSummary(prisma, workOrderId),
    getMaterialFulfillmentForWorkOrder(prisma, workOrderId),
  ]);

  const approval = wo.approvals[0] ?? null;
  const profileIds = [wo.created_by, approval?.decided_by].filter((id): id is string => Boolean(id));
  const profiles = profileIds.length
    ? await prisma.profiles.findMany({ where: { id: { in: profileIds } }, select: { id: true, full_name: true } })
    : [];
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));
  const closedAt = approval?.decided_at ?? wo.updated_at;

  return {
    id: wo.id,
    workOrderNumber: wo.work_order_number,
    assetLabel: wo.assets ? `${wo.assets.asset_name}${wo.assets.plate_number ? ` (${wo.assets.plate_number})` : ""}` : null,
    issue: wo.operator_complaint || wo.description_of_work || "No issue description",
    createdAtLabel: wo.created_at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    closedAtLabel: closedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    requestedByName: wo.created_by ? nameById.get(wo.created_by) ?? null : null,
    closedByName: approval?.decided_by ? nameById.get(approval.decided_by) ?? null : null,
    workers: laborSummary.workers.map((w) => ({
      name: w.worker_name,
      role: w.worker_role,
      hours: w.total_hours,
      hourlyRate: canViewCosts ? w.hourly_rate_snapshot : null,
      totalPay: canViewCosts ? w.total_amount : null,
    })),
    totalHours: laborSummary.total_hours,
    totalAmount: canViewCosts ? laborSummary.total_amount : null,
    materials: fulfillment.map((f) => ({
      description: f.description,
      requiredQty: f.required_qty,
      issuedQty: f.issued_qty,
      unit: f.unit,
      status: materialsStatusLabel(f.status),
    })),
    canViewCosts,
  };
}
