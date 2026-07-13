import Link from "next/link";

import { ExportButton } from "@/components/reports/export-button";
import { ReportSummaryGrid } from "@/components/reports/report-summary-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { getAssetReport, parseReportFilters } from "@/lib/reports/data";

export default async function CriticalAssetReportPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("reports.view");
  const rawParams = await searchParams;
  const filters = parseReportFilters(rawParams);
  const report = await getAssetReport(filters);
  const params = new URLSearchParams(
    Object.entries(rawParams).flatMap(([key, value]) =>
      Array.isArray(value) ? value.map((item) => [key, item]) : value ? [[key, value]] : []
    )
  );

  const allRows = report.rows;

  const viewParam = (rawParams["view"] as string | undefined) ?? "critical";
  const showAll = viewParam === "register";

  // Critical: breakdown or active maintenance status
  const criticalRows = allRows.filter(
    (a) =>
      a.status === "Breakdown" ||
      a.status === "Waiting for Parts" ||
      a.status === "Under Maintenance"
  );

  const displayRows = showAll ? allRows : criticalRows;

  const summaryCards = [
    { label: "Total Assets", value: report.stats.total, tone: "blue" as const },
    { label: "Breakdown", value: report.stats.breakdown, tone: "red" as const },
    { label: "Under Maintenance", value: report.stats.underMaintenance, tone: "amber" as const },
    { label: "Waiting for Parts", value: report.stats.waitingForParts, tone: "amber" as const },
    { label: "Next Service Due (30d)", value: report.stats.nextServiceDue, tone: "green" as const },
    { label: "Registration Expiry (30d)", value: report.stats.registrationExpiry, tone: "amber" as const },
    { label: "Insurance Expiry (30d)", value: report.stats.insuranceExpiry, tone: "amber" as const },
    { label: "Warranty Expiry (30d)", value: report.stats.warrantyExpiry, tone: "amber" as const }
  ];

  return (
    <>
      <PageHeader
        title="Critical Asset Report"
        description="Monitor breakdown, under-maintenance, and repeated-issue assets."
        actions={<ExportButton kind="assets" searchParams={params} />}
      />

      <div className="space-y-5 p-4 lg:p-6">

        <ReportSummaryGrid cards={summaryCards} />

        {/* Top breakdown assets */}
        {report.topBreakdownAssets.length > 0 && (
          <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-[#111827]">Assets with Most Breakdown Repair Orders</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {report.topBreakdownAssets.map((asset) => (
                <Link
                  key={asset.id}
                  href={`/assets/${asset.id}`}
                  className="rounded-md border border-[#E5E7EB] p-3 hover:border-[#ED1C24] transition-colors"
                >
                  <p className="font-bold text-[#111827]">{asset.asset_code}</p>
                  <p className="text-sm text-[#4B5563]">{asset.asset_name}</p>
                  <p className="mt-2 text-sm font-bold text-[#ED1C24]">{asset.breakdownCount} breakdown ROs</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* View toggle */}
        <div className="flex gap-2">
          <Link
            href="?view=critical"
            className={`rounded-md border px-4 py-2 text-sm font-semibold transition ${
              !showAll
                ? "border-[#ED1C24] bg-red-50 text-[#ED1C24]"
                : "border-[#E5E7EB] bg-white text-[#4B5563] hover:bg-gray-50"
            }`}
          >
            Critical Assets ({criticalRows.length})
          </Link>
          <Link
            href="?view=register"
            className={`rounded-md border px-4 py-2 text-sm font-semibold transition ${
              showAll
                ? "border-[#ED1C24] bg-red-50 text-[#ED1C24]"
                : "border-[#E5E7EB] bg-white text-[#4B5563] hover:bg-gray-50"
            }`}
          >
            All Assets ({allRows.length})
          </Link>
        </div>

        {/* Asset table */}
        <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] px-5 py-3">
            <h2 className="text-sm font-bold text-[#111827]">
              {showAll ? "All Assets" : "Critical / Breakdown Assets"}
            </h2>
            <p className="text-xs text-[#4B5563]">{displayRows.length} record{displayRows.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                <tr>
                  <th className="px-4 py-2.5">Asset</th>
                  <th className="px-4 py-2.5">Category</th>
                  <th className="px-4 py-2.5">Location</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Open ROs</th>
                  <th className="px-4 py-2.5">Last Repair</th>
                  <th className="px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {!displayRows.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8">
                      <EmptyState
                        title={showAll ? "No assets found" : "No critical assets found"}
                        message={
                          showAll
                            ? "No assets have been added yet. Import assets to see them here."
                            : "No assets are currently in breakdown, under maintenance, or waiting for parts."
                        }
                      />
                    </td>
                  </tr>
                )}
                {displayRows.map((asset) => {
                  const openWOs = asset.work_orders.filter(
                    (wo) => !["Closed", "Cancelled", "Rejected"].includes(wo.status)
                  ).length;
                  const allWOs = asset.work_orders;

                  const statusColor =
                    asset.status === "Breakdown"
                      ? "bg-red-100 text-red-700"
                      : asset.status === "Under Maintenance" || asset.status === "Waiting for Parts"
                        ? "bg-amber-100 text-amber-700"
                        : asset.status === "Active" || asset.status === "In Use"
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500";

                  return (
                    <tr key={asset.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <Link href={`/assets/${asset.id}`} className="font-bold text-[#ED1C24] hover:underline">
                          {asset.asset_code}
                        </Link>
                        <p className="text-xs text-[#4B5563]">{asset.asset_name}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[#4B5563]">{asset.category}</td>
                      <td className="px-4 py-2.5 text-xs text-[#4B5563]">{asset.location ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${statusColor}`}>
                          {asset.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {openWOs > 0 ? (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                            {openWOs}
                          </span>
                        ) : (
                          <span className="text-xs text-[#9CA3AF]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[#4B5563]">
                        {allWOs.length > 0 ? `${allWOs.length} total ROs` : "—"}
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
                            ROs
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
