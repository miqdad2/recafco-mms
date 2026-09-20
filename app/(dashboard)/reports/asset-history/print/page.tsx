import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDate } from "@/lib/utils";
import { displayStatus } from "@/lib/display/work-order-labels";
import { ReportPrintShell, type PrintSummaryItem } from "@/components/reports/report-print-shell";
import { ReportPrintActions } from "@/components/reports/report-print-actions";
import { ReportPrintFilterBar } from "@/components/reports/report-print-filter-bar";
import { resolveDateRange, isDateRangePreset, type DateRangePreset } from "@/lib/reports/date-range";
import { getAssetRepairHistoryPrintReport, REPORT_DIVISIONS } from "@/lib/reports/print-reports";

// Printable Division-Based Reports Foundation Unit 10G.69, Task 5 — same
// separate-print-route pattern as the Job Card Summary print page; the
// existing /reports/asset-history screen page is untouched.

const COL_HEADERS = ["Asset Code", "Asset Name", "Asset Type", "Job Card No.", "Date", "Complaint", "Work Done / Description", "Status", "Closed Date"];

export default async function AssetRepairHistoryPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("reports.view");
  const sp = (await searchParams) ?? {};

  const range: DateRangePreset = isDateRangePreset(sp.range) ? sp.range : "this_month";
  const { from, to } = resolveDateRange(range, sp.from, sp.to);
  const division = sp.division?.trim() || "";
  const assetType = sp.assetType?.trim() || "";
  const assetId = sp.assetId?.trim() || "";

  const [{ rows, summary }, assetTypeChips, assetOptions] = await Promise.all([
    getAssetRepairHistoryPrintReport(context, {
      from,
      to,
      division: division || undefined,
      assetType: assetType || undefined,
      assetId: assetId || undefined,
    }),
    // Lightweight, additive-only lookups for the two extra filter selects —
    // same "one row per real, in-use value" convention the Assets module's
    // own Asset Type filter already uses.
    prisma.$queryRaw<{ category: string }[]>`select distinct category from public.assets where deleted_at is null order by category asc`,
    prisma.assets.findMany({
      where: { deleted_at: null },
      select: { id: true, asset_code: true, asset_name: true },
      orderBy: { asset_code: "asc" },
    }),
  ]);

  const selectedAsset = assetId ? assetOptions.find((a) => a.id === assetId) : null;

  const summaryItems: PrintSummaryItem[] = [
    { label: "Total Repair Jobs", value: summary.totalRepairJobs, tone: "blue" },
    { label: "Total Closed Jobs", value: summary.totalClosedJobs, tone: "green" },
    { label: "Active Jobs", value: summary.activeJobs, tone: summary.activeJobs > 0 ? "amber" : "green" },
    { label: "Repeated Repair Assets", value: summary.repeatedRepairCount, tone: summary.repeatedRepairCount > 0 ? "red" : "green" },
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
          <label htmlFor="rpf-asset" className="mb-1 block text-xs font-bold text-[#4B5563]">Asset</label>
          <select
            id="rpf-asset"
            name="assetId"
            defaultValue={assetId}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            <option value="">All Assets</option>
            {assetOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.asset_code} — {a.asset_name}</option>
            ))}
          </select>
        </div>
      </ReportPrintFilterBar>

      <ReportPrintShell
        reportTitle="Asset Repair History Report"
        generatedBy={context.profile.full_name}
        generatedAtIso={new Date().toISOString()}
        filters={[
          { label: "Division", value: division || "All Divisions" },
          { label: "Date Range", value: `${formatDate(from)} – ${formatDate(to)}` },
          ...(assetType ? [{ label: "Asset Type", value: assetType }] : []),
          ...(selectedAsset ? [{ label: "Asset", value: `${selectedAsset.asset_code} — ${selectedAsset.asset_name}` }] : []),
        ]}
        summary={summaryItems}
      >
        <section className="mt-3">
          <h3 className="print-table-heading border-b border-[#E5E7EB] pb-1 text-[10px] font-black uppercase tracking-wide">
            Repair History ({rows.length})
          </h3>
          {rows.length ? (
            <table className="print-table mt-1.5 w-full border-collapse text-left">
              <thead>
                <tr>
                  {COL_HEADERS.map((h) => (
                    <th key={h} className="border border-[#E5E7EB] bg-gray-50 p-1 text-[8.5px] font-bold uppercase text-[#4B5563]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="border border-[#E5E7EB] p-1 font-semibold">{r.asset_code}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.asset_name}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.asset_type}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.work_order_number ?? "Draft"}</td>
                    <td className="border border-[#E5E7EB] p-1">{formatDate(r.date_of_order)}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.operator_complaint ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.description_of_work ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{displayStatus(r.status)}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.closed_date ? formatDate(r.closed_date) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[10px] text-[#6B7280]">No repair history matches the selected filters.</p>
          )}
        </section>
      </ReportPrintShell>
    </div>
  );
}
