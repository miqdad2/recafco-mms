import Link from "next/link";
import { redirect } from "next/navigation";

import { ExportButton } from "@/components/reports/export-button";
import { ReportFilterPanel } from "@/components/reports/report-filter-panel";
import { ReportSummaryGrid } from "@/components/reports/report-summary-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/context";
import { canViewCosts, getCostReport, getFilterOptions, parseReportFilters } from "@/lib/reports/data";

export default async function CostReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireUser();
  if (!canViewCosts(context)) redirect("/dashboard?error=cost-permission-denied");
  const rawParams = await searchParams;
  const filters = parseReportFilters(rawParams);
  const [options, report] = await Promise.all([getFilterOptions(), getCostReport(filters)]);
  const params = new URLSearchParams(Object.entries(rawParams).flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : value ? [[key, value]] : []));

  return (
    <>
      <PageHeader title="Cost Reports" description="Permission-protected cost visibility for labor, materials, purchase cost, departments, assets, monthly trend, and top used parts." actions={<ExportButton kind="costs" searchParams={params} />} />
      <div className="space-y-5 p-4 lg:p-6">
        <ReportFilterPanel filters={filters} options={options} includeCosts />
        <ReportSummaryGrid cards={[
          { label: "Total maintenance cost", value: report.stats.totalCost.toFixed(3), tone: "red" },
          { label: "Labor cost", value: report.stats.laborCost.toFixed(3), tone: "blue" },
          { label: "Material cost", value: report.stats.materialCost.toFixed(3), tone: "amber" },
          { label: "Purchase cost", value: report.stats.purchaseCost.toFixed(3), tone: "green" }
        ]} />
        <div className="grid gap-5 xl:grid-cols-3">
          <MoneyGroup title="Cost by Department" rows={report.byDepartment} />
          <MoneyGroup title="Monthly Cost Trend" rows={report.monthlyTrend} />
          <MoneyGroup title="Top Expensive Assets" rows={report.topExpensiveAssets} />
        </div>
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Work Order Cost Detail</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]"><tr><th className="px-3 py-2">WO</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Asset</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Labor</th><th className="px-3 py-2">Material</th><th className="px-3 py-2">Total</th></tr></thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {report.rows.length ? report.rows.map((wo) => {
                  const department = Array.isArray(wo.departments) ? wo.departments[0] : wo.departments;
                  const asset = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
                  return (
                    <tr key={wo.id}>
                      <td className="px-3 py-2"><Link className="font-bold text-[#ED1C24]" href={`/maintenance/work-orders/${wo.id}`}>{wo.work_order_number}</Link></td>
                      <td className="px-3 py-2">{wo.date_of_order}</td>
                      <td className="px-3 py-2">{asset ? `${asset.asset_code} - ${asset.asset_name}` : "-"}</td>
                      <td className="px-3 py-2">{department?.name ?? "-"}</td>
                      <td className="px-3 py-2">{wo.total_labor_cost}</td>
                      <td className="px-3 py-2">{wo.total_material_cost}</td>
                      <td className="px-3 py-2 font-bold">{wo.total_work_order_cost}</td>
                    </tr>
                  );
                }) : <tr><td className="px-3 py-4" colSpan={7}><EmptyState title="No cost records found" message="No matching work order costs are available for the selected filters." /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function MoneyGroup({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <h2 className="font-bold">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.length ? rows.slice(0, 8).map((row) => <div key={row.label} className="flex justify-between gap-3 text-sm"><span className="text-[#4B5563]">{row.label}</span><span className="font-bold">{row.value.toFixed(3)}</span></div>) : <EmptyState title="No cost summary" message="There are no matching costs for this summary." />}
      </div>
    </section>
  );
}
