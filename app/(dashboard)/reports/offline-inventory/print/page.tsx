import { requirePermission } from "@/lib/auth/context";
import { canViewCosts as canViewCostsPermission } from "@/lib/security/permissions";
import { getOfflineInventoryBalance } from "@/lib/store/offline-inventory-data";
import { stockStatusLabel, fmtDate, type StockStatus } from "@/components/store/offline-inventory-types";
import { ReportPrintShell, type PrintSummaryItem } from "@/components/reports/report-print-shell";
import { ReportPrintActions } from "@/components/reports/report-print-actions";
import { ReportPrintFilterBar } from "@/components/reports/report-print-filter-bar";

// Printable Technician Workload and Inventory Control Reports Unit 10G.70,
// Task 3.
//
// Reads getOfflineInventoryBalance() — the exact same function the live
// /store/offline-inventory page already uses — and does not recompute any
// balance/stock-status/value figure itself; this page only filters and
// formats what that function already returns, per this unit's own "do not
// change Inventory movement/stock calculation logic" instruction. Gated on
// the same `parts.view` permission and the same canViewCosts (Unit
// 10G.61's lib/security/permissions.ts, not the reports module's own
// variant) as that live page, so a viewer's cost visibility here always
// matches what they already see on screen.
//
// No Date Range filter: balances are a current-state snapshot, not a
// movement-date-filtered read, so a "Date Range" control here would look
// like it does something it doesn't (Task 3 itself calls this filter "if
// applicable" — it isn't, for a plain current-balance report).

const BALANCE_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "ok", label: "OK" },
  { value: "low_stock", label: "Low Stock" },
  { value: "out_of_stock", label: "Out of Stock" },
  { value: "negative", label: "Negative Stock" },
  { value: "review_required", label: "Review Required" },
  { value: "needs_attention", label: "Needs Attention" },
];

// Same 4-status "Needs Attention" bucket store-balance-view.tsx already
// defines — duplicated here rather than imported (that file is a "use
// client" component; this is a Server Component print page), matching this
// codebase's own established convention for small, stable shared vocabulary
// constants (e.g. lib/reports/print-reports.ts's own REPORT_DIVISIONS).
const NEEDS_ATTENTION_STATUSES: StockStatus[] = ["low_stock", "out_of_stock", "negative", "review_required"];

export default async function InventoryControlPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("parts.view");
  const canViewCosts = canViewCostsPermission(context);
  const sp = (await searchParams) ?? {};

  const category = sp.category?.trim() || "";
  const balanceStatus = sp.balanceStatus?.trim() || "";

  const balance = await getOfflineInventoryBalance();

  const categories = [...new Set(balance.balanceItems.map((i) => i.category))].sort((a, b) => a.localeCompare(b));

  const filteredItems = balance.balanceItems.filter((item) => {
    if (category && item.category !== category) return false;
    if (balanceStatus === "needs_attention" && !NEEDS_ATTENTION_STATUSES.includes(item.stock_status)) return false;
    if (balanceStatus && balanceStatus !== "needs_attention" && item.stock_status !== balanceStatus) return false;
    return true;
  });

  // Task 6 — zeroed here (not just hidden by the table's own column list
  // below) for anyone without cost permission, same pattern
  // getMaterialsUsagePrintReport (Unit 10G.69) already established.
  const rows = filteredItems.map((item) => ({
    ...item,
    last_unit_cost: canViewCosts ? item.last_unit_cost : null,
    stock_value: canViewCosts ? item.stock_value : 0,
  }));

  const lowStockInView = rows.filter((r) => NEEDS_ATTENTION_STATUSES.includes(r.stock_status)).length;
  const outOfStockInView = rows.filter((r) => r.stock_status === "out_of_stock").length;
  const negativeInView = rows.filter((r) => r.stock_status === "negative").length;
  const stockValueInView = canViewCosts ? rows.reduce((sum, r) => sum + r.stock_value, 0) : 0;

  const summaryItems: PrintSummaryItem[] = [
    { label: "Total Materials", value: rows.length, tone: "blue" },
    { label: "Current Balance", value: rows.reduce((s, r) => s + Math.max(0, r.balance), 0).toLocaleString("en-US", { maximumFractionDigits: 2 }), tone: "gray" },
    { label: "Low Stock / Needs Attention", value: lowStockInView, tone: lowStockInView > 0 ? "amber" : "green" },
    { label: "Out of Stock", value: outOfStockInView, tone: outOfStockInView > 0 ? "red" : "green" },
    { label: "Negative Stock", value: negativeInView, tone: negativeInView > 0 ? "red" : "green" },
    ...(canViewCosts
      ? ([{ label: "Current Stock Value (KWD)", value: stockValueInView.toFixed(3), tone: "green" }] as PrintSummaryItem[])
      : []),
  ];

  const colHeaders = [
    "Material", "Balance", "Unit", "Stock Status", "Minimum Stock", "Category", "Part No.", "SS Rec. Code", "Location / Bin", "Last Movement",
    ...(canViewCosts ? ["Unit Cost (KWD)", "Stock Value (KWD)"] : []),
  ];

  return (
    <div className="p-4 lg:p-6">
      <ReportPrintActions />

      <ReportPrintFilterBar range="today" from="" to="" showDateRange={false}>
        <div>
          <label htmlFor="rpf-category" className="mb-1 block text-xs font-bold text-[#4B5563]">Category</label>
          <select
            id="rpf-category"
            name="category"
            defaultValue={category}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rpf-balance-status" className="mb-1 block text-xs font-bold text-[#4B5563]">Balance Status</label>
          <select
            id="rpf-balance-status"
            name="balanceStatus"
            defaultValue={balanceStatus}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            {BALANCE_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </ReportPrintFilterBar>

      <ReportPrintShell
        reportTitle="Inventory Control Report"
        generatedBy={context.profile.full_name}
        generatedAtIso={new Date().toISOString()}
        filters={[
          { label: "As Of", value: fmtDate(new Date().toISOString()) },
          { label: "Category", value: category || "All Categories" },
          { label: "Balance Status", value: BALANCE_STATUS_OPTIONS.find((o) => o.value === balanceStatus)?.label ?? "All" },
        ]}
        summary={summaryItems}
        notes={!canViewCosts ? "Unit cost and stock value figures are hidden for your role." : undefined}
      >
        <section className="mt-3">
          <h3 className="print-table-heading border-b border-[#E5E7EB] pb-1 text-[10px] font-black uppercase tracking-wide">
            Materials ({rows.length})
          </h3>
          {rows.length ? (
            <table className="print-table mt-1.5 w-full border-collapse text-left">
              <thead>
                <tr>
                  {colHeaders.map((h) => (
                    <th key={h} className="border border-[#E5E7EB] bg-gray-50 p-1 text-[8.5px] font-bold uppercase text-[#4B5563]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="border border-[#E5E7EB] p-1 font-semibold">{r.display_name}</td>
                    <td className="border border-[#E5E7EB] p-1 text-right">{r.balance.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.unit}</td>
                    <td className="border border-[#E5E7EB] p-1">{stockStatusLabel(r.stock_status)}</td>
                    <td className="border border-[#E5E7EB] p-1 text-right">
                      {r.minimum_stock_quantity !== null ? r.minimum_stock_quantity.toLocaleString("en-US", { maximumFractionDigits: 3 }) : "—"}
                    </td>
                    <td className="border border-[#E5E7EB] p-1">{r.category}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.part_number ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.ss_rec_code ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.location ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{fmtDate(r.last_movement_date)}</td>
                    {canViewCosts && (
                      <>
                        <td className="border border-[#E5E7EB] p-1 text-right">
                          {r.last_unit_cost !== null ? r.last_unit_cost.toFixed(3) : "—"}
                        </td>
                        <td className="border border-[#E5E7EB] p-1 text-right">
                          {r.stock_status === "negative" ? "Review required" : r.stock_value.toFixed(3)}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[10px] text-[#6B7280]">No materials match the selected filters.</p>
          )}
        </section>
      </ReportPrintShell>
    </div>
  );
}
