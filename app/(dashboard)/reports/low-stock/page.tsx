import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { ExportButton } from "@/components/reports/export-button";
import { ReportSummaryGrid } from "@/components/reports/report-summary-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { getLowStockReport } from "@/lib/reports/data";

export default async function LowStockReportPage() {
  await requirePermission("reports.view");
  const report = await getLowStockReport();
  const { rows, stats } = report;

  const summaryCards = [
    { label: "Total Materials", value: stats.total, tone: "blue" as const },
    { label: "Below Minimum Stock", value: stats.lowStock, tone: stats.lowStock > 0 ? ("red" as const) : ("green" as const) },
    { label: "Out of Stock", value: stats.outOfStock, tone: stats.outOfStock > 0 ? ("red" as const) : ("green" as const) }
  ];

  return (
    <>
      <PageHeader
        title="Low Stock Materials"
        description="Review materials below minimum stock and unavailable items."
        actions={<ExportButton kind="parts" label="Export Excel" />}
      />

      <div className="space-y-5 p-4 lg:p-6">

        <ReportSummaryGrid cards={summaryCards} />

        {stats.lowStock > 0 && (
          <div className="flex items-center gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              <strong>{stats.lowStock} part{stats.lowStock !== 1 ? "s" : ""}</strong> are at or below minimum stock level.
              {stats.outOfStock > 0 && ` ${stats.outOfStock} of these are completely out of stock.`}
            </span>
          </div>
        )}

        <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] px-5 py-3">
            <h2 className="text-sm font-bold text-[#111827]">Parts Below Minimum Stock</h2>
            <p className="text-xs text-[#4B5563]">{rows.length} record{rows.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                <tr>
                  <th className="px-4 py-2.5">Part</th>
                  <th className="px-4 py-2.5">Part No.</th>
                  <th className="px-4 py-2.5">Current Stock</th>
                  <th className="px-4 py-2.5">Minimum Stock</th>
                  <th className="px-4 py-2.5">Shortage</th>
                  <th className="px-4 py-2.5">Supplier</th>
                  <th className="px-4 py-2.5">Bin</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {!rows.length && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8">
                      <EmptyState
                        title="All parts are sufficiently stocked"
                        message="No materials are currently below minimum stock levels."
                      />
                    </td>
                  </tr>
                )}
                {rows.map((part) => (
                  <tr key={part.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-[#111827]">{part.part_name}</p>
                      <p className="text-xs text-[#9CA3AF]">{part.part_code}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{part.part_number ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`font-bold ${part.is_out ? "text-[#DC2626]" : "text-amber-600"}`}>
                        {part.current_stock}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{part.minimum_stock}</td>
                    <td className="px-4 py-2.5">
                      {part.shortage > 0 ? (
                        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                          -{part.shortage}
                        </span>
                      ) : (
                        <span className="text-xs text-[#9CA3AF]">At minimum</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{part.supplier ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[#4B5563]">{part.store_location_bin ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {part.is_out ? (
                        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                          Out of Stock
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                          Low Stock
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href="/store/offline-inventory"
                        className="inline-flex items-center rounded border border-[#E5E7EB] px-3 py-1 text-xs font-bold transition hover:bg-gray-50"
                      >
                        View Inventory
                      </Link>
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
