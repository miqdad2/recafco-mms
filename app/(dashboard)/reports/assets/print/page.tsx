import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDate } from "@/lib/utils";
import { ReportPrintShell, type PrintSummaryItem } from "@/components/reports/report-print-shell";
import { ReportPrintActions } from "@/components/reports/report-print-actions";
import { ReportPrintFilterBar } from "@/components/reports/report-print-filter-bar";
import { getAssetRegisterPrintReport } from "@/lib/reports/print-reports";

// Printable Asset Register, Materials Requests, and Service Contracts
// Reports Unit 10G.71, Task 2.
//
// No Date Range or Division for this report — Task 2's own filter list is
// Asset Type / Status / Site Movement / Expiry only, none of which is a
// date-of-order-style range, so ReportPrintFilterBar renders with
// showDateRange={false} and no divisions, same pattern Unit 10G.70's
// Inventory Control print report already established for a report with no
// meaningful date range.

// Same STATUS_OPTIONS vocabulary components/assets/asset-type-cards.tsx
// already uses for its own Status filter — duplicated here rather than
// imported (that file is a "use client" component; this is a Server
// Component print page), matching this codebase's own established
// convention for small, stable shared vocabulary constants.
const STATUS_OPTIONS = ["Active", "In Use", "Under Maintenance", "Breakdown", "Waiting for Parts", "Out of Service", "Retired"];

const SITE_MOVEMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "available", label: "Available" },
  { value: "at_site", label: "At Site" },
  { value: "overdue", label: "Overdue Return" },
];

const EXPIRY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "expired", label: "Expired" },
  { value: "expiring_30", label: "Expiring in 30 Days" },
  { value: "valid", label: "Valid" },
];

export default async function AssetRegisterPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("reports.view");
  const sp = (await searchParams) ?? {};

  const assetType = sp.assetType?.trim() || "";
  const status = sp.status?.trim() || "";
  const siteMovement = sp.siteMovement?.trim() || "";
  const expiry = sp.expiry?.trim() || "";

  const [report, categoryRows] = await Promise.all([
    getAssetRegisterPrintReport({ assetType, status, siteMovement, expiry }),
    prisma.assets.findMany({ where: { deleted_at: null }, select: { category: true }, distinct: ["category"] }),
  ]);

  const assetTypes = categoryRows.map((r) => r.category).sort((a, b) => a.localeCompare(b));

  const summaryItems: PrintSummaryItem[] = [
    { label: "Total Assets", value: report.summary.totalAssets, tone: "blue" },
    { label: "Active Assets", value: report.summary.activeAssets, tone: "green" },
    { label: "At Site", value: report.summary.atSite, tone: report.summary.atSite > 0 ? "amber" : "gray" },
    { label: "Overdue Return", value: report.summary.overdueReturn, tone: report.summary.overdueReturn > 0 ? "red" : "green" },
    { label: "Expired / Expiring Soon", value: report.summary.expiredOrExpiringSoon, tone: report.summary.expiredOrExpiringSoon > 0 ? "amber" : "green" },
    { label: "Active Maintenance", value: report.summary.activeMaintenance, tone: report.summary.activeMaintenance > 0 ? "red" : "green" },
  ];

  const colHeaders = [
    "Asset Code", "Asset / Equipment Name", "Asset Type", "Plate No.", "Chassis No.",
    "Current Location", "Responsible Person / Driver", "Status", "Site Movement Status",
    "Expected Return", "Expiry Date",
  ];

  return (
    <div className="p-4 lg:p-6">
      <ReportPrintActions />

      <ReportPrintFilterBar range="today" from="" to="" showDateRange={false}>
        <div>
          <label htmlFor="rpf-asset-type" className="mb-1 block text-xs font-bold text-[#4B5563]">Asset Type</label>
          <select
            id="rpf-asset-type"
            name="assetType"
            defaultValue={assetType}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            <option value="">All Asset Types</option>
            {assetTypes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rpf-status" className="mb-1 block text-xs font-bold text-[#4B5563]">Status</label>
          <select
            id="rpf-status"
            name="status"
            defaultValue={status}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rpf-site-movement" className="mb-1 block text-xs font-bold text-[#4B5563]">Site Movement</label>
          <select
            id="rpf-site-movement"
            name="siteMovement"
            defaultValue={siteMovement}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            {SITE_MOVEMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rpf-expiry" className="mb-1 block text-xs font-bold text-[#4B5563]">Expiry</label>
          <select
            id="rpf-expiry"
            name="expiry"
            defaultValue={expiry}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </ReportPrintFilterBar>

      <ReportPrintShell
        reportTitle="Asset Register Report"
        generatedBy={context.profile.full_name}
        generatedAtIso={new Date().toISOString()}
        filters={[
          { label: "Asset Type", value: assetType || "All Asset Types" },
          { label: "Status", value: status || "All" },
          { label: "Site Movement", value: SITE_MOVEMENT_OPTIONS.find((o) => o.value === siteMovement)?.label ?? "All" },
          { label: "Expiry", value: EXPIRY_OPTIONS.find((o) => o.value === expiry)?.label ?? "All" },
        ]}
        summary={summaryItems}
      >
        <section className="mt-3">
          <h3 className="print-table-heading border-b border-[#E5E7EB] pb-1 text-[10px] font-black uppercase tracking-wide">
            Assets ({report.rows.length})
          </h3>
          {report.rows.length ? (
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
                {report.rows.map((a) => (
                  <tr key={a.id}>
                    <td className="border border-[#E5E7EB] p-1 font-semibold">{a.asset_code}</td>
                    <td className="border border-[#E5E7EB] p-1">{a.asset_name}</td>
                    <td className="border border-[#E5E7EB] p-1">{a.category}</td>
                    <td className="border border-[#E5E7EB] p-1">{a.plate_number ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{a.chassis_number ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{a.currentLocation ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{a.responsiblePerson ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{a.status}</td>
                    <td className="border border-[#E5E7EB] p-1">{a.siteMovementStatus}</td>
                    <td className="border border-[#E5E7EB] p-1">
                      {a.siteMovementStatus !== "Available" ? formatDate(a.expectedReturnDate) : "—"}
                    </td>
                    <td className="border border-[#E5E7EB] p-1">{a.expiryDate ? formatDate(a.expiryDate) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[10px] text-[#6B7280]">No assets match the selected filters.</p>
          )}
        </section>
      </ReportPrintShell>
    </div>
  );
}
