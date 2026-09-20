import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { getPartsRequestVisibilityFilter } from "@/lib/parts-requests/visibility";
import { getActiveMovementsByAsset } from "@/lib/assets/movements-data";
import { getMovementBadge, daysBetween } from "@/lib/assets/movement-status";
import { computeContractStatus } from "@/lib/display/service-contract-status";

// Printable Division-Based Reports Foundation Unit 10G.69.
//
// Deliberately a NEW, self-contained data module rather than extending
// lib/reports/data.ts's existing report functions: those already back the
// live, working screen reports (Job Card Summary, Asset Repair History,
// Materials Usage) and changing their shared shape/filters risks a
// regression there. These three functions are additive-only reads with
// their own flat, print-table-shaped rows (one row per Job Card, not the
// existing per-asset/per-mode aggregate shapes those functions return) —
// every query still applies getWorkOrderVisibilityFilter(context), per this
// project's own mandatory invariant for every work_orders query.

// Task 2 — "Division" filter, matching worker_profiles' own established
// Division vocabulary (lib/backend/workers/constants.ts's SKILL_CATEGORIES)
// exactly, but declared locally rather than imported: a Job Card's own
// "division" is a different column (work_orders.worker_type, labelled
// "Worker team / division" on the New Job Card wizard) from a worker
// profile's skill_category — same words, different table, so this file
// keeps its own copy rather than creating a cross-domain import between
// Job Card reports and the Worker Profiles feature.
export const REPORT_DIVISIONS = ["Mechanical", "Electrical", "Auto", "General", "Other", "Not specified"] as const;
export type ReportDivision = (typeof REPORT_DIVISIONS)[number];

// The documented 16-status Job Card lifecycle (CLAUDE.md's own "Work-Order
// Lifecycle" list) — used for the Status filter dropdown on the two reports
// that filter by it.
export const JOB_CARD_STATUSES = [
  "Draft", "Submitted", "Pending Approval", "Approved", "Assigned", "In Progress",
  "Waiting for Parts", "Waiting for Purchase", "Parts Issued", "Completed by Technician",
  "Verified by Supervisor", "Confirmed by Requester", "Closed", "Rejected", "Cancelled", "Reopened",
] as const;

const TERMINAL_STATUSES = ["Closed", "Cancelled", "Rejected"];
const MATERIALS_PENDING_STATUSES = ["Waiting for Parts", "Waiting for Purchase", "Waiting Materials", "Partially Issued"];
const COMPLETED_ISH_STATUSES = ["Closed", "Cancelled", "Rejected", "Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"];

function divisionWhere(division: string | undefined) {
  if (!division) return {};
  // work_orders.worker_type is required (never null) — "Not specified"
  // therefore matches an empty value rather than null, which is correct
  // for this column even though it will typically match zero rows today.
  return { worker_type: division === "Not specified" ? "" : division };
}

function dateRangeWhere(from: string, to: string) {
  return { date_of_order: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T23:59:59.999Z`) } };
}

function isOverdue(status: string, startingDatetime: string | null): boolean {
  return !!startingDatetime && new Date(startingDatetime) < new Date() && !COMPLETED_ISH_STATUSES.includes(status);
}

// ─── Job Card Summary Report (Task 4) ──────────────────────────────────────────

export type JobCardSummaryFilters = { from: string; to: string; division?: string; status?: string };

export type JobCardSummaryRow = {
  id: string;
  work_order_number: string | null;
  date_of_order: string;
  worker_type: string;
  asset_label: string;
  maintenance_type: string;
  operator_complaint: string | null;
  status: string;
  ordered_by: string;
  closed_date: string | null;
};

export async function getJobCardSummaryPrintReport(context: CurrentUserContext, filters: JobCardSummaryFilters) {
  const visibility = getWorkOrderVisibilityFilter(context);
  const where = {
    deleted_at: null,
    ...dateRangeWhere(filters.from, filters.to),
    ...divisionWhere(filters.division),
    ...(filters.status ? { status: filters.status } : {}),
    ...(Object.keys(visibility).length ? { AND: [visibility] } : {}),
  };

  const raw = await prisma.work_orders.findMany({
    where,
    select: {
      id: true,
      work_order_number: true,
      date_of_order: true,
      starting_datetime: true,
      worker_type: true,
      maintenance_type: true,
      operator_complaint: true,
      status: true,
      ordered_by: true,
      assets: { select: { asset_code: true, asset_name: true } },
      approvals: { orderBy: { decided_at: "desc" }, take: 1, select: { status: true, decided_at: true } },
    },
    orderBy: { date_of_order: "desc" },
    take: 2000,
  });

  const rows: (JobCardSummaryRow & { isClosureRequested: boolean; isOverdue: boolean })[] = raw.map((wo) => {
    const asset = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
    const latestApproval = wo.approvals[0] ?? null;
    const startingIso = wo.starting_datetime?.toISOString() ?? null;
    return {
      id: wo.id,
      work_order_number: wo.work_order_number,
      date_of_order: wo.date_of_order.toISOString(),
      worker_type: wo.worker_type,
      asset_label: asset ? `${asset.asset_code} - ${asset.asset_name}` : "Not recorded",
      maintenance_type: wo.maintenance_type,
      operator_complaint: wo.operator_complaint,
      status: wo.status,
      ordered_by: wo.ordered_by,
      closed_date: wo.status === "Closed" && latestApproval?.status === "Closed" ? latestApproval.decided_at.toISOString() : null,
      isClosureRequested: latestApproval?.status === "Closure Requested",
      isOverdue: isOverdue(wo.status, startingIso),
    };
  });

  return {
    rows,
    summary: {
      total: rows.length,
      open: rows.filter((r) => !TERMINAL_STATUSES.includes(r.status)).length,
      closureRequested: rows.filter((r) => r.isClosureRequested).length,
      closed: rows.filter((r) => r.status === "Closed").length,
      materialsPending: rows.filter((r) => MATERIALS_PENDING_STATUSES.includes(r.status)).length,
      overdue: rows.filter((r) => r.isOverdue).length,
    },
  };
}

// ─── Asset Repair History Report (Task 5) ──────────────────────────────────────

export type AssetRepairHistoryFilters = { from: string; to: string; division?: string; assetType?: string; assetId?: string };

export type AssetRepairHistoryRow = {
  id: string;
  asset_code: string;
  asset_name: string;
  asset_type: string;
  work_order_number: string | null;
  date_of_order: string;
  operator_complaint: string | null;
  description_of_work: string | null;
  status: string;
  closed_date: string | null;
};

export async function getAssetRepairHistoryPrintReport(context: CurrentUserContext, filters: AssetRepairHistoryFilters) {
  const visibility = getWorkOrderVisibilityFilter(context);
  const where = {
    deleted_at: null,
    asset_id: { not: null },
    ...dateRangeWhere(filters.from, filters.to),
    ...divisionWhere(filters.division),
    ...(filters.assetId ? { asset_id: filters.assetId } : {}),
    ...(filters.assetType ? { assets: { category: filters.assetType } } : {}),
    ...(Object.keys(visibility).length ? { AND: [visibility] } : {}),
  };

  const raw = await prisma.work_orders.findMany({
    where,
    select: {
      id: true,
      work_order_number: true,
      date_of_order: true,
      operator_complaint: true,
      description_of_work: true,
      status: true,
      assets: { select: { asset_code: true, asset_name: true, category: true } },
      approvals: { orderBy: { decided_at: "desc" }, take: 1, select: { status: true, decided_at: true } },
    },
    orderBy: [{ date_of_order: "desc" }],
    take: 2000,
  });

  const rows: AssetRepairHistoryRow[] = raw
    .filter((wo) => wo.assets)
    .map((wo) => {
      const asset = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets!;
      const latestApproval = wo.approvals[0] ?? null;
      return {
        id: wo.id,
        asset_code: asset.asset_code,
        asset_name: asset.asset_name,
        asset_type: asset.category,
        work_order_number: wo.work_order_number,
        date_of_order: wo.date_of_order.toISOString(),
        operator_complaint: wo.operator_complaint,
        description_of_work: wo.description_of_work,
        status: wo.status,
        closed_date: wo.status === "Closed" && latestApproval?.status === "Closed" ? latestApproval.decided_at.toISOString() : null,
      };
    })
    // Asset Code, then most recent first within an asset.
    .sort((a, b) => a.asset_code.localeCompare(b.asset_code) || (a.date_of_order < b.date_of_order ? 1 : -1));

  const assetCounts = new Map<string, number>();
  for (const r of rows) assetCounts.set(r.asset_code, (assetCounts.get(r.asset_code) ?? 0) + 1);
  const repeatedRepairCount = [...assetCounts.values()].filter((n) => n > 1).length;

  return {
    rows,
    summary: {
      totalRepairJobs: rows.length,
      totalClosedJobs: rows.filter((r) => r.status === "Closed").length,
      activeJobs: rows.filter((r) => !TERMINAL_STATUSES.includes(r.status)).length,
      repeatedRepairCount,
    },
  };
}

// ─── Materials Usage Report (Task 6) ───────────────────────────────────────────

export type MaterialsUsageFilters = { from: string; to: string; division?: string; assetType?: string; material?: string };

export type MaterialsUsageRow = {
  id: string;
  date: string;
  work_order_number: string | null;
  asset_label: string;
  division: string;
  material_name: string;
  quantity: number;
  unit: string;
  reference: string | null;
  unit_price: number;
  amount: number;
};

// Same source (work_order_materials) the existing screen "Materials Usage"
// report (lib/reports/data.ts's getSparePartsUsageReport) already uses —
// kept consistent on purpose so the printed figures never disagree with the
// on-screen ones for the same date range.
export async function getMaterialsUsagePrintReport(
  context: CurrentUserContext,
  filters: MaterialsUsageFilters,
  canViewCosts: boolean
) {
  const visibility = getWorkOrderVisibilityFilter(context);
  const workOrderWhere = {
    deleted_at: null,
    ...dateRangeWhere(filters.from, filters.to),
    ...divisionWhere(filters.division),
    ...(filters.assetType ? { assets: { category: filters.assetType } } : {}),
    ...(Object.keys(visibility).length ? { AND: [visibility] } : {}),
  };

  const raw = await prisma.work_order_materials.findMany({
    where: {
      work_orders: workOrderWhere,
      ...(filters.material
        ? {
            OR: [
              { material_name: { contains: filters.material, mode: "insensitive" as const } },
              { part_number: { contains: filters.material, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      material_name: true,
      part_number: true,
      ss_rec_code: true,
      quantity: true,
      unit_price: true,
      amount: true,
      parts: { select: { unit_of_measure: true } },
      work_orders: {
        select: {
          work_order_number: true,
          date_of_order: true,
          worker_type: true,
          assets: { select: { asset_code: true, asset_name: true } },
        },
      },
    },
    orderBy: { created_at: "desc" },
    take: 3000,
  });

  const rows: MaterialsUsageRow[] = raw.map((m) => {
    const asset = Array.isArray(m.work_orders.assets) ? m.work_orders.assets[0] : m.work_orders.assets;
    return {
      id: m.id,
      date: m.work_orders.date_of_order.toISOString(),
      work_order_number: m.work_orders.work_order_number,
      asset_label: asset ? `${asset.asset_code} - ${asset.asset_name}` : "Not recorded",
      division: m.work_orders.worker_type,
      material_name: m.material_name,
      quantity: Number(m.quantity),
      unit: m.parts?.unit_of_measure ?? "—",
      reference: m.part_number ?? m.ss_rec_code ?? null,
      // Task 10 — zeroed at the data layer (not just hidden by the print
      // page's own JSX) for anyone without cost permission, same pattern
      // this app already uses for Inventory/Worker Salary cost fields.
      unit_price: canViewCosts ? Number(m.unit_price) : 0,
      amount: canViewCosts ? Number(m.amount ?? 0) : 0,
    };
  });

  const totalQuantity = rows.reduce((sum, r) => sum + r.quantity, 0);
  const totalValue = canViewCosts ? rows.reduce((sum, r) => sum + r.amount, 0) : 0;

  const byMaterial = new Map<string, number>();
  for (const r of rows) byMaterial.set(r.material_name, (byMaterial.get(r.material_name) ?? 0) + r.quantity);
  const topMaterial = [...byMaterial.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  return {
    rows,
    summary: {
      totalQuantity,
      totalLines: rows.length,
      totalValue,
      topMaterial: topMaterial ? { name: topMaterial[0], quantity: topMaterial[1] } : null,
    },
  };
}

// ─── Technician Workload Report (Unit 10G.70, Task 2) ──────────────────────────

export type TechnicianWorkloadFilters = { from: string; to: string; division?: string; workerType?: string; workerId?: string };

export type TechnicianWorkloadRow = {
  id: string;
  name: string;
  employee_id: string | null;
  worker_type: string;
  skill_category: string | null;
  assignedJobCards: number;
  completedJobCards: number;
  activeJobCards: number;
  totalHours: number;
  currentStatus: "Active" | "Paused" | "Not Working";
  hourlyRate: number;
  laborCost: number;
};

const COMPLETED_JOB_CARD_STATUSES = ["Closed", "Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"];
const CANCELLED_ISH_JOB_CARD_STATUSES = ["Cancelled", "Rejected"];

// Reads (never recomputes) worker_id assignments' own already-stored
// duration_minutes/calculated_amount — this report only sums figures the
// existing worker-timer/labor-cost logic already produced (Unit 8's
// WorkOrderWorkSession.calculated_amount), per this unit's own "do not
// change Worker salary/cost calculation logic" instruction. hourlyRate/
// laborCost are zeroed here (not just hidden by the print page's JSX) for
// a caller without cost permission, same pattern as
// getMaterialsUsagePrintReport's own canViewCosts parameter.
export async function getTechnicianWorkloadPrintReport(filters: TechnicianWorkloadFilters, canViewLaborCost: boolean) {
  const workers = await prisma.workerProfile.findMany({
    where: {
      ...(filters.division ? { skill_category: filters.division } : {}),
      ...(filters.workerType ? { worker_type: filters.workerType } : {}),
      ...(filters.workerId ? { id: filters.workerId } : {}),
    },
    select: {
      id: true,
      name: true,
      employee_id: true,
      worker_type: true,
      skill_category: true,
      hourly_rate: true,
      assignments: {
        where: { work_orders: { deleted_at: null, ...dateRangeWhere(filters.from, filters.to) } },
        select: {
          work_orders: { select: { status: true } },
          work_sessions: { select: { duration_minutes: true, calculated_amount: true, status: true } },
        },
      },
    },
    orderBy: { name: "asc" },
    take: 1000,
  });

  const allRows: TechnicianWorkloadRow[] = workers.map((w) => {
    let completed = 0;
    let active = 0;
    let totalMinutes = 0;
    let laborCost = 0;
    let hasActiveSession = false;
    let hasPausedSession = false;

    for (const a of w.assignments) {
      const status = a.work_orders.status;
      if (COMPLETED_JOB_CARD_STATUSES.includes(status)) completed += 1;
      else if (!CANCELLED_ISH_JOB_CARD_STATUSES.includes(status)) active += 1;

      for (const s of a.work_sessions) {
        // Same "Cancelled" exclusion lib/work-orders/work-session-totals.ts
        // already applies when summing logged time — reused, not reinvented.
        if (s.status !== "Cancelled") totalMinutes += s.duration_minutes;
        laborCost += Number(s.calculated_amount);
        if (s.status === "Active") hasActiveSession = true;
        if (s.status === "Paused") hasPausedSession = true;
      }
    }

    return {
      id: w.id,
      name: w.name,
      employee_id: w.employee_id,
      worker_type: w.worker_type,
      skill_category: w.skill_category,
      assignedJobCards: w.assignments.length,
      completedJobCards: completed,
      activeJobCards: active,
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
      currentStatus: hasActiveSession ? "Active" : hasPausedSession ? "Paused" : "Not Working",
      hourlyRate: canViewLaborCost ? Number(w.hourly_rate) : 0,
      laborCost: canViewLaborCost ? Math.round(laborCost * 1000) / 1000 : 0,
    };
  });

  // Only list a worker with zero activity in this date range when a
  // specific Worker was selected (so picking one and seeing "no work this
  // period" is still meaningful) — otherwise a workload report naturally
  // shows only workers who actually had workload.
  const rows = allRows.filter((r) => r.assignedJobCards > 0 || !!filters.workerId);

  return {
    rows,
    summary: {
      totalWorkers: rows.length,
      assignedJobCards: rows.reduce((s, r) => s + r.assignedJobCards, 0),
      completedJobCards: rows.reduce((s, r) => s + r.completedJobCards, 0),
      totalWorkHours: Math.round(rows.reduce((s, r) => s + r.totalHours, 0) * 100) / 100,
      activeWorkers: rows.filter((r) => r.currentStatus === "Active").length,
      pausedWorkers: rows.filter((r) => r.currentStatus === "Paused").length,
    },
  };
}

// ─── Asset Register Report (Unit 10G.71, Task 2) ───────────────────────────────

export type AssetRegisterFilters = {
  assetType?: string;
  status?: string;
  siteMovement?: string; // "available" | "at_site" | "overdue"
  expiry?: string; // "expired" | "expiring_30" | "valid"
};

export type AssetRegisterRow = {
  id: string;
  asset_code: string;
  asset_name: string;
  category: string;
  plate_number: string | null;
  chassis_number: string | null;
  currentLocation: string | null;
  responsiblePerson: string | null;
  status: string;
  siteMovementStatus: "Available" | "At Site" | "Overdue Return";
  expectedReturnDate: string | null;
  expiryDate: string | null;
  expiryStatus: "Expired" | "Expiring Soon" | "Valid" | "None";
};

const ACTIVE_MAINTENANCE_STATUSES = ["Under Maintenance", "Waiting for Parts", "Breakdown"];

// Reads getActiveMovementsByAsset()/getMovementBadge() — the exact same Unit
// 10G.65 functions the live Assets list already uses for its own Site
// Movement badge — rather than recomputing that logic, per this unit's own
// "do not change Asset movement workflow" instruction. "Expiry"/"Expiry
// Date" is the EARLIEST of the asset's three separate expiry dates
// (registration/insurance/warranty), since the task asks for one unified
// Expiry column and filter rather than three.
export async function getAssetRegisterPrintReport(filters: AssetRegisterFilters) {
  const raw = await prisma.assets.findMany({
    where: {
      deleted_at: null,
      ...(filters.assetType ? { category: filters.assetType } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    select: {
      id: true,
      asset_code: true,
      asset_name: true,
      category: true,
      plate_number: true,
      chassis_number: true,
      location: true,
      assigned_operator_driver: true,
      status: true,
      registration_expiry_date: true,
      insurance_expiry_date: true,
      warranty_expiry_date: true,
    },
    orderBy: { asset_code: "asc" },
    take: 2000,
  });

  const activeMovements = await getActiveMovementsByAsset();
  const today = new Date();

  const allRows: AssetRegisterRow[] = raw.map((a) => {
    const active = activeMovements.get(a.id) ?? null;
    const badge = getMovementBadge(active);
    const siteMovementStatus: AssetRegisterRow["siteMovementStatus"] = !active
      ? "Available"
      : badge?.label === "Overdue"
        ? "Overdue Return"
        : "At Site";

    const expiryDates = [a.registration_expiry_date, a.insurance_expiry_date, a.warranty_expiry_date].filter(
      (d): d is Date => d !== null
    );
    const nearestExpiry = expiryDates.length
      ? new Date(Math.min(...expiryDates.map((d) => d.getTime())))
      : null;
    let expiryStatus: AssetRegisterRow["expiryStatus"] = "None";
    if (nearestExpiry) {
      const days = daysBetween(today, nearestExpiry);
      expiryStatus = days < 0 ? "Expired" : days <= 30 ? "Expiring Soon" : "Valid";
    }

    return {
      id: a.id,
      asset_code: a.asset_code,
      asset_name: a.asset_name,
      category: a.category,
      plate_number: a.plate_number,
      chassis_number: a.chassis_number,
      currentLocation: active?.to_location ?? a.location,
      responsiblePerson: a.assigned_operator_driver,
      status: a.status,
      siteMovementStatus,
      expectedReturnDate: active?.expected_return_date ?? null,
      expiryDate: nearestExpiry ? nearestExpiry.toISOString() : null,
      expiryStatus,
    };
  });

  // Site Movement / Expiry are both derived (not raw columns), so they're
  // filtered here in JS after the batch movement lookup, same convention
  // Unit 10G.70's Inventory Control print report already uses for its own
  // derived "Needs Attention" bucket.
  const rows = allRows.filter((r) => {
    if (filters.siteMovement === "available" && r.siteMovementStatus !== "Available") return false;
    if (filters.siteMovement === "at_site" && r.siteMovementStatus !== "At Site") return false;
    if (filters.siteMovement === "overdue" && r.siteMovementStatus !== "Overdue Return") return false;
    if (filters.expiry === "expired" && r.expiryStatus !== "Expired") return false;
    if (filters.expiry === "expiring_30" && r.expiryStatus !== "Expiring Soon") return false;
    if (filters.expiry === "valid" && r.expiryStatus !== "Valid") return false;
    return true;
  });

  return {
    rows,
    summary: {
      totalAssets: rows.length,
      activeAssets: rows.filter((r) => r.status === "Active").length,
      atSite: rows.filter((r) => r.siteMovementStatus === "At Site").length,
      overdueReturn: rows.filter((r) => r.siteMovementStatus === "Overdue Return").length,
      expiredOrExpiringSoon: rows.filter((r) => r.expiryStatus === "Expired" || r.expiryStatus === "Expiring Soon").length,
      activeMaintenance: rows.filter((r) => ACTIVE_MAINTENANCE_STATUSES.includes(r.status)).length,
    },
  };
}

// ─── Materials Requests Report (Unit 10G.71, Task 3) ───────────────────────────

export type MaterialsRequestsFilters = {
  from: string;
  to: string;
  requestType?: string; // "job_card" | "general"
  status?: string; // "pending" | "completed" | "cancelled"
  division?: string;
};

export type MaterialsRequestRow = {
  id: string;
  requestNumber: string | null;
  requestType: "Job Card Request" | "General Inventory Request";
  date: string;
  requestedBy: string | null;
  jobCardOrPurpose: string;
  assetLabel: string | null;
  division: string | null;
  status: string;
  statusBucket: "Pending" | "Completed" | "Cancelled";
  itemsCount: number;
  completedDate: string | null;
  value: number;
};

const JOB_CARD_REQUEST_COMPLETED_STATUSES = ["Issued", "Closed"];
const JOB_CARD_REQUEST_CANCELLED_STATUSES = ["Cancelled", "Rejected"];

function createdAtRangeWhere(from: string, to: string) {
  return { created_at: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T23:59:59.999Z`) } };
}

// A plain raw-status classification (not lib/display/parts-request-
// labels-display.ts's own displayPartsRequestStatus, which folds
// Cancelled/Rejected into the 2-value Requested/Received list-page grouping
// and would misclassify a cancelled request as "Completed") — this report
// needs a genuine 3-way Pending/Completed/Cancelled bucket per Task 3's own
// filter list.
function jobCardRequestBucket(status: string): "Pending" | "Completed" | "Cancelled" {
  if (JOB_CARD_REQUEST_COMPLETED_STATUSES.includes(status)) return "Completed";
  if (JOB_CARD_REQUEST_CANCELLED_STATUSES.includes(status)) return "Cancelled";
  return "Pending";
}

function generalRequestBucket(status: string): "Pending" | "Completed" | "Cancelled" {
  if (status === "Completed") return "Completed";
  if (status === "Cancelled") return "Cancelled";
  return "Pending";
}

const STATUS_FILTER_BUCKET: Record<string, "Pending" | "Completed" | "Cancelled"> = {
  pending: "Pending",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Combines two independent request sources into one printable list — Job
// Card materials requests (parts_requests, always linked to a work order)
// and General Inventory / Stock requests (general_inventory_requests, never
// linked to a work order or asset). Each source keeps its own existing
// visibility rule unchanged: getPartsRequestVisibilityFilter for
// parts_requests; the same canSeeAllGeneral role check the live
// /store/parts-requests screen already uses for general_inventory_requests
// (duplicated here rather than exported from that page, since it's a 4-line
// role check, not shared logic). Division only applies to Job Card requests
// (work_orders.worker_type) — General Inventory requests have no Division
// concept, so they're never excluded by this filter, per Task 3's own
// "Division if relevant for Job Card linked requests" wording.
export async function getMaterialsRequestsPrintReport(
  context: CurrentUserContext,
  filters: MaterialsRequestsFilters,
  canViewCosts: boolean
) {
  const includeJobCard = filters.requestType !== "general";
  const includeGeneral = filters.requestType !== "job_card";

  const jobCardRowsPromise = includeJobCard
    ? prisma.parts_requests.findMany({
        where: {
          AND: [
            getPartsRequestVisibilityFilter(context),
            createdAtRangeWhere(filters.from, filters.to),
            filters.division
              ? { work_orders: { worker_type: filters.division === "Not specified" ? "" : filters.division } }
              : {},
          ],
        },
        select: {
          id: true,
          parts_request_number: true,
          created_at: true,
          status: true,
          total_price: true,
          work_orders: { select: { work_order_number: true, worker_type: true } },
          assets: { select: { asset_code: true, asset_name: true } },
          profiles_parts_requests_requested_byToprofiles: { select: { full_name: true } },
          _count: { select: { parts_request_items: true } },
        },
        orderBy: { created_at: "desc" },
        take: 2000,
      })
    : Promise.resolve([]);

  const canSeeAllGeneral =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("store.issue") ||
    context.permissions.includes("work_orders.approve") ||
    context.permissions.includes("work_orders.manage");

  const generalRowsPromise = includeGeneral
    ? prisma.general_inventory_requests.findMany({
        where: {
          AND: [
            canSeeAllGeneral ? {} : { requested_by_id: context.userId },
            createdAtRangeWhere(filters.from, filters.to),
          ],
        },
        select: {
          id: true,
          request_number: true,
          created_at: true,
          status: true,
          purpose: true,
          requested_by_name: true,
          completed_at: true,
          items: { select: { total_price: true } },
          _count: { select: { items: true } },
        },
        orderBy: { created_at: "desc" },
        take: 2000,
      })
    : Promise.resolve([]);

  const [jobCardRaw, generalRaw] = await Promise.all([jobCardRowsPromise, generalRowsPromise]);

  const jobCardRows: MaterialsRequestRow[] = jobCardRaw.map((r) => ({
    id: r.id,
    requestNumber: r.parts_request_number,
    requestType: "Job Card Request",
    date: r.created_at.toISOString(),
    requestedBy: r.profiles_parts_requests_requested_byToprofiles?.full_name ?? null,
    jobCardOrPurpose: r.work_orders?.work_order_number ?? "—",
    assetLabel: r.assets ? `${r.assets.asset_code} - ${r.assets.asset_name}` : null,
    division: r.work_orders?.worker_type ?? null,
    status: r.status,
    statusBucket: jobCardRequestBucket(r.status),
    itemsCount: r._count.parts_request_items,
    completedDate: null,
    // Task 7 — zeroed at the data layer for anyone without cost permission,
    // same pattern every other print report's cost field already uses.
    value: canViewCosts ? Number(r.total_price) : 0,
  }));

  const generalRows: MaterialsRequestRow[] = generalRaw.map((r) => ({
    id: r.id,
    requestNumber: r.request_number,
    requestType: "General Inventory Request",
    date: r.created_at.toISOString(),
    requestedBy: r.requested_by_name,
    jobCardOrPurpose: r.purpose,
    assetLabel: null,
    division: null,
    status: r.status,
    statusBucket: generalRequestBucket(r.status),
    itemsCount: r._count.items,
    completedDate: r.completed_at?.toISOString() ?? null,
    value: canViewCosts ? r.items.reduce((sum, i) => sum + Number(i.total_price ?? 0), 0) : 0,
  }));

  const allRows = [...jobCardRows, ...generalRows]
    .filter((r) => (filters.status ? r.statusBucket === STATUS_FILTER_BUCKET[filters.status] : true))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    rows: allRows,
    summary: {
      totalRequests: allRows.length,
      pending: allRows.filter((r) => r.statusBucket === "Pending").length,
      completed: allRows.filter((r) => r.statusBucket === "Completed").length,
      cancelled: allRows.filter((r) => r.statusBucket === "Cancelled").length,
      jobCardRequests: allRows.filter((r) => r.requestType === "Job Card Request").length,
      generalInventoryRequests: allRows.filter((r) => r.requestType === "General Inventory Request").length,
    },
  };
}

// ─── Service Contracts Expiry Report (Unit 10G.71, Task 4) ─────────────────────

export type ServiceContractsExpiryFilters = {
  expiryRange?: string; // "30" | "60" | "90" | "expired" | "custom"
  customFrom?: string;
  customTo?: string;
  status?: string; // "Active" | "Expired" | "Cancelled"
  vendor?: string;
  assetType?: string;
};

export type ServiceContractRow = {
  id: string;
  contractNumber: string | null;
  contractTitle: string;
  vendor: string;
  assetLabel: string | null;
  assetType: string | null;
  startDate: string;
  endDate: string;
  daysRemaining: number;
  statusLabel: string;
  statusTone: "green" | "amber" | "red" | "gray";
  remarks: string | null;
};

// Reuses computeContractStatus() — the exact same function the live
// /assets/service-contracts screen already uses for its Active/Expiring
// Soon/Expired badge and days-remaining figure — rather than recomputing
// expiry math. No contract "value/cost" field exists on service_contracts
// (confirmed against prisma/schema.prisma), so there is nothing to gate by
// cost permission here (Task 7's "any contract value if present" — none is
// present in this schema).
export async function getServiceContractsExpiryPrintReport(filters: ServiceContractsExpiryFilters) {
  const raw = await prisma.service_contracts.findMany({
    where: {
      deleted_at: null,
      ...(filters.vendor ? { service_company: filters.vendor } : {}),
      ...(filters.assetType ? { assets: { category: filters.assetType } } : {}),
    },
    select: {
      id: true,
      contract_number: true,
      contract_title: true,
      service_company: true,
      start_date: true,
      end_date: true,
      contract_status: true,
      remarks: true,
      assets: { select: { asset_code: true, asset_name: true, category: true } },
    },
    orderBy: { end_date: "asc" },
    take: 2000,
  });

  const allRows = raw.map((c) => {
    const meta = computeContractStatus(c.end_date, c.contract_status);
    return {
      id: c.id,
      contractNumber: c.contract_number,
      contractTitle: c.contract_title,
      vendor: c.service_company,
      assetLabel: c.assets ? `${c.assets.asset_code} - ${c.assets.asset_name}` : null,
      assetType: c.assets?.category ?? null,
      startDate: c.start_date.toISOString(),
      endDate: c.end_date.toISOString(),
      daysRemaining: meta.days,
      statusLabel: meta.label,
      statusTone: meta.tone,
      remarks: c.remarks,
      rawStatus: c.contract_status,
    };
  });

  const filtered = allRows.filter((r) => {
    if (filters.status === "Active" && r.rawStatus !== "Active") return false;
    if (filters.status === "Expired" && r.statusLabel !== "Expired") return false;
    if (filters.status === "Cancelled" && r.rawStatus !== "Cancelled") return false;

    if (filters.expiryRange === "custom") {
      if (filters.customFrom && r.endDate.slice(0, 10) < filters.customFrom) return false;
      if (filters.customTo && r.endDate.slice(0, 10) > filters.customTo) return false;
      return true;
    }
    if (filters.expiryRange && filters.expiryRange !== "custom") {
      // Days-based ranges only make sense for a contract whose status is
      // still Active — a Cancelled contract has no meaningful "days
      // remaining" (computeContractStatus itself returns days: 0 for it).
      if (r.rawStatus !== "Active") return false;
      if (filters.expiryRange === "expired") return r.statusLabel === "Expired";
      const window = Number(filters.expiryRange);
      return r.daysRemaining >= 0 && r.daysRemaining <= window;
    }
    return true;
  });

  const rows: ServiceContractRow[] = filtered.map(({ rawStatus: _rawStatus, ...rest }) => rest);

  return {
    rows,
    summary: {
      totalContracts: filtered.length,
      activeContracts: filtered.filter((r) => r.statusLabel === "Active").length,
      expiring30: filtered.filter((r) => r.rawStatus === "Active" && r.daysRemaining >= 0 && r.daysRemaining <= 30).length,
      expiring60: filtered.filter((r) => r.rawStatus === "Active" && r.daysRemaining >= 0 && r.daysRemaining <= 60).length,
      expiredContracts: filtered.filter((r) => r.statusLabel === "Expired").length,
    },
  };
}
