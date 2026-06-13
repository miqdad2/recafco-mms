import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export type ReportMode =
  | "pending-approvals"
  | "overdue"
  | "waiting-parts"
  | "asset-history"
  | "monthly-summary"
  | "technician-workload";

export type ReportFilters = {
  dateFrom?: string;
  dateTo?: string;
  departmentId?: string;
  assetId?: string;
  status?: string;
  statusIn?: string[];
  overdueOnly?: boolean;
  maintenanceType?: string;
  workerType?: string;
  technicianId?: string;
  priority?: string;
  costMin?: number;
  costMax?: number;
};

export type FilterOptions = {
  departments: Array<{ id: string; name: string }>;
  assets: Array<{ id: string; asset_code: string; asset_name: string }>;
  technicians: Array<{ id: string; full_name: string }>;
};

export function parseReportFilters(searchParams: Record<string, string | string[] | undefined>): ReportFilters {
  const value = (key: string) => {
    const raw = searchParams[key];
    return Array.isArray(raw) ? raw[0] : raw;
  };
  const costMin = Number(value("costMin"));
  const costMax = Number(value("costMax"));
  return {
    dateFrom: value("dateFrom") || undefined,
    dateTo: value("dateTo") || undefined,
    departmentId: value("departmentId") || undefined,
    assetId: value("assetId") || undefined,
    status: value("status") || undefined,
    maintenanceType: value("maintenanceType") || undefined,
    workerType: value("workerType") || undefined,
    technicianId: value("technicianId") || undefined,
    priority: value("priority") || undefined,
    costMin: Number.isFinite(costMin) ? costMin : undefined,
    costMax: Number.isFinite(costMax) ? costMax : undefined
  };
}

export function canViewCosts(context: CurrentUserContext) {
  return (
    context.role?.slug === "super_admin" ||
    context.permissions.includes("costs.view") ||
    context.permissions.includes("finance.reports.view") ||
    context.permissions.includes("cost.reports.view")
  );
}

export async function getFilterOptions(): Promise<FilterOptions> {
  const [departments, assets, profiles] = await Promise.all([
    prisma.departments.findMany({ where: { is_active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.assets.findMany({ where: { deleted_at: null }, select: { id: true, asset_code: true, asset_name: true }, orderBy: { asset_code: "asc" } }),
    prisma.profiles.findMany({ where: { is_active: true }, select: { id: true, full_name: true, roles: { select: { slug: true } } }, orderBy: { full_name: "asc" } })
  ]);
  return {
    departments,
    assets,
    technicians: profiles
      .filter((p) => p.roles?.slug === "technician")
      .map((p) => ({ id: p.id, full_name: p.full_name }))
  };
}

export function parseReportMode(raw: string | string[] | undefined): ReportMode {
  const v = Array.isArray(raw) ? raw[0] : (raw ?? "");
  const modes: ReportMode[] = ["pending-approvals", "overdue", "waiting-parts", "asset-history", "monthly-summary", "technician-workload"];
  return modes.includes(v as ReportMode) ? (v as ReportMode) : "pending-approvals";
}

export async function getMgrFilterOptions(deptId: string): Promise<FilterOptions> {
  const [depts, assets, profiles] = await Promise.all([
    prisma.departments.findMany({ where: { id: deptId, is_active: true }, select: { id: true, name: true } }),
    prisma.assets.findMany({ where: { deleted_at: null, department_id: deptId }, select: { id: true, asset_code: true, asset_name: true }, orderBy: { asset_code: "asc" } }),
    prisma.profiles.findMany({ where: { is_active: true }, select: { id: true, full_name: true, roles: { select: { slug: true } } }, orderBy: { full_name: "asc" } })
  ]);
  return {
    departments: depts,
    assets,
    technicians: profiles
      .filter((p) => p.roles?.slug === "technician")
      .map((p) => ({ id: p.id, full_name: p.full_name }))
  };
}

export async function getWorkOrderReport(filters: ReportFilters) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { deleted_at: null };
  if (filters.dateFrom || filters.dateTo) {
    where.date_of_order = {};
    if (filters.dateFrom) where.date_of_order.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.date_of_order.lte = new Date(filters.dateTo);
  }
  if (filters.departmentId) where.requested_by_department_id = filters.departmentId;
  if (filters.assetId) where.asset_id = filters.assetId;
  if (filters.statusIn?.length) {
    where.status = { in: filters.statusIn };
  } else if (filters.overdueOnly) {
    where.starting_datetime = { lt: new Date() };
    where.status = { in: ["Approved", "Assigned", "In Progress", "Waiting for Parts", "Waiting for Purchase"] };
  } else if (filters.status) {
    where.status = filters.status;
  }
  if (filters.maintenanceType) where.maintenance_type = filters.maintenanceType;
  if (filters.workerType) where.worker_type = filters.workerType;
  if (filters.priority) where.priority = filters.priority;
  if (filters.costMin !== undefined || filters.costMax !== undefined) {
    where.total_work_order_cost = {};
    if (filters.costMin !== undefined) where.total_work_order_cost.gte = filters.costMin;
    if (filters.costMax !== undefined) where.total_work_order_cost.lte = filters.costMax;
  }

  const rawRows = await prisma.work_orders.findMany({
    where,
    include: {
      departments: { select: { name: true } },
      assets: { select: { asset_code: true, asset_name: true } },
      work_order_assignments: { select: { technician_id: true, profiles: { select: { full_name: true } } } }
    },
    orderBy: { date_of_order: "desc" }
  }).then((rows) =>
    rows.map((row) => ({
      ...row,
      date_of_order: row.date_of_order.toISOString(),
      starting_datetime: row.starting_datetime?.toISOString() ?? null,
      ending_datetime: row.ending_datetime?.toISOString() ?? null,
      next_service_date: row.next_service_date?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      deleted_at: row.deleted_at?.toISOString() ?? null,
      running_hours: row.running_hours?.toFixed(2) ?? null,
      kilometers: row.kilometers?.toFixed(2) ?? null,
      total_labor_cost: row.total_labor_cost.toFixed(3),
      total_material_cost: row.total_material_cost.toFixed(3),
      total_work_order_cost: row.total_work_order_cost?.toFixed(3) ?? null,
      next_service_kilometer: row.next_service_kilometer?.toFixed(2) ?? null,
      next_service_running_hours: row.next_service_running_hours?.toFixed(2) ?? null
    }))
  ).catch(() => []);

  const rows = rawRows.filter((row) => {
    if (!filters.technicianId) return true;
    return row.work_order_assignments?.some((a) => a.technician_id === filters.technicianId);
  });

  return {
    rows,
    stats: {
      total: rows.length,
      open: rows.filter((row) => !["Closed", "Cancelled", "Rejected"].includes(row.status)).length,
      closed: rows.filter((row) => row.status === "Closed").length,
      overdue: rows.filter((row) => row.next_service_date && new Date(row.next_service_date) < new Date() && row.status !== "Closed").length,
      pendingApprovals: rows.filter((row) => ["Submitted", "Pending Approval"].includes(row.status)).length,
      waitingForParts: rows.filter((row) => row.status === "Waiting for Parts").length,
      waitingForPurchase: rows.filter((row) => row.status === "Waiting for Purchase").length,
      completedByTechnician: rows.filter((row) => row.status === "Completed by Technician").length,
      verifiedBySupervisor: rows.filter((row) => row.status === "Verified by Supervisor").length
    },
    byStatus: groupBy(rows, "status"),
    byType: groupBy(rows, "maintenance_type"),
    byDepartment: groupBy(rows, (row) => relationName(row.departments)),
    monthlyTrend: groupBy(rows, (row) => String(row.date_of_order ?? "").slice(0, 7) || "No date")
  };
}

export async function getAssetReport(filters: ReportFilters) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { deleted_at: null };
  if (filters.departmentId) where.department_id = filters.departmentId;
  if (filters.assetId) where.id = filters.assetId;
  if (filters.status) where.status = filters.status;

  const rows = await prisma.assets.findMany({
    where,
    include: {
      departments: { select: { name: true } },
      work_orders: { select: { id: true, status: true, maintenance_type: true, total_work_order_cost: true } }
    },
    orderBy: { asset_code: "asc" }
  }).then((rawRows) => rawRows.map((row) => ({
    ...row,
    purchase_date: row.purchase_date?.toISOString() ?? null,
    warranty_expiry_date: row.warranty_expiry_date?.toISOString() ?? null,
    registration_expiry_date: row.registration_expiry_date?.toISOString() ?? null,
    insurance_expiry_date: row.insurance_expiry_date?.toISOString() ?? null,
    next_service_date: row.next_service_date?.toISOString() ?? null,
    current_kilometer_reading: row.current_kilometer_reading?.toFixed(2) ?? null,
    current_running_hours: row.current_running_hours?.toFixed(2) ?? null,
    next_service_kilometer: row.next_service_kilometer?.toFixed(2) ?? null,
    next_service_running_hours: row.next_service_running_hours?.toFixed(2) ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    deleted_at: row.deleted_at?.toISOString() ?? null
  }))).catch(() => []);

  const today = new Date();
  const in30 = new Date(today);
  in30.setDate(today.getDate() + 30);
  return {
    rows,
    stats: {
      total: rows.length,
      underMaintenance: rows.filter((row) => row.status === "Under Maintenance").length,
      waitingForParts: rows.filter((row) => row.status === "Waiting for Parts").length,
      breakdown: rows.filter((row) => row.status === "Breakdown").length,
      nextServiceDue: rows.filter((row) => isDateBetween(row.next_service_date, today, in30)).length,
      registrationExpiry: rows.filter((row) => isDateBetween(row.registration_expiry_date, today, in30)).length,
      insuranceExpiry: rows.filter((row) => isDateBetween(row.insurance_expiry_date, today, in30)).length,
      warrantyExpiry: rows.filter((row) => isDateBetween(row.warranty_expiry_date, today, in30)).length
    },
    topBreakdownAssets: rows
      .map((row) => ({ ...row, breakdownCount: row.work_orders.filter((wo) => wo.maintenance_type === "Breakdown").length }))
      .sort((a, b) => b.breakdownCount - a.breakdownCount)
      .slice(0, 10)
  };
}

export async function getCostReport(filters: ReportFilters) {
  const [workOrders, parts, purchases] = await Promise.all([getWorkOrderReport(filters), getPartsInventoryRows(), getPurchaseRows()]);
  const rows = workOrders.rows;
  return {
    rows,
    parts,
    purchases,
    stats: {
      totalCost: sum(rows, "total_work_order_cost"),
      laborCost: sum(rows, "total_labor_cost"),
      materialCost: sum(rows, "total_material_cost"),
      purchaseCost: sum(purchases, "estimated_total")
    },
    byDepartment: sumBy(rows, (row) => relationName(row.departments), "total_work_order_cost"),
    byAsset: sumBy(rows, (row) => {
      const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
      return asset ? `${asset.asset_code} - ${asset.asset_name}` : "No asset";
    }, "total_work_order_cost"),
    monthlyTrend: sumBy(rows, (row) => String(row.date_of_order ?? "").slice(0, 7) || "No date", "total_work_order_cost"),
    topExpensiveAssets: sumBy(rows, (row) => {
      const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
      return asset ? `${asset.asset_code} - ${asset.asset_name}` : "No asset";
    }, "total_work_order_cost").slice(0, 10),
    topUsedParts: parts.sort((a, b) => Number(b.current_stock ?? 0) - Number(a.current_stock ?? 0)).slice(0, 10)
  };
}

export async function getPreventiveReport(filters: ReportFilters) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { deleted_at: null };
  if (filters.departmentId) where.department_id = filters.departmentId;
  if (filters.assetId) where.id = filters.assetId;

  const rows = await prisma.assets.findMany({
    where,
    include: { departments: { select: { name: true } } },
    orderBy: { next_service_date: "asc" }
  }).then((rawRows) => rawRows.map((row) => ({
    ...row,
    purchase_date: row.purchase_date?.toISOString() ?? null,
    warranty_expiry_date: row.warranty_expiry_date?.toISOString() ?? null,
    registration_expiry_date: row.registration_expiry_date?.toISOString() ?? null,
    insurance_expiry_date: row.insurance_expiry_date?.toISOString() ?? null,
    next_service_date: row.next_service_date?.toISOString() ?? null,
    current_kilometer_reading: row.current_kilometer_reading?.toFixed(2) ?? null,
    current_running_hours: row.current_running_hours?.toFixed(2) ?? null,
    next_service_kilometer: row.next_service_kilometer?.toFixed(2) ?? null,
    next_service_running_hours: row.next_service_running_hours?.toFixed(2) ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    deleted_at: row.deleted_at?.toISOString() ?? null
  }))).catch(() => []);

  const today = new Date();
  const in7 = addDays(today, 7);
  const in15 = addDays(today, 15);
  const in30 = addDays(today, 30);
  return {
    rows,
    stats: {
      overdue: rows.filter((row) => row.next_service_date && new Date(row.next_service_date) < today).length,
      due7: rows.filter((row) => isDateBetween(row.next_service_date, today, in7)).length,
      due15: rows.filter((row) => isDateBetween(row.next_service_date, today, in15)).length,
      due30: rows.filter((row) => isDateBetween(row.next_service_date, today, in30)).length,
      dueByKm: rows.filter((row) => row.next_service_kilometer && row.current_kilometer_reading && Number(row.current_kilometer_reading) >= Number(row.next_service_kilometer)).length,
      dueByHours: rows.filter((row) => row.next_service_running_hours && row.current_running_hours && Number(row.current_running_hours) >= Number(row.next_service_running_hours)).length
    }
  };
}

export async function getPartsInventoryRows() {
  return prisma.parts.findMany({ where: { deleted_at: null }, orderBy: { part_code: "asc" } })
    .then((rows) => rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      deleted_at: row.deleted_at?.toISOString() ?? null
    }))).catch(() => []);
}

export async function getPartsRequestRows() {
  return prisma.parts_requests.findMany({
    include: {
      departments: { select: { name: true } },
      work_orders: { select: { work_order_number: true } },
      assets: { select: { asset_code: true, asset_name: true } }
    },
    orderBy: { created_at: "desc" }
  }).then((rows) => rows.map((row) => ({
    ...row,
    request_date: row.request_date.toISOString(),
    request_time: row.request_time.toISOString().slice(11, 19),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  }))).catch(() => []);
}

export async function getPurchaseRows() {
  return prisma.purchase_requests.findMany({ orderBy: { created_at: "desc" } })
    .then((rows) => rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      finance_approved_at: row.finance_approved_at?.toISOString() ?? null,
      ceo_approved_at: row.ceo_approved_at?.toISOString() ?? null
    }))).catch(() => []);
}

export async function getInventoryMovementRows() {
  return prisma.inventory_movements.findMany({
    include: { parts: { select: { part_code: true, part_name: true } } },
    orderBy: { created_at: "desc" }
  }).then((rows) => rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }))).catch(() => []);
}

function relationName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value;
  return typeof relation === "object" && relation && "name" in relation ? String(relation.name ?? "No department") : "No department";
}

function groupBy<T extends Record<string, unknown>>(rows: T[], key: keyof T | ((row: T) => string)) {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const label = typeof key === "function" ? key(row) : String(row[key] ?? "Not recorded");
    map.set(label, (map.get(label) ?? 0) + 1);
  });
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function sum<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function sumBy<T extends Record<string, unknown>>(rows: T[], labelFor: (row: T) => string, key: keyof T) {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const label = labelFor(row);
    map.set(label, (map.get(label) ?? 0) + Number(row[key] ?? 0));
  });
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(value.getDate() + days);
  return next;
}

function isDateBetween(value: Date | string | null | undefined, start: Date, end: Date) {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return date >= start && date <= end;
}

// ─── CEO Report ──────────────────────────────────────────────────────────────

export type CeoReportMode =
  | "executive-summary"
  | "ceo-approvals"
  | "cost-exposure"
  | "blocked-operations"
  | "department-performance"
  | "asset-risk";

export function parseCeoReportMode(raw: string | string[] | undefined): CeoReportMode {
  const v = Array.isArray(raw) ? raw[0] : (raw ?? "");
  const modes: CeoReportMode[] = [
    "executive-summary",
    "ceo-approvals",
    "cost-exposure",
    "blocked-operations",
    "department-performance",
    "asset-risk"
  ];
  return modes.includes(v as CeoReportMode) ? (v as CeoReportMode) : "executive-summary";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCeoPurchaseApprovals(filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "priority">): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { status: "Pending CEO Approval" };
  if (filters.dateFrom || filters.dateTo) {
    where.created_at = {};
    if (filters.dateFrom) where.created_at.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.created_at.lte = new Date(filters.dateTo);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = await prisma.purchase_requests.findMany({
    where,
    select: {
      id: true,
      purchase_request_number: true,
      supplier: true,
      status: true,
      estimated_total: true,
      created_at: true,
      work_orders: {
        select: {
          work_order_number: true,
          priority: true,
          departments: { select: { name: true } }
        }
      }
    },
    orderBy: { created_at: "asc" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }).then((rows) => rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }))).catch((): any[] => []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] = data;
  if (filters.priority) {
    rows = rows.filter((row) => {
      const wo = Array.isArray(row.work_orders) ? row.work_orders[0] : row.work_orders;
      return wo?.priority === filters.priority;
    });
  }
  return rows;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCeoAllPurchaseRows(filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "departmentId" | "costMin" | "costMax">): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (filters.dateFrom || filters.dateTo) {
    where.created_at = {};
    if (filters.dateFrom) where.created_at.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.created_at.lte = new Date(filters.dateTo);
  }
  if (filters.costMin !== undefined || filters.costMax !== undefined) {
    where.estimated_total = {};
    if (filters.costMin !== undefined) where.estimated_total.gte = filters.costMin;
    if (filters.costMax !== undefined) where.estimated_total.lte = filters.costMax;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = await prisma.purchase_requests.findMany({
    where,
    select: {
      id: true,
      purchase_request_number: true,
      supplier: true,
      status: true,
      estimated_total: true,
      created_at: true,
      work_orders: {
        select: {
          work_order_number: true,
          priority: true,
          requested_by_department_id: true,
          departments: { select: { name: true } }
        }
      }
    },
    orderBy: { created_at: "desc" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }).then((rows) => rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }))).catch((): any[] => []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] = data.filter((row: any) => !["Cancelled", "Rejected"].includes(row.status as string));
  if (filters.departmentId) {
    rows = rows.filter((row) => {
      const wo = Array.isArray(row.work_orders) ? row.work_orders[0] : row.work_orders;
      return wo?.requested_by_department_id === filters.departmentId;
    });
  }
  return rows;
}
