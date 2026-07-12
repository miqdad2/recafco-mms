import { Package } from "lucide-react";

import { ReportSummaryGrid } from "@/components/reports/report-summary-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { getFilterOptions, getSparePartsUsageReport } from "@/lib/reports/data";

export default async function SparePartsUsagePage({
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
    dateFrom: value("dateFrom"),
    dateTo: value("dateTo"),
    assetId: value("assetId")
  };

  const [options, report] = await Promise.all([getFilterOptions(), getSparePartsUsageReport(filters)]);

  const rows = report.rows;

  const uniqueParts = new Set(rows.map((r) => r.part_code).filter(Boolean)).size;
  const totalQty = rows.reduce((n, r) => n + r.quantity, 0);

  return (
    <>
      <PageHeader
        title="Materials Usage"
        description="Track materials used across job cards and assets."
      />

      <div className="space-y-5 p-4 lg:p-6">

        {/* Filters */}
        <form method="GET" className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
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
            <button type="submit" className="h-9 rounded bg-[#111827] px-4 text-sm font-bold text-white hover:bg-[#2B2B2B]">
              Apply
            </button>
            <a href="/reports/spare-parts-usage" className="inline-flex h-9 items-center rounded border border-[#E5E7EB] px-4 text-sm font-bold text-[#4B5563] hover:bg-gray-50">
              Clear
            </a>
          </div>
        </form>

        {/* Summary */}
        {rows.length > 0 && (
          <ReportSummaryGrid
            cards={[
              { label: "Parts Usage Records", value: rows.length, tone: "blue" },
              { label: "Unique Parts Used", value: uniqueParts, tone: "blue" },
              { label: "Total Quantity", value: totalQty, tone: "green" }
            ]}
          />
        )}

        {/* Table */}
        <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] px-5 py-3">
            <h2 className="text-sm font-bold text-[#111827]">Materials Used in Job Cards</h2>
            <p className="text-xs text-[#4B5563]">{rows.length} record{rows.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                <tr>
                  <th className="px-4 py-2.5">Part</th>
                  <th className="px-4 py-2.5">Part No.</th>
                  <th className="px-4 py-2.5">Qty Used</th>
                  <th className="px-4 py-2.5">Asset / Machine</th>
                  <th className="px-4 py-2.5">Job Card</th>
                  <th className="px-4 py-2.5">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {!rows.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                          <Package className="h-6 w-6 text-[#9CA3AF]" aria-hidden="true" />
                        </div>
                        <EmptyState
                          title="No parts usage data yet"
                          message="Materials usage records will appear here after materials are added to job cards."
                        />
                      </div>
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-[#111827]">{row.part_name}</p>
                      {row.part_code && (
                        <p className="text-xs text-[#9CA3AF]">{row.part_code}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{row.part_number ?? "—"}</td>
                    <td className="px-4 py-2.5 font-bold text-[#111827]">{row.quantity}</td>
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{row.asset}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-[#ED1C24]">{row.work_order_number}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{row.date}</td>
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
