import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit/log";
import { getCurrentUserContext } from "@/lib/auth/context";
import { createExcelWorkbookBuffer } from "@/lib/exports/excel";
import { notifyByEvent } from "@/lib/notifications/service";
import {
  canViewCosts,
  getAssetReport,
  getCostReport,
  getInventoryMovementRows,
  getPartsInventoryRows,
  getPartsRequestRows,
  getPreventiveReport,
  getPurchaseRows,
  getWorkOrderReport,
  parseReportFilters
} from "@/lib/reports/data";

const exportKinds = new Set(["work-orders", "assets", "parts", "parts-requests", "purchase-requests", "inventory-movements", "costs", "preventive-maintenance"]);
const sheetNames: Record<string, string> = {
  "work-orders": "Work Orders",
  assets: "Assets",
  parts: "Parts Inventory",
  "parts-requests": "Parts Requests",
  "purchase-requests": "Purchase Requests",
  "inventory-movements": "Inventory Movements",
  costs: "Cost Report",
  "preventive-maintenance": "Preventive Maintenance"
};

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const context = await getCurrentUserContext();
  if (!context) return new NextResponse("Unauthorized", { status: 401 });

  const { kind } = await params;
  if (!exportKinds.has(kind)) return new NextResponse("Unknown export", { status: 404 });
  const canExport = context.role?.slug === "super_admin" || context.permissions.includes("reports.export") || context.permissions.includes("finance.reports.view");
  if (!canExport) return new NextResponse("Forbidden", { status: 403 });
  if (kind === "costs" && !canViewCosts(context)) return new NextResponse("Cost export forbidden", { status: 403 });

  const url = new URL(request.url);
  const filters = parseReportFilters(Object.fromEntries(url.searchParams.entries()));
  // Enforce department scope for maintenance managers — cannot be bypassed via URL params.
  if (context.role?.slug === "maintenance_manager" && context.department?.id) {
    filters.departmentId = context.department.id;
  }
  const rows = await rowsForKind(kind, filters, canViewCosts(context));

  await writeAuditLog({
    actorId: context.userId,
    action: "report.export",
    entityType: "report",
    entityId: null,
    summary: `Exported ${kind} report`,
    metadata: { kind, rowCount: rows.length }
  });
  await notifyByEvent({
    eventKey: "report.exported",
    entityType: "report",
    actorId: context.userId,
    recipientUserIds: [context.userId],
    metadata: { report_name: sheetNames[kind] ?? kind, kind, row_count: rows.length },
    actionUrl: kind === "costs" ? "/reports/costs" : "/reports/work-orders",
    actionLabel: "Open reports"
  });

  const workbookBuffer = await createExcelWorkbookBuffer({
    sheetName: sheetNames[kind] ?? "RECAFCO Export",
    rows,
    emptyMessage: `No ${sheetNames[kind] ?? kind} records match the selected filters.`
  });

  return new NextResponse(workbookBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="recafco-${kind}-${new Date().toISOString().slice(0, 10)}.xlsx"`
    }
  });
}

async function rowsForKind(kind: string, filters: ReturnType<typeof parseReportFilters>, includeCosts: boolean) {
  if (kind === "work-orders") {
    const report = await getWorkOrderReport(filters);
    return report.rows.map((row) => {
      const department = Array.isArray(row.departments) ? row.departments[0] : row.departments;
      const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
      return cleanCost({
        work_order_number: row.work_order_number,
        date_of_order: row.date_of_order,
        department: department?.name,
        asset: asset ? `${asset.asset_code} - ${asset.asset_name}` : "",
        maintenance_type: row.maintenance_type,
        worker_type: row.worker_type,
        priority: row.priority,
        status: row.status,
        total_labor_cost: row.total_labor_cost,
        total_material_cost: row.total_material_cost,
        total_work_order_cost: row.total_work_order_cost
      }, includeCosts);
    });
  }
  if (kind === "assets") {
    const report = await getAssetReport(filters);
    return report.rows.map((row) => {
      const department = Array.isArray(row.departments) ? row.departments[0] : row.departments;
      return {
        asset_code: row.asset_code,
        asset_name: row.asset_name,
        category: row.category,
        department: department?.name,
        status: row.status,
        current_kilometer_reading: row.current_kilometer_reading,
        current_running_hours: row.current_running_hours,
        next_service_date: row.next_service_date,
        next_service_kilometer: row.next_service_kilometer,
        next_service_running_hours: row.next_service_running_hours,
        registration_expiry_date: row.registration_expiry_date,
        insurance_expiry_date: row.insurance_expiry_date,
        warranty_expiry_date: row.warranty_expiry_date
      };
    });
  }
  if (kind === "parts") return (await getPartsInventoryRows()).map((row) => cleanCost(row, includeCosts));
  if (kind === "parts-requests") return (await getPartsRequestRows()).map((row) => cleanCost(row, includeCosts));
  if (kind === "purchase-requests") return (await getPurchaseRows()).map((row) => cleanCost(row, includeCosts));
  if (kind === "inventory-movements") return (await getInventoryMovementRows()).map((row) => cleanCost(row, includeCosts));
  if (kind === "costs") {
    const report = await getCostReport(filters);
    return report.rows.map((row) => ({
      work_order_number: row.work_order_number,
      date_of_order: row.date_of_order,
      status: row.status,
      labor_cost: row.total_labor_cost,
      material_cost: row.total_material_cost,
      total_cost: row.total_work_order_cost
    }));
  }
  const report = await getPreventiveReport(filters);
  return report.rows.map((row) => ({
    asset_code: row.asset_code,
    asset_name: row.asset_name,
    status: row.status,
    current_kilometer_reading: row.current_kilometer_reading,
    next_service_kilometer: row.next_service_kilometer,
    current_running_hours: row.current_running_hours,
    next_service_running_hours: row.next_service_running_hours,
    next_service_date: row.next_service_date
  }));
}

function cleanCost(row: Record<string, unknown>, includeCosts: boolean) {
  if (includeCosts) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.includes("cost") && !key.includes("price") && !key.includes("total")));
}
