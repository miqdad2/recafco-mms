import Link from "next/link";

import { ExportButton } from "@/components/reports/export-button";
import { ReportFilterPanel } from "@/components/reports/report-filter-panel";
import { ReportSummaryGrid } from "@/components/reports/report-summary-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { getFilterOptions, getPreventiveReport, parseReportFilters } from "@/lib/reports/data";

export default async function PreventiveMaintenanceReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("reports.view");
  const rawParams = await searchParams;
  const filters = parseReportFilters(rawParams);
  const [options, report] = await Promise.all([getFilterOptions(), getPreventiveReport(filters)]);
  const params = new URLSearchParams(Object.entries(rawParams).flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : value ? [[key, value]] : []));

  return (
    <>
      <PageHeader title="Preventive Maintenance Due" description="Next service due by date, kilometer, and running hours, with overdue and upcoming 7/15/30 day windows." actions={<ExportButton kind="preventive-maintenance" searchParams={params} />} />
      <div className="space-y-5 p-4 lg:p-6">
        <ReportFilterPanel filters={filters} options={options} />
        <ReportSummaryGrid cards={[
          { label: "Overdue PM", value: report.stats.overdue, tone: "red" },
          { label: "Due in 7 days", value: report.stats.due7, tone: "amber" },
          { label: "Due in 15 days", value: report.stats.due15, tone: "amber" },
          { label: "Due in 30 days", value: report.stats.due30, tone: "green" },
          { label: "Due by KM", value: report.stats.dueByKm, tone: "blue" },
          { label: "Due by hours", value: report.stats.dueByHours, tone: "blue" }
        ]} />
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Preventive Maintenance Schedule</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]"><tr><th className="px-3 py-2">Asset</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Current KM</th><th className="px-3 py-2">Next KM</th><th className="px-3 py-2">Current Hours</th><th className="px-3 py-2">Next Hours</th><th className="px-3 py-2">Next Date</th><th className="px-3 py-2">Notes</th></tr></thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {report.rows.length ? report.rows.map((asset) => {
                  const department = Array.isArray(asset.departments) ? asset.departments[0] : asset.departments;
                  return (
                    <tr key={asset.id}>
                      <td className="px-3 py-2"><Link href={`/assets/${asset.id}`} className="font-bold text-[#ED1C24]">{asset.asset_code} - {asset.asset_name}</Link></td>
                      <td className="px-3 py-2">{department?.name ?? "-"}</td>
                      <td className="px-3 py-2">{asset.status}</td>
                      <td className="px-3 py-2">{asset.current_kilometer_reading ?? "-"}</td>
                      <td className="px-3 py-2">{asset.next_service_kilometer ?? "-"}</td>
                      <td className="px-3 py-2">{asset.current_running_hours ?? "-"}</td>
                      <td className="px-3 py-2">{asset.next_service_running_hours ?? "-"}</td>
                      <td className="px-3 py-2">{asset.next_service_date ?? "-"}</td>
                      <td className="px-3 py-2">{asset.notes ?? "-"}</td>
                    </tr>
                  );
                }) : <tr><td className="px-3 py-4" colSpan={9}><EmptyState title="No preventive maintenance records" message="No assets match the selected preventive maintenance filters." /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
