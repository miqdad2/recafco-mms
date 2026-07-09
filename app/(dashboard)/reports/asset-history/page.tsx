import Link from "next/link";

import { ReportSummaryGrid } from "@/components/reports/report-summary-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { getAssetRepairHistoryReport, getFilterOptions } from "@/lib/reports/data";

export default async function AssetRepairHistoryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("reports.view");
  const rawParams = await searchParams;

  const value = (key: string) => {
    const v = rawParams[key];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };

  const filters = {
    assetId: value("assetId"),
    dateFrom: value("dateFrom"),
    dateTo: value("dateTo"),
    status: value("status")
  };

  const [options, report] = await Promise.all([
    getFilterOptions(),
    getAssetRepairHistoryReport(filters)
  ]);

  const { rows, stats } = report;

  // Sort: most repairs first, then assets with open repairs
  const sorted = [...rows].sort(
    (a, b) => b.openRepairs - a.openRepairs || b.totalRepairs - a.totalRepairs
  );

  const statuses = [
    "Draft", "Submitted", "Approved", "Assigned", "In Progress",
    "Waiting for Parts", "Completed by Technician", "Closed", "Cancelled", "Rejected"
  ];

  return (
    <>
      <PageHeader
        title="Asset Repair History"
        description="View complete repair history by asset or machine."
      />

      <div className="space-y-5 p-4 lg:p-6">

        {/* Filters */}
        <form method="GET" className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            {options.assets.length > 0 && (
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
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-[#4B5563]">Status (RO)</label>
              <select
                name="status"
                defaultValue={filters.status ?? ""}
                className="h-9 rounded border border-[#E5E7EB] px-3 text-sm"
              >
                <option value="">All statuses</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="h-9 rounded bg-[#111827] px-4 text-sm font-bold text-white hover:bg-[#2B2B2B]">
              Apply
            </button>
            <a href="/reports/asset-history" className="inline-flex h-9 items-center rounded border border-[#E5E7EB] px-4 text-sm font-bold text-[#4B5563] hover:bg-gray-50">
              Clear
            </a>
          </div>
        </form>

        {/* Summary */}
        <ReportSummaryGrid
          cards={[
            { label: "Assets Tracked", value: stats.totalAssets, tone: "blue" },
            { label: "Total Repair Orders", value: stats.totalRepairs, tone: "blue" },
            { label: "Assets with Open ROs", value: stats.withOpenRepairs, tone: stats.withOpenRepairs > 0 ? "amber" : "green" }
          ]}
        />

        {/* Table */}
        <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] px-5 py-3">
            <h2 className="text-sm font-bold text-[#111827]">Asset Repair History</h2>
            <p className="text-xs text-[#4B5563]">{sorted.length} asset{sorted.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                <tr>
                  <th className="px-4 py-2.5">Asset Code</th>
                  <th className="px-4 py-2.5">Asset Name</th>
                  <th className="px-4 py-2.5">Category</th>
                  <th className="px-4 py-2.5">Location</th>
                  <th className="px-4 py-2.5">Total Repairs</th>
                  <th className="px-4 py-2.5">Last Repair</th>
                  <th className="px-4 py-2.5">Open ROs</th>
                  <th className="px-4 py-2.5">Waiting Parts</th>
                  <th className="px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {!sorted.length && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8">
                      <EmptyState
                        title="No repair history found"
                        message="No repair orders have been created yet. Asset repair history will appear here after repair orders are submitted."
                      />
                    </td>
                  </tr>
                )}
                {sorted.map((asset) => (
                  <tr key={asset.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-bold text-[#ED1C24]">{asset.asset_code}</td>
                    <td className="px-4 py-2.5 text-[#111827]">{asset.asset_name}</td>
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{asset.category}</td>
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{asset.location ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`font-bold ${asset.totalRepairs > 5 ? "text-amber-600" : "text-[#111827]"}`}>
                        {asset.totalRepairs}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{asset.lastRepairDate ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {asset.openRepairs > 0 ? (
                        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                          {asset.openRepairs}
                        </span>
                      ) : (
                        <span className="text-xs text-[#9CA3AF]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {asset.waitingParts > 0 ? (
                        <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">
                          {asset.waitingParts}
                        </span>
                      ) : (
                        <span className="text-xs text-[#9CA3AF]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-2">
                        <Link
                          href={`/assets/${asset.id}`}
                          className="inline-flex items-center rounded border border-[#E5E7EB] px-2.5 py-1 text-xs font-bold transition hover:bg-gray-50"
                        >
                          View Asset
                        </Link>
                        <Link
                          href={`/maintenance/work-orders?assetId=${asset.id}`}
                          className="inline-flex items-center rounded border border-[#E5E7EB] px-2.5 py-1 text-xs font-bold transition hover:bg-gray-50"
                        >
                          Repair Orders
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
