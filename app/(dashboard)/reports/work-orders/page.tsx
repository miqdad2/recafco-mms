import Link from "next/link";
import { BookOpen, ShieldAlert } from "lucide-react";

import { CeoReportModeNav } from "@/components/reports/ceo-report-mode-nav";
import { ExportButton } from "@/components/reports/export-button";
import { ReportFilterPanel } from "@/components/reports/report-filter-panel";
import { ReportModeNav } from "@/components/reports/report-mode-nav";
import { ReportSummaryGrid } from "@/components/reports/report-summary-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import {
  canViewCosts,
  getCeoAllPurchaseRows,
  getCeoPurchaseApprovals,
  getFilterOptions,
  getMgrFilterOptions,
  getWorkOrderReport,
  parseCeoReportMode,
  parseReportFilters,
  parseReportMode
} from "@/lib/reports/data";
import type { CeoReportMode, FilterOptions, ReportFilters, ReportMode } from "@/lib/reports/data";

// ─── Types ───────────────────────────────────────────────────────────────────

type SummaryTone = "red" | "amber" | "green" | "blue" | "gray";
type SummaryCard = { label: string; value: string | number; tone: SummaryTone };
type GroupRow = { label: string; value: number };
type GroupCardDef = { title: string; rows: GroupRow[] };

// ─── Mode metadata ────────────────────────────────────────────────────────────

const MODE_META: Record<ReportMode, { label: string; description: string }> = {
  "pending-approvals": {
    label: "Pending Approvals",
    description: "Submitted work orders in your department waiting for manager decision."
  },
  overdue: {
    label: "Overdue Work Orders",
    description: "Open department work orders delayed past their planned start date."
  },
  "waiting-parts": {
    label: "Waiting Parts / Purchase",
    description: "Department jobs currently blocked by parts availability or the purchase process."
  },
  "asset-history": {
    label: "Asset Breakdown History",
    description: "All maintenance work orders per asset — identify repeated issues or high-maintenance equipment."
  },
  "monthly-summary": {
    label: "Monthly Work Order Summary",
    description: "Department work orders this month grouped by status, priority, maintenance type, and worker team."
  },
  "technician-workload": {
    label: "Technician / Team Workload",
    description: "Active and recently completed work orders per technician or worker team in your department."
  }
};

// ─── Filter fields per mode ───────────────────────────────────────────────────

function modeVisibleFields(mode: ReportMode): string[] {
  switch (mode) {
    case "pending-approvals":
      return ["dateFrom", "dateTo", "priority", "assetId"];
    case "overdue":
      return ["dateFrom", "dateTo", "priority", "assetId", "technicianId"];
    case "waiting-parts":
      return ["assetId", "maintenanceType"];
    case "asset-history":
      return ["assetId", "maintenanceType", "dateFrom", "dateTo"];
    case "monthly-summary":
      return ["dateFrom", "dateTo", "status", "priority", "maintenanceType", "workerType"];
    case "technician-workload":
      return ["technicianId", "dateFrom", "dateTo"];
    default:
      return ["dateFrom", "dateTo", "priority", "status", "assetId", "technicianId"];
  }
}

// ─── Age helper ───────────────────────────────────────────────────────────────

function daysAgo(date: string | null | undefined): number {
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));
}

// ─── CEO report metadata ──────────────────────────────────────────────────────

const CEO_REPORT_META: Record<CeoReportMode, { label: string; description: string }> = {
  "executive-summary": {
    label: "Executive Summary",
    description: "Monthly overview of work orders across all departments — status, type, and department breakdown."
  },
  "ceo-approvals": {
    label: "CEO Approval Queue",
    description: "Purchase requests that have cleared finance review and require your final decision."
  },
  "cost-exposure": {
    label: "Cost Exposure",
    description: "Executive view of pending and active procurement cost — high-value and escalated items. Detailed cost validation is handled by Accounting / Cost Controller and Finance."
  },
  "blocked-operations": {
    label: "Blocked Operations",
    description: "Work orders currently blocked by parts availability or the purchase process."
  },
  "department-performance": {
    label: "Department Performance",
    description: "Work order volumes by department — pending, in progress, blocked, and closed this period."
  },
  "asset-risk": {
    label: "Asset Risk",
    description: "High-priority and breakdown work orders by asset — identify problem equipment."
  }
};

// ─── CEO summary cards ────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function computeCeoSummary(
  mode: CeoReportMode,
  woRows: any[],
  ceoApprovals: any[],
  allPurchase: any[],
  renderNow: number
): SummaryCard[] {
  const age = (d: string | null | undefined) =>
    d ? Math.max(0, Math.floor((renderNow - new Date(d).getTime()) / 86_400_000)) : 0;

  switch (mode) {
    case "executive-summary": {
      const closed = woRows.filter((r) => r.status === "Closed").length;
      const pending = woRows.filter((r) => ["Submitted", "Pending Approval"].includes(r.status)).length;
      return [
        { label: "Work Orders This Period", value: woRows.length, tone: "blue" },
        { label: "Closed This Period", value: closed, tone: closed > 0 ? "green" : "gray" },
        { label: "Pending Approval", value: pending, tone: pending > 0 ? "amber" : "green" },
        { label: "CEO Approvals Waiting", value: ceoApprovals.length, tone: ceoApprovals.length > 0 ? "red" : "green" }
      ];
    }
    case "ceo-approvals": {
      const totalValue = ceoApprovals.reduce((s, r) => s + Number(r.estimated_total ?? 0), 0);
      const ages = ceoApprovals.map((r) => age(r.created_at));
      const oldest = ages.length ? Math.max(...ages) : 0;
      return [
        { label: "Pending CEO Approval", value: ceoApprovals.length, tone: ceoApprovals.length > 0 ? "red" : "green" },
        {
          label: "Total Value (KWD)",
          value: totalValue.toLocaleString("en-US", { maximumFractionDigits: 0 }),
          tone: totalValue > 0 ? "red" : "green"
        },
        { label: "Oldest Waiting (days)", value: oldest, tone: oldest > 14 ? "red" : oldest > 7 ? "amber" : "green" }
      ];
    }
    case "cost-exposure": {
      const totalPurchase = allPurchase.reduce((s, r) => s + Number(r.estimated_total ?? 0), 0);
      const ceoValue = allPurchase
        .filter((r) => r.status === "Pending CEO Approval")
        .reduce((s, r) => s + Number(r.estimated_total ?? 0), 0);
      return [
        { label: "Active Purchase Rows", value: allPurchase.length, tone: "blue" },
        {
          label: "Total Estimated Value (KWD)",
          value: totalPurchase.toLocaleString("en-US", { maximumFractionDigits: 0 }),
          tone: totalPurchase > 0 ? "amber" : "green"
        },
        {
          label: "Pending CEO Approval (KWD)",
          value: ceoValue.toLocaleString("en-US", { maximumFractionDigits: 0 }),
          tone: ceoValue > 0 ? "red" : "green"
        }
      ];
    }
    case "blocked-operations": {
      const waitParts = woRows.filter((r) => r.status === "Waiting for Parts").length;
      const waitPurchase = woRows.filter((r) => r.status === "Waiting for Purchase").length;
      const partsIssued = woRows.filter((r) => r.status === "Parts Issued").length;
      const ages = woRows.map((r) => age(r.updated_at ?? r.created_at));
      const oldest = ages.length ? Math.max(...ages) : 0;
      return [
        { label: "Waiting for Parts", value: waitParts, tone: waitParts > 0 ? "amber" : "green" },
        { label: "Waiting for Purchase", value: waitPurchase, tone: waitPurchase > 0 ? "red" : "green" },
        { label: "Parts Issued (pending)", value: partsIssued, tone: partsIssued > 0 ? "blue" : "green" },
        { label: "Oldest Blocked (days)", value: oldest, tone: oldest > 14 ? "red" : oldest > 7 ? "amber" : "green" }
      ];
    }
    case "department-performance": {
      const deptSet = new Set(
        woRows
          .map((r) => {
            const d = Array.isArray(r.departments) ? r.departments[0] : r.departments;
            return d?.name;
          })
          .filter(Boolean)
      );
      const blocked = woRows.filter((r) =>
        ["Waiting for Parts", "Waiting for Purchase", "Parts Issued"].includes(r.status)
      ).length;
      const pending = woRows.filter((r) => ["Submitted", "Pending Approval"].includes(r.status)).length;
      return [
        { label: "Departments with WOs", value: deptSet.size, tone: "blue" },
        { label: "Total Blocked Operations", value: blocked, tone: blocked > 0 ? "red" : "green" },
        { label: "Pending Approvals", value: pending, tone: pending > 0 ? "amber" : "green" }
      ];
    }
    case "asset-risk": {
      const hp = woRows.filter((r) => r.priority === "High" || r.priority === "Urgent").length;
      const breakdowns = woRows.filter((r) => r.maintenance_type === "Breakdown").length;
      const assetSet = new Set(woRows.map((r) => r.asset_id).filter(Boolean));
      return [
        { label: "High / Urgent Priority", value: hp, tone: hp > 0 ? "red" : "green" },
        { label: "Breakdown Type WOs", value: breakdowns, tone: breakdowns > 0 ? "amber" : "green" },
        { label: "Assets with Open WOs", value: assetSet.size, tone: assetSet.size > 0 ? "blue" : "green" }
      ];
    }
    default:
      return [];
  }
}

// ─── CEO group breakdowns ─────────────────────────────────────────────────────

function computeCeoGroups(mode: CeoReportMode, woRows: any[]): GroupCardDef[] {
  const groupByFn = (key: (r: any) => string): GroupRow[] => {
    const map = new Map<string, number>();
    woRows.forEach((r) => {
      const k = key(r) || "Unknown";
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  };

  const byDept = () =>
    groupByFn((r) => {
      const d = Array.isArray(r.departments) ? r.departments[0] : r.departments;
      return d?.name ?? "No department";
    });
  const byStatus = () => groupByFn((r) => r.status ?? "Unknown");
  const byType = () => groupByFn((r) => r.maintenance_type ?? "Not recorded");
  const byPriority = () => groupByFn((r) => r.priority ?? "Not set");
  const byAsset = () =>
    groupByFn((r) => {
      const a = Array.isArray(r.assets) ? r.assets[0] : r.assets;
      return a ? `${a.asset_code} – ${a.asset_name}` : "No asset";
    });

  switch (mode) {
    case "executive-summary":
      return [
        { title: "By Department", rows: byDept() },
        { title: "By Status", rows: byStatus() },
        { title: "By Type", rows: byType() }
      ];
    case "blocked-operations":
      return [
        { title: "By Department", rows: byDept() },
        { title: "By Priority", rows: byPriority() }
      ];
    case "asset-risk":
      return [
        { title: "By Asset (most WOs)", rows: byAsset() },
        { title: "By Maintenance Type", rows: byType() }
      ];
    default:
      return [];
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Mode summary cards ───────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function computeModeSummary(rows: any[], mode: ReportMode): SummaryCard[] {
  const isHighPri = (r: any) => r.priority === "High" || r.priority === "Urgent";

  switch (mode) {
    case "pending-approvals": {
      const hp = rows.filter(isHighPri).length;
      const ages = rows.map((r) => daysAgo(r.created_at));
      const oldest = ages.length ? Math.max(...ages) : 0;
      return [
        { label: "Pending", value: rows.length, tone: rows.length > 0 ? "amber" : "green" },
        { label: "High / Urgent priority", value: hp, tone: hp > 0 ? "red" : "green" },
        { label: "Oldest waiting (days)", value: oldest, tone: oldest > 7 ? "red" : oldest > 3 ? "amber" : "green" }
      ];
    }
    case "overdue": {
      const hp = rows.filter(isHighPri).length;
      const ages = rows.map((r) => daysAgo(r.starting_datetime ?? r.created_at));
      const avg = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
      const oldest = ages.length ? Math.max(...ages) : 0;
      return [
        { label: "Overdue", value: rows.length, tone: rows.length > 0 ? "red" : "green" },
        { label: "High / Urgent priority", value: hp, tone: hp > 0 ? "red" : "green" },
        { label: "Avg. overdue (days)", value: avg, tone: avg > 14 ? "red" : avg > 7 ? "amber" : "green" },
        { label: "Oldest (days)", value: oldest, tone: oldest > 30 ? "red" : oldest > 14 ? "amber" : "green" }
      ];
    }
    case "waiting-parts": {
      const waitP = rows.filter((r) => r.status === "Waiting for Parts").length;
      const waitPu = rows.filter((r) => r.status === "Waiting for Purchase").length;
      const ages = rows.map((r) => daysAgo(r.created_at));
      const oldest = ages.length ? Math.max(...ages) : 0;
      return [
        { label: "Waiting for parts", value: waitP, tone: waitP > 0 ? "amber" : "green" },
        { label: "Waiting for purchase", value: waitPu, tone: waitPu > 0 ? "red" : "green" },
        {
          label: "Parts issued (pending closure)",
          value: rows.filter((r) => r.status === "Parts Issued").length,
          tone: "blue"
        },
        { label: "Oldest blocked (days)", value: oldest, tone: oldest > 14 ? "red" : oldest > 7 ? "amber" : "green" }
      ];
    }
    case "asset-history": {
      const assetIds = new Set(rows.map((r) => r.asset_id).filter(Boolean));
      const breakdowns = rows.filter((r) => r.maintenance_type === "Breakdown").length;
      return [
        { label: "Total work orders", value: rows.length, tone: "blue" },
        { label: "Assets affected", value: assetIds.size, tone: "blue" },
        { label: "Breakdown type", value: breakdowns, tone: breakdowns > 3 ? "red" : "amber" },
        { label: "Other maintenance types", value: rows.length - breakdowns, tone: "gray" }
      ];
    }
    case "monthly-summary": {
      const completed = rows.filter((r) =>
        ["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester", "Closed"].includes(r.status)
      ).length;
      const pending = rows.filter((r) => ["Submitted", "Pending Approval"].includes(r.status)).length;
      const rejected = rows.filter((r) => r.status === "Rejected").length;
      return [
        { label: "Total created", value: rows.length, tone: "blue" },
        { label: "Completed / Closed", value: completed, tone: completed > 0 ? "green" : "gray" },
        { label: "Pending approval", value: pending, tone: pending > 0 ? "amber" : "green" },
        { label: "Rejected", value: rejected, tone: rejected > 0 ? "red" : "green" }
      ];
    }
    case "technician-workload": {
      const assigned = rows.filter((r) => r.status === "Assigned").length;
      const inProg = rows.filter((r) => r.status === "In Progress").length;
      const done = rows.filter((r) =>
        ["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester", "Closed"].includes(r.status)
      ).length;
      const overdueCount = rows.filter(
        (r) =>
          r.starting_datetime &&
          new Date(r.starting_datetime) < new Date() &&
          !["Closed", "Cancelled", "Rejected"].includes(r.status)
      ).length;
      return [
        { label: "Assigned", value: assigned, tone: "blue" },
        { label: "In progress", value: inProg, tone: "amber" },
        { label: "Completed / Closed", value: done, tone: "green" },
        { label: "Overdue", value: overdueCount, tone: overdueCount > 0 ? "red" : "green" }
      ];
    }
    default:
      return [];
  }
}

// ─── Mode group breakdowns ────────────────────────────────────────────────────

function computeModeGroups(rows: any[], mode: ReportMode): GroupCardDef[] {
  const groupBy = (key: (r: any) => string): GroupRow[] => {
    const map = new Map<string, number>();
    rows.forEach((r) => {
      const k = key(r) || "Unknown";
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  };

  const byAsset = () =>
    groupBy((r) => {
      const a = Array.isArray(r.assets) ? r.assets[0] : r.assets;
      return a ? `${a.asset_code} – ${a.asset_name}` : "No asset";
    });
  const byTechnician = () =>
    groupBy((r) => {
      const assigns = Array.isArray(r.work_order_assignments) ? r.work_order_assignments : [];
      return (assigns[0] as any)?.profiles?.full_name ?? "Unassigned";
    });
  const byStatus = () => groupBy((r) => r.status ?? "Unknown");
  const byType = () => groupBy((r) => r.maintenance_type ?? "Not recorded");
  const byMonth = () =>
    groupBy((r) => String(r.date_of_order ?? r.created_at ?? "").slice(0, 7) || "No date");
  const byPriority = () => groupBy((r) => r.priority ?? "Not set");

  switch (mode) {
    case "pending-approvals":
      return [
        { title: "By Priority", rows: byPriority() },
        { title: "By Type", rows: byType() }
      ];
    case "overdue":
      return [
        { title: "By Asset", rows: byAsset() },
        { title: "By Technician", rows: byTechnician() }
      ];
    case "waiting-parts":
      return [
        { title: "By Asset", rows: byAsset() },
        { title: "By Status", rows: byStatus() }
      ];
    case "asset-history":
      return [
        { title: "By Asset (top repeated)", rows: byAsset() },
        { title: "By Type", rows: byType() }
      ];
    case "monthly-summary":
      return [
        { title: "By Status", rows: byStatus() },
        { title: "By Type", rows: byType() },
        { title: "By Month", rows: byMonth() }
      ];
    case "technician-workload":
      return [
        { title: "By Technician", rows: byTechnician() },
        { title: "By Status", rows: byStatus() }
      ];
    default:
      return [];
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WorkOrderReportsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requirePermission("reports.view");
  const rawParams = await searchParams;

  const isManager = context.role?.slug === "maintenance_manager";
  const isCeo = context.role?.slug === "ceo_management";
  const mgrDeptId = isManager ? (context.department?.id ?? null) : null;
  const deptName = context.department?.name ?? "Maintenance Department";

  // ─── CEO early-return branch ─────────────────────────────────────────────────
  if (isCeo) {
    const ceoMode = parseCeoReportMode(rawParams["report"]);
    const baseFilters = parseReportFilters(rawParams);
    // eslint-disable-next-line react-hooks/purity
    const ceoRenderNow = Date.now();

    const ceoFilters: ReportFilters = { ...baseFilters };
    if (ceoMode === "executive-summary" && !baseFilters.dateFrom && !baseFilters.dateTo) {
      const now = new Date();
      ceoFilters.dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    }
    if (ceoMode === "blocked-operations") {
      ceoFilters.statusIn = ["Waiting for Parts", "Waiting for Purchase", "Parts Issued"];
      ceoFilters.status = undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emptyArr: any[] = [];
    const [ceoOptions, ceoReport, ceoPurchaseApprovals, ceoAllPurchase] = await Promise.all([
      getFilterOptions(),
      getWorkOrderReport(ceoFilters),
      ceoMode === "ceo-approvals" || ceoMode === "executive-summary"
        ? getCeoPurchaseApprovals({ dateFrom: baseFilters.dateFrom, dateTo: baseFilters.dateTo, priority: baseFilters.priority })
        : Promise.resolve(emptyArr),
      ceoMode === "cost-exposure"
        ? getCeoAllPurchaseRows({
            dateFrom: baseFilters.dateFrom,
            dateTo: baseFilters.dateTo,
            departmentId: baseFilters.departmentId,
            costMin: baseFilters.costMin,
            costMax: baseFilters.costMax
          })
        : Promise.resolve(emptyArr)
    ]);

    const ceoRows = ceoReport.rows;

    const ceoExportParams = new URLSearchParams(
      Object.entries(rawParams).flatMap(([key, value]) =>
        Array.isArray(value) ? value.map((v) => [key, v]) : value ? [[key, value]] : []
      )
    );
    ceoExportParams.set("report", ceoMode);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ceoSummaryCards = computeCeoSummary(ceoMode, ceoRows, ceoPurchaseApprovals as any[], ceoAllPurchase as any[], ceoRenderNow);
    const ceoGroupCards = computeCeoGroups(ceoMode, ceoRows);
    const ceoMeta = CEO_REPORT_META[ceoMode];
    const ceoExportKind = ceoMode === "ceo-approvals" || ceoMode === "cost-exposure" ? "purchase-requests" : "work-orders";

    return (
      <>
        <PageHeader
          title="CEO Executive Reports"
          description="Executive view of approvals, cost exposure, blocked operations, department performance, and asset risk."
          actions={<ExportButton kind={ceoExportKind} searchParams={ceoExportParams} label="Export Current Report" />}
        />
        <div className="space-y-5 p-4 lg:p-6">
          {/* Scope banner */}
          <div className="flex items-center gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
            <ShieldAlert className="h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden="true" />
            <span>
              <strong>Scope: Executive cross-department view</strong> — This report covers all departments. Data is not scoped to any single department.
            </span>
          </div>

          {/* CEO mode navigation */}
          <CeoReportModeNav selectedMode={ceoMode} />

          {/* Mode header */}
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">CEO / Management</p>
              <h2 className="mt-0.5 text-base font-bold text-[#111827]">{ceoMeta.label}</h2>
              <p className="mt-0.5 text-sm text-[#4B5563]">{ceoMeta.description}</p>
            </div>
            <span className="hidden shrink-0 rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700 sm:block">
              Executive View
            </span>
          </div>

          {/* CEO filter panel */}
          <CeoFilterPanel mode={ceoMode} filters={baseFilters} options={ceoOptions} />

          {/* Summary cards */}
          {ceoSummaryCards.length > 0 && <ReportSummaryGrid cards={ceoSummaryCards} />}

          {/* Group breakdowns */}
          {ceoGroupCards.length > 0 && (
            <div className={`grid gap-4 ${ceoGroupCards.length >= 3 ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
              {ceoGroupCards.map((gc) => (
                <GroupCard key={gc.title} title={gc.title} rows={gc.rows} />
              ))}
            </div>
          )}

          {/* Mode-specific table */}
          {ceoMode === "ceo-approvals" ? (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <CeoPurchaseTable rows={ceoPurchaseApprovals as any[]} title="CEO Approval Queue" renderNow={ceoRenderNow} showReviewButton />
          ) : ceoMode === "cost-exposure" ? (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <CeoPurchaseTable rows={ceoAllPurchase as any[]} title="Purchase Cost Exposure" renderNow={ceoRenderNow} />
          ) : ceoMode === "department-performance" ? (
            <CeoDeptTable rows={ceoRows} />
          ) : (
            <CeoWOTable rows={ceoRows} mode={ceoMode} renderNow={ceoRenderNow} />
          )}
        </div>
      </>
    );
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const reportMode = parseReportMode(rawParams["report"]);
  const baseFilters = parseReportFilters(rawParams);
  // eslint-disable-next-line react-hooks/purity
  const renderNow = Date.now();
  const showCosts = canViewCosts(context);

  // Build effective query filters
  const filters: ReportFilters = { ...baseFilters };
  if (mgrDeptId) filters.departmentId = mgrDeptId;

  if (isManager) {
    switch (reportMode) {
      case "pending-approvals":
        filters.statusIn = ["Submitted", "Pending Approval"];
        filters.status = undefined;
        break;
      case "overdue":
        filters.overdueOnly = true;
        filters.status = undefined;
        break;
      case "waiting-parts":
        filters.statusIn = ["Waiting for Parts", "Waiting for Purchase", "Parts Issued"];
        filters.status = undefined;
        break;
      case "technician-workload":
        if (!baseFilters.status) {
          filters.statusIn = [
            "Approved",
            "Assigned",
            "In Progress",
            "Waiting for Parts",
            "Waiting for Purchase",
            "Completed by Technician",
            "Verified by Supervisor"
          ];
          filters.status = undefined;
        }
        break;
      default:
        break;
    }
    // Default monthly-summary to current month
    if (reportMode === "monthly-summary" && !baseFilters.dateFrom && !baseFilters.dateTo) {
      const now = new Date();
      filters.dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    }
  }

  const [options, report] = await Promise.all([
    mgrDeptId ? getMgrFilterOptions(mgrDeptId) : getFilterOptions(),
    getWorkOrderReport(filters)
  ]);

  const rows = report.rows;

  // Export params include the locked dept and current mode for managers
  const exportParams = new URLSearchParams(
    Object.entries(rawParams).flatMap(([key, value]) =>
      Array.isArray(value) ? value.map((v) => [key, v]) : value ? [[key, value]] : []
    )
  );
  if (mgrDeptId) exportParams.set("departmentId", mgrDeptId);
  if (isManager) exportParams.set("report", reportMode);

  const modeSummaryCards = isManager ? computeModeSummary(rows, reportMode) : [];
  const modeGroups = isManager ? computeModeGroups(rows, reportMode) : [];
  const meta = MODE_META[reportMode];

  const adminCards = [
    { label: "Total work orders", value: report.stats.total, tone: "blue" as const },
    { label: "Open", value: report.stats.open, tone: "amber" as const },
    { label: "Closed", value: report.stats.closed, tone: "green" as const },
    { label: "Overdue", value: report.stats.overdue, tone: "red" as const },
    { label: "Pending approvals", value: report.stats.pendingApprovals, tone: "amber" as const },
    { label: "Waiting for parts", value: report.stats.waitingForParts, tone: "amber" as const },
    { label: "Waiting purchase", value: report.stats.waitingForPurchase, tone: "red" as const },
    { label: "Verified", value: report.stats.verifiedBySupervisor, tone: "green" as const }
  ];

  return (
    <>
      <PageHeader
        title="Work Order Reports"
        description={
          isManager
            ? "Maintenance Department reports — approvals, delays, assets, workload, and monthly review."
            : "Operational report for work order lifecycle, status, department, type, technician, priority, and trend monitoring."
        }
        actions={
          <ExportButton
            kind="work-orders"
            searchParams={exportParams}
            label={isManager ? "Export Current Report" : "Export Excel"}
          />
        }
      />

      <div className="space-y-5 p-4 lg:p-6">
        {isManager ? (
          <>
            {/* Scope banner */}
            <div className="flex items-center gap-2.5 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
              <BookOpen className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
              <span>
                <strong>Scope: {deptName}</strong> — All report data is scoped to your department only. Work orders from other
                departments are excluded.
              </span>
            </div>

            {/* Report mode nav */}
            <ReportModeNav selectedMode={reportMode} />

            {/* Mode header */}
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">{deptName}</p>
                <h2 className="mt-0.5 text-base font-bold text-[#111827]">{meta.label}</h2>
                <p className="mt-0.5 text-sm text-[#4B5563]">{meta.description}</p>
              </div>
              <span className="hidden shrink-0 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700 sm:block">
                Scope: {deptName}
              </span>
            </div>

            {/* Mode-specific filters */}
            <ReportFilterPanel
              filters={baseFilters}
              options={options}
              includeCosts={false}
              lockedDepartmentId={mgrDeptId ?? undefined}
              deptName={deptName}
              visibleFields={modeVisibleFields(reportMode)}
              reportMode={reportMode}
            />

            {/* Mode summary cards */}
            {modeSummaryCards.length > 0 && <ReportSummaryGrid cards={modeSummaryCards} />}

            {/* Mode group breakdowns */}
            {modeGroups.length > 0 && (
              <div
                className={`grid gap-4 ${
                  modeGroups.length >= 3 ? "xl:grid-cols-3" : "xl:grid-cols-2"
                }`}
              >
                {modeGroups.map((gc) => (
                  <GroupCard key={gc.title} title={gc.title} rows={gc.rows} />
                ))}
              </div>
            )}

            {/* Manager work order table */}
            <ManagerWOTable rows={rows} mode={reportMode} showCosts={showCosts} deptName={deptName} renderNow={renderNow} />
          </>
        ) : (
          <>
            {/* Admin / generic layout (unchanged) */}
            <ReportFilterPanel filters={baseFilters} options={options} includeCosts={showCosts} />
            <ReportSummaryGrid cards={adminCards} />
            <div className="grid gap-5 xl:grid-cols-4">
              <GroupCard title="By Department" rows={report.byDepartment} />
              <GroupCard title="By Type" rows={report.byType} />
              <GroupCard title="By Status" rows={report.byStatus} />
              <GroupCard title="Monthly Trend" rows={report.monthlyTrend} />
            </div>
            <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">Work Order List</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                    <tr>
                      <th className="px-3 py-2">WO</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Department</th>
                      <th className="px-3 py-2">Asset</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Worker</th>
                      <th className="px-3 py-2">Priority</th>
                      <th className="px-3 py-2">Status</th>
                      {showCosts ? <th className="px-3 py-2">Cost</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {rows.length ? (
                      rows.map((wo) => {
                        const department = Array.isArray(wo.departments) ? wo.departments[0] : wo.departments;
                        const asset = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
                        return (
                          <tr key={wo.id}>
                            <td className="px-3 py-2">
                              <Link className="font-bold text-[#ED1C24]" href={`/maintenance/work-orders/${wo.id}`}>
                                {wo.work_order_number}
                              </Link>
                            </td>
                            <td className="px-3 py-2">{wo.date_of_order}</td>
                            <td className="px-3 py-2">{department?.name ?? "-"}</td>
                            <td className="px-3 py-2">
                              {asset ? `${asset.asset_code} - ${asset.asset_name}` : "-"}
                            </td>
                            <td className="px-3 py-2">{wo.maintenance_type}</td>
                            <td className="px-3 py-2">{wo.worker_type}</td>
                            <td className="px-3 py-2">{wo.priority}</td>
                            <td className="px-3 py-2">{wo.status}</td>
                            {showCosts ? <td className="px-3 py-2">{wo.total_work_order_cost}</td> : null}
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td className="px-3 py-4" colSpan={showCosts ? 9 : 8}>
                          <EmptyState
                            title="No work orders found"
                            message="No records match the current filters. Try clearing the date range or status selections to show more results."
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function GroupCard({ title, rows }: { title: string; rows: GroupRow[] }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <h2 className="font-bold">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.length ? (
          rows.slice(0, 8).map((row) => (
            <div key={row.label} className="flex justify-between gap-3 text-sm">
              <span className="truncate text-[#4B5563]">{row.label}</span>
              <span className="shrink-0 font-bold">{row.value}</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-[#9CA3AF]">No records match this summary.</p>
        )}
      </div>
    </section>
  );
}

function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  if (!priority) return <span className="text-[#9CA3AF]">—</span>;
  const toneMap: Record<string, string> = {
    Urgent: "bg-red-100 text-red-700",
    High: "bg-amber-100 text-amber-700",
    Normal: "bg-blue-100 text-blue-700",
    Low: "bg-gray-100 text-gray-500"
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${toneMap[priority] ?? "bg-gray-100 text-gray-500"}`}>
      {priority}
    </span>
  );
}

function StatusTag({ status }: { status: string }) {
  const toneMap: Record<string, string> = {
    Submitted: "bg-blue-100 text-blue-700",
    "Pending Approval": "bg-amber-100 text-amber-700",
    Approved: "bg-green-100 text-green-700",
    Assigned: "bg-blue-100 text-blue-700",
    "In Progress": "bg-amber-100 text-amber-700",
    "Waiting for Parts": "bg-orange-100 text-orange-700",
    "Waiting for Purchase": "bg-red-100 text-red-700",
    "Parts Issued": "bg-purple-100 text-purple-700",
    "Completed by Technician": "bg-green-100 text-green-700",
    "Verified by Supervisor": "bg-green-100 text-green-700",
    "Confirmed by Requester": "bg-green-100 text-green-700",
    Closed: "bg-gray-100 text-gray-500",
    Rejected: "bg-red-100 text-red-700",
    Cancelled: "bg-gray-100 text-gray-500"
  };
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${toneMap[status] ?? "bg-gray-100 text-gray-500"}`}
    >
      {status}
    </span>
  );
}

// ─── Manager work order table ─────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function ManagerWOTable({
  rows,
  mode,
  showCosts,
  deptName,
  renderNow
}: {
  rows: any[];
  mode: ReportMode;
  showCosts: boolean;
  deptName: string;
  renderNow: number;
}) {
  const age = (d: string | null | undefined) =>
    d ? String(Math.max(0, Math.floor((renderNow - new Date(d).getTime()) / 86_400_000))) : "—";

  const assetLabel = (wo: any) => {
    const a = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
    return a ? `${a.asset_code} – ${a.asset_name}` : "—";
  };

  const techName = (wo: any) => {
    const assigns = Array.isArray(wo.work_order_assignments) ? wo.work_order_assignments : [];
    return (assigns[0] as any)?.profiles?.full_name ?? "Unassigned";
  };

  // Column count for the empty state colSpan
  const colCount =
    mode === "monthly-summary" ? (showCosts ? 8 : 7) : mode === "asset-history" || mode === "waiting-parts" ? 6 : 7;

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#111827]">Work Order List — {deptName}</h2>
          <p className="text-xs text-[#4B5563]">
            {rows.length} record{rows.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wide text-[#4B5563]">
            <tr>
              {mode === "pending-approvals" && (
                <>
                  <th className="px-4 py-2.5">WO No.</th>
                  <th className="px-4 py-2.5">Requester</th>
                  <th className="px-4 py-2.5">Asset / Vehicle</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Priority</th>
                  <th className="px-4 py-2.5">Submitted (age)</th>
                  <th className="px-4 py-2.5">Action</th>
                </>
              )}
              {mode === "overdue" && (
                <>
                  <th className="px-4 py-2.5">WO No.</th>
                  <th className="px-4 py-2.5">Asset / Vehicle</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Technician</th>
                  <th className="px-4 py-2.5">Priority</th>
                  <th className="px-4 py-2.5">Overdue (days)</th>
                  <th className="px-4 py-2.5">Action</th>
                </>
              )}
              {mode === "waiting-parts" && (
                <>
                  <th className="px-4 py-2.5">WO No.</th>
                  <th className="px-4 py-2.5">Asset / Vehicle</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Created (age)</th>
                  <th className="px-4 py-2.5">Action</th>
                </>
              )}
              {mode === "asset-history" && (
                <>
                  <th className="px-4 py-2.5">WO No.</th>
                  <th className="px-4 py-2.5">Asset / Vehicle</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Action</th>
                </>
              )}
              {mode === "monthly-summary" && (
                <>
                  <th className="px-4 py-2.5">WO No.</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Asset / Vehicle</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Priority</th>
                  {showCosts && <th className="px-4 py-2.5">Cost (KWD)</th>}
                  <th className="px-4 py-2.5">Action</th>
                </>
              )}
              {mode === "technician-workload" && (
                <>
                  <th className="px-4 py-2.5">WO No.</th>
                  <th className="px-4 py-2.5">Technician</th>
                  <th className="px-4 py-2.5">Asset / Vehicle</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Priority</th>
                  <th className="px-4 py-2.5">Action</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {!rows.length && (
              <tr>
                <td colSpan={colCount} className="px-4 py-8">
                  <EmptyState
                    title="No records match this report"
                    message="No work orders match the current filters. Try clearing filters or selecting a different date range."
                  />
                </td>
              </tr>
            )}
            {rows.map((wo) => (
              <tr key={wo.id} className="hover:bg-gray-50">
                {mode === "pending-approvals" && (
                  <>
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/work-orders/${wo.id}`} className="font-bold text-[#ED1C24] hover:underline">
                        {wo.work_order_number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{wo.ordered_by ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{assetLabel(wo)}</td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{wo.maintenance_type ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <PriorityBadge priority={wo.priority} />
                    </td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{age(wo.created_at)} days</td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/maintenance/work-orders/${wo.id}`}
                        className="inline-flex items-center rounded bg-[#ED1C24] px-3 py-1 text-xs font-bold text-white transition hover:bg-[#c9151c]"
                      >
                        Review
                      </Link>
                    </td>
                  </>
                )}
                {mode === "overdue" && (
                  <>
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/work-orders/${wo.id}`} className="font-bold text-[#ED1C24] hover:underline">
                        {wo.work_order_number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{assetLabel(wo)}</td>
                    <td className="px-4 py-2.5">
                      <StatusTag status={wo.status} />
                    </td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{techName(wo)}</td>
                    <td className="px-4 py-2.5">
                      <PriorityBadge priority={wo.priority} />
                    </td>
                    <td className="px-4 py-2.5 font-bold text-[#DC2626]">{age(wo.starting_datetime)} days</td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/maintenance/work-orders/${wo.id}`}
                        className="inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50"
                      >
                        View
                      </Link>
                    </td>
                  </>
                )}
                {mode === "waiting-parts" && (
                  <>
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/work-orders/${wo.id}`} className="font-bold text-[#ED1C24] hover:underline">
                        {wo.work_order_number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{assetLabel(wo)}</td>
                    <td className="px-4 py-2.5">
                      <StatusTag status={wo.status} />
                    </td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{wo.maintenance_type ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{age(wo.created_at)} days</td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/maintenance/work-orders/${wo.id}`}
                        className="inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50"
                      >
                        View
                      </Link>
                    </td>
                  </>
                )}
                {mode === "asset-history" && (
                  <>
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/work-orders/${wo.id}`} className="font-bold text-[#ED1C24] hover:underline">
                        {wo.work_order_number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{assetLabel(wo)}</td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{wo.maintenance_type ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{wo.date_of_order ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <StatusTag status={wo.status} />
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/maintenance/work-orders/${wo.id}`}
                        className="inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50"
                      >
                        View
                      </Link>
                    </td>
                  </>
                )}
                {mode === "monthly-summary" && (
                  <>
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/work-orders/${wo.id}`} className="font-bold text-[#ED1C24] hover:underline">
                        {wo.work_order_number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{wo.date_of_order ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{assetLabel(wo)}</td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{wo.maintenance_type ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <StatusTag status={wo.status} />
                    </td>
                    <td className="px-4 py-2.5">
                      <PriorityBadge priority={wo.priority} />
                    </td>
                    {showCosts && <td className="px-4 py-2.5 text-xs text-[#4B5563]">{wo.total_work_order_cost ?? "—"}</td>}
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/maintenance/work-orders/${wo.id}`}
                        className="inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50"
                      >
                        View
                      </Link>
                    </td>
                  </>
                )}
                {mode === "technician-workload" && (
                  <>
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/work-orders/${wo.id}`} className="font-bold text-[#ED1C24] hover:underline">
                        {wo.work_order_number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{techName(wo)}</td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{assetLabel(wo)}</td>
                    <td className="px-4 py-2.5">
                      <StatusTag status={wo.status} />
                    </td>
                    <td className="px-4 py-2.5">
                      <PriorityBadge priority={wo.priority} />
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/maintenance/work-orders/${wo.id}`}
                        className="inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50"
                      >
                        View
                      </Link>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── CEO Filter Panel ─────────────────────────────────────────────────────────

function CeoFilterPanel({
  mode,
  filters,
  options
}: {
  mode: CeoReportMode;
  filters: ReportFilters;
  options: FilterOptions;
}) {
  const showDept = mode !== "department-performance";
  const showPriority = mode === "ceo-approvals" || mode === "blocked-operations" || mode === "asset-risk";
  const showAsset = mode === "asset-risk";
  const showCost = mode === "cost-exposure";

  return (
    <form method="GET" className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <input type="hidden" name="report" value={mode} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-[#4B5563]">From</label>
          <input
            type="date"
            name="dateFrom"
            defaultValue={filters.dateFrom ?? ""}
            className="h-9 rounded border border-[#E5E7EB] px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-[#4B5563]">To</label>
          <input
            type="date"
            name="dateTo"
            defaultValue={filters.dateTo ?? ""}
            className="h-9 rounded border border-[#E5E7EB] px-3 text-sm"
          />
        </div>
        {showDept && options.departments.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#4B5563]">Department</label>
            <select
              name="departmentId"
              defaultValue={filters.departmentId ?? ""}
              className="h-9 rounded border border-[#E5E7EB] px-3 text-sm"
            >
              <option value="">All departments</option>
              {options.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {showPriority && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#4B5563]">Priority</label>
            <select
              name="priority"
              defaultValue={filters.priority ?? ""}
              className="h-9 rounded border border-[#E5E7EB] px-3 text-sm"
            >
              <option value="">All priorities</option>
              {["Low", "Normal", "High", "Urgent"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        )}
        {showAsset && options.assets.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#4B5563]">Asset</label>
            <select
              name="assetId"
              defaultValue={filters.assetId ?? ""}
              className="h-9 rounded border border-[#E5E7EB] px-3 text-sm"
            >
              <option value="">All assets</option>
              {options.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.asset_code} – {a.asset_name}
                </option>
              ))}
            </select>
          </div>
        )}
        {showCost && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-[#4B5563]">Min Value (KWD)</label>
              <input
                type="number"
                name="costMin"
                defaultValue={filters.costMin ?? ""}
                min="0"
                className="h-9 w-32 rounded border border-[#E5E7EB] px-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-[#4B5563]">Max Value (KWD)</label>
              <input
                type="number"
                name="costMax"
                defaultValue={filters.costMax ?? ""}
                min="0"
                className="h-9 w-32 rounded border border-[#E5E7EB] px-3 text-sm"
              />
            </div>
          </>
        )}
        <button type="submit" className="h-9 rounded bg-[#111827] px-4 text-sm font-bold text-white hover:bg-[#2B2B2B]">
          Apply
        </button>
        <a
          href={`?report=${mode}`}
          className="inline-flex h-9 items-center rounded border border-[#E5E7EB] px-4 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
        >
          Clear
        </a>
      </div>
    </form>
  );
}

// ─── CEO Purchase Table (ceo-approvals + cost-exposure) ───────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function CeoPurchaseTable({
  rows,
  title,
  renderNow,
  showReviewButton = false
}: {
  rows: any[];
  title: string;
  renderNow: number;
  showReviewButton?: boolean;
}) {
  const age = (d: string | null | undefined) =>
    d ? String(Math.max(0, Math.floor((renderNow - new Date(d).getTime()) / 86_400_000))) : "—";

  const formatCost = (val: any) => {
    const n = Number(val ?? 0);
    return isNaN(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
      <div className="flex items-center border-b border-[#E5E7EB] px-5 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#111827]">{title}</h2>
          <p className="text-xs text-[#4B5563]">
            {rows.length} record{rows.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wide text-[#4B5563]">
            <tr>
              <th className="px-4 py-2.5">PR No.</th>
              <th className="px-4 py-2.5">WO No.</th>
              <th className="px-4 py-2.5">Department</th>
              <th className="px-4 py-2.5">Priority</th>
              <th className="px-4 py-2.5">Supplier</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Est. Total (KWD)</th>
              <th className="px-4 py-2.5">{showReviewButton ? "Waiting" : "Created"}</th>
              <th className="px-4 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-4 py-8">
                  <EmptyState
                    title={showReviewButton ? "No CEO approvals waiting" : "No purchase records found"}
                    message={
                      showReviewButton
                        ? "All purchase requests are within finance authority. No CEO action required."
                        : "No active purchase requests match the current filters."
                    }
                  />
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const wo = Array.isArray(row.work_orders) ? row.work_orders[0] : row.work_orders;
              const dept = Array.isArray(wo?.departments) ? wo.departments[0] : wo?.departments;
              return (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-bold text-[#ED1C24]">{row.purchase_request_number ?? "—"}</td>
                  <td className="px-4 py-2.5 text-[#4B5563]">{wo?.work_order_number ?? "—"}</td>
                  <td className="px-4 py-2.5 text-[#4B5563]">{dept?.name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <PriorityBadge priority={wo?.priority} />
                  </td>
                  <td className="px-4 py-2.5 text-[#4B5563]">{row.supplier ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <StatusTag status={row.status ?? "—"} />
                  </td>
                  <td className="px-4 py-2.5 font-bold">{formatCost(row.estimated_total)}</td>
                  <td className="px-4 py-2.5 text-[#4B5563]">
                    {showReviewButton
                      ? `${age(row.created_at)} days`
                      : row.created_at
                        ? String(row.created_at).slice(0, 10)
                        : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/purchase/requests/${row.id}`}
                      className={
                        showReviewButton
                          ? "inline-flex items-center rounded bg-[#ED1C24] px-3 py-1 text-xs font-bold text-white transition hover:bg-[#c9151c]"
                          : "inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50"
                      }
                    >
                      {showReviewButton ? "Review" : "View"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── CEO Dept Table (department-performance) ──────────────────────────────────

function CeoDeptTable({ rows }: { rows: any[] }) {
  const deptMap = new Map<string, { pending: number; inProgress: number; blocked: number; closed: number }>();
  rows.forEach((r) => {
    const d = Array.isArray(r.departments) ? r.departments[0] : r.departments;
    const name = d?.name ?? "No department";
    const entry = deptMap.get(name) ?? { pending: 0, inProgress: 0, blocked: 0, closed: 0 };
    if (["Submitted", "Pending Approval"].includes(r.status)) entry.pending++;
    else if (["Approved", "Assigned", "In Progress"].includes(r.status)) entry.inProgress++;
    else if (["Waiting for Parts", "Waiting for Purchase", "Parts Issued"].includes(r.status)) entry.blocked++;
    else if (r.status === "Closed") entry.closed++;
    deptMap.set(name, entry);
  });

  const deptRows = [...deptMap.entries()]
    .map(([name, c]) => ({ name, ...c, total: c.pending + c.inProgress + c.blocked + c.closed }))
    .sort((a, b) => b.blocked - a.blocked || b.pending - a.pending);

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
      <div className="flex items-center border-b border-[#E5E7EB] px-5 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#111827]">Department Performance</h2>
          <p className="text-xs text-[#4B5563]">
            {deptRows.length} department{deptRows.length !== 1 ? "s" : ""} with work orders
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wide text-[#4B5563]">
            <tr>
              <th className="px-4 py-2.5">Department</th>
              <th className="px-4 py-2.5">Pending Approval</th>
              <th className="px-4 py-2.5">In Progress</th>
              <th className="px-4 py-2.5">Blocked</th>
              <th className="px-4 py-2.5">Closed (Period)</th>
              <th className="px-4 py-2.5">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {!deptRows.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8">
                  <EmptyState title="No department data found" message="No work orders match the current filters." />
                </td>
              </tr>
            )}
            {deptRows.map((dept) => (
              <tr key={dept.name} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-bold text-[#111827]">{dept.name}</td>
                <td className="px-4 py-2.5">
                  {dept.pending > 0 ? (
                    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                      {dept.pending} pending
                    </span>
                  ) : (
                    <span className="text-[#9CA3AF]">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {dept.inProgress > 0 ? (
                    <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                      {dept.inProgress} active
                    </span>
                  ) : (
                    <span className="text-[#9CA3AF]">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {dept.blocked > 0 ? (
                    <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                      {dept.blocked} blocked
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
                      clear
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {dept.closed > 0 ? (
                    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
                      {dept.closed} closed
                    </span>
                  ) : (
                    <span className="text-[#9CA3AF]">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-bold text-[#4B5563]">{dept.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── CEO WO Table (executive-summary, blocked-operations, dept-perf, asset-risk)

function CeoWOTable({ rows, mode, renderNow }: { rows: any[]; mode: CeoReportMode; renderNow: number }) {
  const age = (d: string | null | undefined) =>
    d ? String(Math.max(0, Math.floor((renderNow - new Date(d).getTime()) / 86_400_000))) : "—";

  const assetLabel = (wo: any) => {
    const a = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
    return a ? `${a.asset_code} – ${a.asset_name}` : "—";
  };

  const deptLabel = (wo: any) => {
    const d = Array.isArray(wo.departments) ? wo.departments[0] : wo.departments;
    return d?.name ?? "—";
  };

  const emptyTitle =
    mode === "blocked-operations"
      ? "No blocked operations found"
      : mode === "asset-risk"
        ? "No high-risk work orders found"
        : "No work orders found";

  const colCount = mode === "blocked-operations" ? 8 : 7;

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
      <div className="flex items-center border-b border-[#E5E7EB] px-5 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#111827]">Work Order List — Executive View</h2>
          <p className="text-xs text-[#4B5563]">
            {rows.length} record{rows.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wide text-[#4B5563]">
            <tr>
              <th className="px-4 py-2.5">WO No.</th>
              <th className="px-4 py-2.5">Department</th>
              <th className="px-4 py-2.5">Asset / Vehicle</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Priority</th>
              {mode === "blocked-operations" && <th className="px-4 py-2.5">Blocked (days)</th>}
              <th className="px-4 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {!rows.length && (
              <tr>
                <td colSpan={colCount} className="px-4 py-8">
                  <EmptyState
                    title={emptyTitle}
                    message="No records match the current filters. Try clearing the date range or other filter selections."
                  />
                </td>
              </tr>
            )}
            {rows.map((wo) => (
              <tr key={wo.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <Link href={`/maintenance/work-orders/${wo.id}`} className="font-bold text-[#ED1C24] hover:underline">
                    {wo.work_order_number ?? "—"}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-[#4B5563]">{deptLabel(wo)}</td>
                <td className="px-4 py-2.5 text-[#4B5563]">{assetLabel(wo)}</td>
                <td className="px-4 py-2.5 text-[#4B5563]">{wo.maintenance_type ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <StatusTag status={wo.status ?? "—"} />
                </td>
                <td className="px-4 py-2.5">
                  <PriorityBadge priority={wo.priority} />
                </td>
                {mode === "blocked-operations" && (
                  <td className="px-4 py-2.5 font-bold text-[#DC2626]">
                    {age(wo.updated_at ?? wo.created_at)} days
                  </td>
                )}
                <td className="px-4 py-2.5">
                  <Link
                    href={`/maintenance/work-orders/${wo.id}`}
                    className={
                      mode === "blocked-operations"
                        ? "inline-flex items-center rounded bg-[#ED1C24] px-3 py-1 text-xs font-bold text-white hover:bg-[#c9151c]"
                        : "inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold hover:bg-gray-50"
                    }
                  >
                    {mode === "blocked-operations" ? "Escalate" : "View"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
