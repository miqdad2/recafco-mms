import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDate } from "@/lib/utils";
import { canViewCosts as canViewCostsForContext } from "@/lib/reports/data";
import { ReportPrintShell, type PrintSummaryItem } from "@/components/reports/report-print-shell";
import { ReportPrintActions } from "@/components/reports/report-print-actions";
import { ReportPrintFilterBar } from "@/components/reports/report-print-filter-bar";
import { resolveDateRange, isDateRangePreset, type DateRangePreset } from "@/lib/reports/date-range";
import { getMaterialsUsagePrintReport, REPORT_DIVISIONS } from "@/lib/reports/print-reports";

// Printable Division-Based Reports Foundation Unit 10G.69, Task 6 — same
// separate-print-route pattern as the other two reports; the existing
// /reports/spare-parts-usage screen page is untouched. Cost columns
// (Unit Cost / Amount) are zeroed at the data layer in
// getMaterialsUsagePrintReport (Task 10) for anyone without cost
// permission, then simply not rendered as columns here either — belt and
// braces, matching this app's established cost-leak-prevention pattern.

export default async function MaterialsUsagePrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("reports.view");
  const sp = (await searchParams) ?? {};
  const canViewCosts = canViewCostsForContext(context);

  const range: DateRangePreset = isDateRangePreset(sp.range) ? sp.range : "this_month";
  const { from, to } = resolveDateRange(range, sp.from, sp.to);
  const division = sp.division?.trim() || "";
  const assetType = sp.assetType?.trim() || "";
  const material = sp.material?.trim() || "";

  const [{ rows, summary }, assetTypeChips] = await Promise.all([
    getMaterialsUsagePrintReport(
      context,
      { from, to, division: division || undefined, assetType: assetType || undefined, material: material || undefined },
      canViewCosts
    ),
    prisma.$queryRaw<{ category: string }[]>`select distinct category from public.assets where deleted_at is null order by category asc`,
  ]);

  const colHeaders = [
    "Date", "Job Card No.", "Asset", "Division", "Material", "Quantity", "Unit", "Reference",
    ...(canViewCosts ? ["Unit Cost (KWD)", "Amount (KWD)"] : []),
  ];

  const summaryItems: PrintSummaryItem[] = [
    { label: "Total Quantity Issued", value: summary.totalQuantity.toLocaleString("en-US", { maximumFractionDigits: 2 }), tone: "blue" },
    { label: "Total Material Lines", value: summary.totalLines, tone: "blue" },
    ...(canViewCosts
      ? ([{ label: "Total Issued Value (KWD)", value: summary.totalValue.toFixed(3), tone: "green" }] as PrintSummaryItem[])
      : []),
    ...(summary.topMaterial
      ? ([{ label: "Top Material", value: `${summary.topMaterial.name} (${summary.topMaterial.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })})`, tone: "gray" }] as PrintSummaryItem[])
      : []),
  ];

  return (
    <div className="p-4 lg:p-6">
      <ReportPrintActions />

      <ReportPrintFilterBar range={range} from={from} to={to} division={division} divisions={REPORT_DIVISIONS}>
        <div>
          <label htmlFor="rpf-asset-type" className="mb-1 block text-xs font-bold text-[#4B5563]">Asset Type</label>
          <select
            id="rpf-asset-type"
            name="assetType"
            defaultValue={assetType}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            <option value="">All Asset Types</option>
            {assetTypeChips.map((c) => (
              <option key={c.category} value={c.category}>{c.category}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rpf-material" className="mb-1 block text-xs font-bold text-[#4B5563]">Material</label>
          <input
            id="rpf-material"
            type="text"
            name="material"
            defaultValue={material}
            placeholder="Search material name or part no."
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          />
        </div>
      </ReportPrintFilterBar>

      <ReportPrintShell
        reportTitle="Materials Usage Report"
        generatedBy={context.profile.full_name}
        generatedAtIso={new Date().toISOString()}
        filters={[
          { label: "Division", value: division || "All Divisions" },
          { label: "Date Range", value: `${formatDate(from)} – ${formatDate(to)}` },
          ...(assetType ? [{ label: "Asset Type", value: assetType }] : []),
          ...(material ? [{ label: "Material", value: material }] : []),
        ]}
        summary={summaryItems}
        notes={!canViewCosts ? "Cost figures are hidden for your role." : undefined}
      >
        <section className="mt-3">
          <h3 className="print-table-heading border-b border-[#E5E7EB] pb-1 text-[10px] font-black uppercase tracking-wide">
            Materials Issued ({rows.length})
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
                  <tr key={r.id}>
                    <td className="border border-[#E5E7EB] p-1">{formatDate(r.date)}</td>
                    <td className="border border-[#E5E7EB] p-1 font-semibold">{r.work_order_number ?? "Draft"}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.asset_label}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.division}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.material_name}</td>
                    <td className="border border-[#E5E7EB] p-1 text-right">{r.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.unit}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.reference ?? "—"}</td>
                    {canViewCosts && (
                      <>
                        <td className="border border-[#E5E7EB] p-1 text-right">{r.unit_price.toFixed(3)}</td>
                        <td className="border border-[#E5E7EB] p-1 text-right">{r.amount.toFixed(3)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[10px] text-[#6B7280]">No materials usage matches the selected filters.</p>
          )}
        </section>
      </ReportPrintShell>
    </div>
  );
}
