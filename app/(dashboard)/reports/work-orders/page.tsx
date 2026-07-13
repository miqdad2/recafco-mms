import Link from "next/link";
import { BookOpen } from "lucide-react";

import { ExportButton } from "@/components/reports/export-button";
import { ReportFilterPanel } from "@/components/reports/report-filter-panel";
import { ReportModeNav } from "@/components/reports/report-mode-nav";
import { ReportSummaryGrid } from "@/components/reports/report-summary-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { displayStatus } from "@/lib/display/work-order-labels";
import {
  getFilterOptions,
  getMgrFilterOptions,
  getWorkOrderReport,
  parseReportFilters,
  parseReportMode
} from "@/lib/reports/data";
import type { ReportFilters, ReportMode } from "@/lib/reports/data";

// ─── Types ────────────────────────────────────────────────────────────────────

type SummaryTone = "red" | "amber" | "green" | "blue" | "gray";
type SummaryCard = { label: string; value: string | number; tone: SummaryTone };
type GroupRow = { label: string; value: number };
type GroupCardDef = { title: string; rows: GroupRow[] };

// ─── Mode metadata ────────────────────────────────────────────────────────────

const MODE_META: Record<ReportMode, { label: string; description: string }> = {
  overdue: {
    label: "Overdue Job Cards",
    description: "Open job cards delayed past their planned start date."
  },
  "waiting-parts": {
    label: "Waiting for Materials",
    description: "Job cards currently blocked by materials availability."
  },
  "asset-history": {
    label: "Asset Job Card History",
    description: "All job cards per asset — identify repeated issues or high-maintenance equipment."
  },
  "monthly-summary": {
    label: "Monthly Job Card Summary",
    description: "Job cards this month grouped by status and maintenance type."
  },
  "technician-workload": {
    label: "Technician / Team Workload",
    description: "Active and recently completed job cards per technician or worker team."
  }
};

// ─── Filter fields per mode ───────────────────────────────────────────────────

function modeVisibleFields(mode: ReportMode): string[] {
  switch (mode) {
    case "overdue":
      return ["dateFrom", "dateTo", "assetId", "technicianId"];
    case "waiting-parts":
      return ["assetId", "maintenanceType"];
    case "asset-history":
      return ["assetId", "maintenanceType", "dateFrom", "dateTo"];
    case "monthly-summary":
      return ["dateFrom", "dateTo", "status", "maintenanceType", "workerType"];
    case "technician-workload":
      return ["technicianId", "dateFrom", "dateTo"];
    default:
      return ["dateFrom", "dateTo", "status", "assetId", "technicianId"];
  }
}

// ─── Age helper ────────────────────────────────────────────────────────────────

function daysAgo(date: string | null | undefined): number {
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));
}

// ─── Mode summary cards ───────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function computeModeSummary(rows: any[], mode: ReportMode): SummaryCard[] {
  switch (mode) {
    case "overdue": {
      const breakdowns = rows.filter((r: any) => r.maintenance_type === "Breakdown").length;
      const ages = rows.map((r: any) => daysAgo(r.starting_datetime ?? r.created_at));
      const avg = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
      const oldest = ages.length ? Math.max(...ages) : 0;
      return [
        { label: "Overdue", value: rows.length, tone: rows.length > 0 ? "red" : "green" },
        { label: "Breakdown type", value: breakdowns, tone: breakdowns > 0 ? "amber" : "green" },
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
        { label: "Waiting for materials", value: waitP, tone: waitP > 0 ? "amber" : "green" },
        { label: "Waiting for purchase", value: waitPu, tone: waitPu > 0 ? "red" : "green" },
        { label: "Parts issued (pending)", value: rows.filter((r) => r.status === "Parts Issued").length, tone: "blue" },
        { label: "Oldest blocked (days)", value: oldest, tone: oldest > 14 ? "red" : oldest > 7 ? "amber" : "green" }
      ];
    }
    case "asset-history": {
      const assetIds = new Set(rows.map((r) => r.asset_id).filter(Boolean));
      const breakdowns = rows.filter((r) => r.maintenance_type === "Breakdown").length;
      return [
        { label: "Total job cards", value: rows.length, tone: "blue" },
        { label: "Assets affected", value: assetIds.size, tone: "blue" },
        { label: "Breakdown type", value: breakdowns, tone: breakdowns > 3 ? "red" : "amber" },
        { label: "Other maintenance types", value: rows.length - breakdowns, tone: "gray" }
      ];
    }
    case "monthly-summary": {
      const completed = rows.filter((r) =>
        ["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester", "Closed"].includes(r.status)
      ).length;
      const inProgress = rows.filter((r) => ["In Progress", "Parts Issued"].includes(r.status)).length;
      const waiting = rows.filter((r) => ["Waiting for Parts", "Waiting for Purchase"].includes(r.status)).length;
      return [
        { label: "Total created", value: rows.length, tone: "blue" },
        { label: "In progress", value: inProgress, tone: inProgress > 0 ? "amber" : "green" },
        { label: "Waiting for materials", value: waiting, tone: waiting > 0 ? "amber" : "green" },
        { label: "Completed / Closed", value: completed, tone: completed > 0 ? "green" : "gray" }
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

  switch (mode) {
    case "overdue":
      return [{ title: "By Asset", rows: byAsset() }, { title: "By Technician", rows: byTechnician() }];
    case "waiting-parts":
      return [{ title: "By Asset", rows: byAsset() }, { title: "By Status", rows: byStatus() }];
    case "asset-history":
      return [{ title: "By Asset (top repeated)", rows: byAsset() }, { title: "By Type", rows: byType() }];
    case "monthly-summary":
      return [{ title: "By Status", rows: byStatus() }, { title: "By Type", rows: byType() }, { title: "By Month", rows: byMonth() }];
    case "technician-workload":
      return [{ title: "By Technician", rows: byTechnician() }, { title: "By Type", rows: byType() }];
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
  const mgrDeptId = isManager ? (context.department?.id ?? null) : null;
  const deptName = context.department?.name ?? "Maintenance Department";

  const reportMode = parseReportMode(rawParams["report"]);
  const baseFilters = parseReportFilters(rawParams);
  // eslint-disable-next-line react-hooks/purity
  const renderNow = Date.now();

  const filters: ReportFilters = { ...baseFilters };
  if (mgrDeptId) filters.departmentId = mgrDeptId;

  if (isManager) {
    switch (reportMode) {
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

  const adminCards: SummaryCard[] = [
    { label: "Total Job Cards", value: report.stats.total, tone: "blue" },
    { label: "Open", value: report.stats.open, tone: "amber" },
    { label: "In Progress", value: report.stats.inProgress, tone: "amber" },
    { label: "Waiting for Materials", value: report.stats.waitingForParts, tone: "amber" },
    { label: "Completed", value: report.stats.completed, tone: "green" },
    { label: "Closed", value: report.stats.closed, tone: "green" },
    { label: "Overdue", value: report.stats.overdue, tone: "red" }
  ];

  return (
    <>
      <PageHeader
        title="Job Card Summary"
        description={
          isManager
            ? `${deptName} — overdue, blocked, asset history, monthly summary, and technician workload.`
            : "Overview of all job cards by status, type, and monthly trend."
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
            <div className="flex items-center gap-2.5 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
              <BookOpen className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
              <span>
                <strong>Scope: {deptName}</strong> — All data is scoped to your department.
              </span>
            </div>

            <ReportModeNav selectedMode={reportMode} />

            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">{deptName}</p>
                <h2 className="mt-0.5 text-base font-bold text-[#111827]">{meta.label}</h2>
                <p className="mt-0.5 text-sm text-[#4B5563]">{meta.description}</p>
              </div>
              <span className="hidden shrink-0 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700 sm:block">
                {deptName}
              </span>
            </div>

            <ReportFilterPanel
              filters={baseFilters}
              options={options}
              includeCosts={false}
              lockedDepartmentId={mgrDeptId ?? undefined}
              deptName={deptName}
              visibleFields={modeVisibleFields(reportMode)}
              reportMode={reportMode}
            />

            {modeSummaryCards.length > 0 && <ReportSummaryGrid cards={modeSummaryCards} />}

            {modeGroups.length > 0 && (
              <div className={`grid gap-4 ${modeGroups.length >= 3 ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
                {modeGroups.map((gc) => (
                  <GroupCard key={gc.title} title={gc.title} rows={gc.rows} />
                ))}
              </div>
            )}

            <ManagerWOTable rows={rows} mode={reportMode} deptName={deptName} renderNow={renderNow} />
          </>
        ) : (
          <>
            <ReportFilterPanel filters={baseFilters} options={options} includeCosts={false} />
            <ReportSummaryGrid cards={adminCards} />
            <div className="grid gap-5 xl:grid-cols-3">
              <GroupCard title="By Status" rows={report.byStatus} />
              <GroupCard title="By Type" rows={report.byType} />
              <GroupCard title="Monthly Trend" rows={report.monthlyTrend} />
            </div>
            <AdminWOTable rows={rows} />
          </>
        )}
      </div>
    </>
  );
}

// ─── Shared ────────────────────────────────────────────────────────────────────

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

function StatusTag({ status }: { status: string }) {
  const toneMap: Record<string, string> = {
    Draft: "bg-gray-100 text-gray-500",
    Submitted: "bg-blue-100 text-blue-700",
    "Pending Approval": "bg-amber-100 text-amber-700", // kept for map lookup; display label remapped below
    "Manager Review":   "bg-amber-100 text-amber-700",
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
    Cancelled: "bg-gray-100 text-gray-500",
    Reopened: "bg-amber-100 text-amber-700"
  };
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${toneMap[status] ?? "bg-gray-100 text-gray-500"}`}>
      {displayStatus(status)}
    </span>
  );
}

// ─── Admin table (super-admin / full view) ────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function AdminWOTable({ rows }: { rows: any[] }) {
  const assetLabel = (wo: any) => {
    const a = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
    return a ? `${a.asset_code} – ${a.asset_name}` : "—";
  };
  const techName = (wo: any) => {
    const assigns = Array.isArray(wo.work_order_assignments) ? wo.work_order_assignments : [];
    return (assigns[0] as any)?.profiles?.full_name ?? "—";
  };

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#111827]">Job Card List</h2>
          <p className="text-xs text-[#4B5563]">{rows.length} record{rows.length !== 1 ? "s" : ""}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wide text-[#4B5563]">
            <tr>
              <th className="px-4 py-2.5">Job Card</th>
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Asset / Machine</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Technician</th>
              <th className="px-4 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8">
                  <EmptyState
                    title="No job cards found"
                    message="No job card data yet. Reports will appear after job cards are created and updated."
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
                <td className="px-4 py-2.5 text-xs text-[#4B5563]">{wo.date_of_order?.slice(0, 10) ?? "—"}</td>
                <td className="px-4 py-2.5 text-[#4B5563]">{assetLabel(wo)}</td>
                <td className="px-4 py-2.5 text-[#4B5563]">{wo.maintenance_type ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <StatusTag status={wo.status ?? "—"} />
                </td>
                <td className="px-4 py-2.5 text-[#4B5563]">{techName(wo)}</td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/maintenance/work-orders/${wo.id}`}
                    className="inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50"
                  >
                    View
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

// ─── Manager table ────────────────────────────────────────────────────────────

function ManagerWOTable({
  rows,
  mode,
  deptName,
  renderNow
}: {
  rows: any[];
  mode: ReportMode;
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

  const colCount = mode === "technician-workload" ? 5 : 6;

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#111827]">Repair Order List — {deptName}</h2>
          <p className="text-xs text-[#4B5563]">{rows.length} record{rows.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wide text-[#4B5563]">
            <tr>
              {mode === "overdue" && (
                <>
                  <th className="px-4 py-2.5">Job Card</th>
                  <th className="px-4 py-2.5">Asset / Machine</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Technician</th>
                  <th className="px-4 py-2.5">Overdue (days)</th>
                  <th className="px-4 py-2.5">Action</th>
                </>
              )}
              {mode === "waiting-parts" && (
                <>
                  <th className="px-4 py-2.5">Job Card</th>
                  <th className="px-4 py-2.5">Asset / Machine</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Created (age)</th>
                  <th className="px-4 py-2.5">Action</th>
                </>
              )}
              {mode === "asset-history" && (
                <>
                  <th className="px-4 py-2.5">Job Card</th>
                  <th className="px-4 py-2.5">Asset / Machine</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Action</th>
                </>
              )}
              {mode === "monthly-summary" && (
                <>
                  <th className="px-4 py-2.5">Job Card</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Asset / Machine</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Action</th>
                </>
              )}
              {mode === "technician-workload" && (
                <>
                  <th className="px-4 py-2.5">Job Card</th>
                  <th className="px-4 py-2.5">Technician</th>
                  <th className="px-4 py-2.5">Asset / Machine</th>
                  <th className="px-4 py-2.5">Status</th>
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
                    message="No job cards match the current filters. Try clearing filters or selecting a different date range."
                  />
                </td>
              </tr>
            )}
            {rows.map((wo) => (
              <tr key={wo.id} className="hover:bg-gray-50">
                {mode === "overdue" && (
                  <>
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/work-orders/${wo.id}`} className="font-bold text-[#ED1C24] hover:underline">
                        {wo.work_order_number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{assetLabel(wo)}</td>
                    <td className="px-4 py-2.5"><StatusTag status={wo.status} /></td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{techName(wo)}</td>
                    <td className="px-4 py-2.5 font-bold text-[#DC2626]">{age(wo.starting_datetime)} days</td>
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/work-orders/${wo.id}`} className="inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50">
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
                    <td className="px-4 py-2.5"><StatusTag status={wo.status} /></td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{wo.maintenance_type ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{age(wo.created_at)} days</td>
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/work-orders/${wo.id}`} className="inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50">
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
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{wo.date_of_order?.slice(0, 10) ?? "—"}</td>
                    <td className="px-4 py-2.5"><StatusTag status={wo.status} /></td>
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/work-orders/${wo.id}`} className="inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50">
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
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{wo.date_of_order?.slice(0, 10) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{assetLabel(wo)}</td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{wo.maintenance_type ?? "—"}</td>
                    <td className="px-4 py-2.5"><StatusTag status={wo.status} /></td>
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/work-orders/${wo.id}`} className="inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50">
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
                    <td className="px-4 py-2.5"><StatusTag status={wo.status} /></td>
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/work-orders/${wo.id}`} className="inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50">
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
