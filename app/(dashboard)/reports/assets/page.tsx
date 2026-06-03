import Link from "next/link";

import { ExportButton } from "@/components/reports/export-button";
import { ReportFilterPanel } from "@/components/reports/report-filter-panel";
import { ReportSummaryGrid } from "@/components/reports/report-summary-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { getAssetReport, getFilterOptions, parseReportFilters } from "@/lib/reports/data";

export default async function AssetReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("reports.view");
  const rawParams = await searchParams;
  const filters = parseReportFilters(rawParams);
  const [options, report] = await Promise.all([getFilterOptions(), getAssetReport(filters)]);
  const params = new URLSearchParams(Object.entries(rawParams).flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : value ? [[key, value]] : []));

  return (
    <>
      <PageHeader title="Asset Reports" description="Asset list, maintenance history indicators, expiry alerts, breakdown ranking, and next service due." actions={<ExportButton kind="assets" searchParams={params} />} />
      <div className="space-y-5 p-4 lg:p-6">
        <ReportFilterPanel filters={filters} options={options} />
        <ReportSummaryGrid cards={[
          { label: "Assets", value: report.stats.total, tone: "blue" },
          { label: "Under maintenance", value: report.stats.underMaintenance, tone: "amber" },
          { label: "Waiting parts", value: report.stats.waitingForParts, tone: "amber" },
          { label: "Breakdown", value: report.stats.breakdown, tone: "red" },
          { label: "Next service due", value: report.stats.nextServiceDue, tone: "green" },
          { label: "Registration expiry", value: report.stats.registrationExpiry, tone: "amber" },
          { label: "Insurance expiry", value: report.stats.insuranceExpiry, tone: "amber" },
          { label: "Warranty expiry", value: report.stats.warrantyExpiry, tone: "amber" }
        ]} />
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Top Breakdown Assets</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {report.topBreakdownAssets.length ? report.topBreakdownAssets.map((asset) => (
              <Link key={asset.id} href={`/assets/${asset.id}`} className="rounded-md border border-[#E5E7EB] p-3 hover:border-[#ED1C24]">
                <p className="font-bold text-[#111827]">{asset.asset_code}</p>
                <p className="text-sm text-[#4B5563]">{asset.asset_name}</p>
                <p className="mt-2 text-sm font-bold text-[#ED1C24]">{asset.breakdownCount} breakdown WOs</p>
              </Link>
            )) : <div className="md:col-span-2 xl:col-span-5"><EmptyState title="No breakdown assets" message="No matching breakdown history is available for the selected filters." /></div>}
          </div>
        </section>
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Asset List</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]"><tr><th className="px-3 py-2">Asset</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">KM</th><th className="px-3 py-2">Hours</th><th className="px-3 py-2">Next service</th><th className="px-3 py-2">Registration</th><th className="px-3 py-2">Insurance</th><th className="px-3 py-2">Warranty</th></tr></thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {report.rows.length ? report.rows.map((asset) => {
                  const department = Array.isArray(asset.departments) ? asset.departments[0] : asset.departments;
                  return (
                    <tr key={asset.id}>
                      <td className="px-3 py-2"><Link href={`/assets/${asset.id}`} className="font-bold text-[#ED1C24]">{asset.asset_code} - {asset.asset_name}</Link></td>
                      <td className="px-3 py-2">{asset.category}</td>
                      <td className="px-3 py-2">{department?.name ?? "-"}</td>
                      <td className="px-3 py-2">{asset.status}</td>
                      <td className="px-3 py-2">{asset.current_kilometer_reading ?? "-"}</td>
                      <td className="px-3 py-2">{asset.current_running_hours ?? "-"}</td>
                      <td className="px-3 py-2">{asset.next_service_date ?? "-"}</td>
                      <td className="px-3 py-2">{asset.registration_expiry_date ?? "-"}</td>
                      <td className="px-3 py-2">{asset.insurance_expiry_date ?? "-"}</td>
                      <td className="px-3 py-2">{asset.warranty_expiry_date ?? "-"}</td>
                    </tr>
                  );
                }) : <tr><td className="px-3 py-4" colSpan={10}><EmptyState title="No assets found" message="Adjust filters or clear selections to show asset records." /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
