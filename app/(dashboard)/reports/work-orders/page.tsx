import Link from "next/link";

import { ExportButton } from "@/components/reports/export-button";
import { ReportFilterPanel } from "@/components/reports/report-filter-panel";
import { ReportSummaryGrid } from "@/components/reports/report-summary-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { canViewCosts, getFilterOptions, getWorkOrderReport, parseReportFilters } from "@/lib/reports/data";

export default async function WorkOrderReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requirePermission("reports.view");
  const rawParams = await searchParams;
  const filters = parseReportFilters(rawParams);
  const [options, report] = await Promise.all([getFilterOptions(), getWorkOrderReport(filters)]);
  const params = new URLSearchParams(Object.entries(rawParams).flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : value ? [[key, value]] : []));
  const showCosts = canViewCosts(context);

  return (
    <>
      <PageHeader
        title="Work Order Reports"
        description="Operational report for work order lifecycle, status, department, type, technician, priority, and trend monitoring."
        actions={<ExportButton kind="work-orders" searchParams={params} />}
      />
      <div className="space-y-5 p-4 lg:p-6">
        <ReportFilterPanel filters={filters} options={options} includeCosts={showCosts} />
        <ReportSummaryGrid cards={[
          { label: "Total work orders", value: report.stats.total, tone: "blue" },
          { label: "Open", value: report.stats.open, tone: "amber" },
          { label: "Closed", value: report.stats.closed, tone: "green" },
          { label: "Overdue", value: report.stats.overdue, tone: "red" },
          { label: "Pending approvals", value: report.stats.pendingApprovals, tone: "amber" },
          { label: "Waiting for parts", value: report.stats.waitingForParts, tone: "amber" },
          { label: "Waiting purchase", value: report.stats.waitingForPurchase, tone: "red" },
          { label: "Verified", value: report.stats.verifiedBySupervisor, tone: "green" }
        ]} />
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
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]"><tr><th className="px-3 py-2">WO</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Asset</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Worker</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Status</th>{showCosts ? <th className="px-3 py-2">Cost</th> : null}</tr></thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {report.rows.length ? report.rows.map((wo) => {
                  const department = Array.isArray(wo.departments) ? wo.departments[0] : wo.departments;
                  const asset = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
                  return (
                    <tr key={wo.id}>
                      <td className="px-3 py-2"><Link className="font-bold text-[#ED1C24]" href={`/maintenance/work-orders/${wo.id}`}>{wo.work_order_number}</Link></td>
                      <td className="px-3 py-2">{wo.date_of_order}</td>
                      <td className="px-3 py-2">{department?.name ?? "-"}</td>
                      <td className="px-3 py-2">{asset ? `${asset.asset_code} - ${asset.asset_name}` : "-"}</td>
                      <td className="px-3 py-2">{wo.maintenance_type}</td>
                      <td className="px-3 py-2">{wo.worker_type}</td>
                      <td className="px-3 py-2">{wo.priority}</td>
                      <td className="px-3 py-2">{wo.status}</td>
                      {showCosts ? <td className="px-3 py-2">{wo.total_work_order_cost}</td> : null}
                    </tr>
                  );
                }) : <tr><td className="px-3 py-4" colSpan={showCosts ? 9 : 8}><EmptyState title="No work orders found" message="Adjust filters or clear the date/status selections to show work order records." /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function GroupCard({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <h2 className="font-bold">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.length ? rows.slice(0, 8).map((row) => (
          <div key={row.label} className="flex justify-between gap-3 text-sm"><span className="text-[#4B5563]">{row.label}</span><span className="font-bold">{row.value}</span></div>
        )) : <EmptyState title="No grouped data" message="There are no matching records for this summary." />}
      </div>
    </section>
  );
}
