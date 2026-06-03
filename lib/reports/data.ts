import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ReportFilters = {
  dateFrom?: string;
  dateTo?: string;
  departmentId?: string;
  assetId?: string;
  status?: string;
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
  return context.role?.slug === "super_admin" || context.permissions.includes("costs.view") || context.permissions.includes("finance.reports.view");
}

export async function getFilterOptions(): Promise<FilterOptions> {
  const supabase = createSupabaseAdminClient();
  const [{ data: departments }, { data: assets }, { data: technicians }] = await Promise.all([
    supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
    supabase.from("assets").select("id, asset_code, asset_name").is("deleted_at", null).order("asset_code"),
    supabase.from("profiles").select("id, full_name, roles(slug)").eq("is_active", true).order("full_name")
  ]);

  return {
    departments: departments ?? [],
    assets: assets ?? [],
    technicians: (technicians ?? [])
      .filter((profile) => {
        const role = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
        return role?.slug === "technician";
      })
      .map((profile) => ({ id: profile.id, full_name: profile.full_name }))
  };
}

export async function getWorkOrderReport(filters: ReportFilters) {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("work_orders")
    .select("*, departments(name), assets(asset_code, asset_name), work_order_assignments(technician_id, profiles(full_name))")
    .is("deleted_at", null)
    .order("date_of_order", { ascending: false });

  if (filters.dateFrom) query = query.gte("date_of_order", filters.dateFrom);
  if (filters.dateTo) query = query.lte("date_of_order", filters.dateTo);
  if (filters.departmentId) query = query.eq("requested_by_department_id", filters.departmentId);
  if (filters.assetId) query = query.eq("asset_id", filters.assetId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.maintenanceType) query = query.eq("maintenance_type", filters.maintenanceType);
  if (filters.workerType) query = query.eq("worker_type", filters.workerType);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.costMin !== undefined) query = query.gte("total_work_order_cost", filters.costMin);
  if (filters.costMax !== undefined) query = query.lte("total_work_order_cost", filters.costMax);

  const { data } = await query;
  const rows = (data ?? []).filter((row) => {
    if (!filters.technicianId) return true;
    const assignments = row.work_order_assignments as Array<{ technician_id: string | null }> | null;
    return assignments?.some((assignment) => assignment.technician_id === filters.technicianId);
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
  const supabase = createSupabaseAdminClient();
  let query = supabase.from("assets").select("*, departments(name), work_orders(id, status, maintenance_type, total_work_order_cost)").is("deleted_at", null).order("asset_code");
  if (filters.departmentId) query = query.eq("department_id", filters.departmentId);
  if (filters.assetId) query = query.eq("id", filters.assetId);
  if (filters.status) query = query.eq("status", filters.status);
  const { data } = await query;
  const rows = data ?? [];
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
      .map((row) => ({ ...row, breakdownCount: ((row.work_orders as Array<{ maintenance_type: string }> | null) ?? []).filter((wo) => wo.maintenance_type === "Breakdown").length }))
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
  const supabase = createSupabaseAdminClient();
  let query = supabase.from("assets").select("*, departments(name)").is("deleted_at", null).order("next_service_date");
  if (filters.departmentId) query = query.eq("department_id", filters.departmentId);
  if (filters.assetId) query = query.eq("id", filters.assetId);
  const { data } = await query;
  const rows = data ?? [];
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
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase.from("parts").select("*").is("deleted_at", null).order("part_code");
  return data ?? [];
}

export async function getPartsRequestRows() {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase.from("parts_requests").select("*, departments(name), work_orders(work_order_number), assets(asset_code, asset_name)").order("created_at", { ascending: false });
  return data ?? [];
}

export async function getPurchaseRows() {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase.from("purchase_requests").select("*").order("created_at", { ascending: false });
  return data ?? [];
}

export async function getInventoryMovementRows() {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase.from("inventory_movements").select("*, parts(part_code, part_name)").order("created_at", { ascending: false });
  return data ?? [];
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

function isDateBetween(value: string | null | undefined, start: Date, end: Date) {
  if (!value) return false;
  const date = new Date(value);
  return date >= start && date <= end;
}
