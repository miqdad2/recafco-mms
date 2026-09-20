import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDate } from "@/lib/utils";
import { ReportPrintShell, type PrintSummaryItem } from "@/components/reports/report-print-shell";
import { ReportPrintActions } from "@/components/reports/report-print-actions";
import { ReportPrintFilterBar } from "@/components/reports/report-print-filter-bar";
import { getServiceContractsExpiryPrintReport } from "@/lib/reports/print-reports";

// Printable Asset Register, Materials Requests, and Service Contracts
// Reports Unit 10G.71, Task 4.
//
// No standard Date Range / Division — this report's own "Expiry Range" is a
// different concept (a window relative to each contract's end_date, not a
// created/ordered-on date range), so it gets its own dedicated select
// rather than reusing ReportPrintFilterBar's Date Range preset; the shared
// filter bar itself renders with showDateRange={false} and no divisions,
// same pattern as the Asset Register report above.

const EXPIRY_RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "expired", label: "Expired" },
  { value: "30", label: "Expiring in 30 Days" },
  { value: "60", label: "Expiring in 60 Days" },
  { value: "90", label: "Expiring in 90 Days" },
  { value: "custom", label: "Custom Date Range" },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "Active", label: "Active" },
  { value: "Expired", label: "Expired" },
  { value: "Cancelled", label: "Cancelled" },
];

export default async function ServiceContractsExpiryPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("assets.view");
  const sp = (await searchParams) ?? {};

  const expiryRange = sp.expiryRange?.trim() || "";
  const customFrom = sp.customFrom?.trim() || "";
  const customTo = sp.customTo?.trim() || "";
  const status = sp.status?.trim() || "";
  const vendor = sp.vendor?.trim() || "";
  const assetType = sp.assetType?.trim() || "";

  const [report, vendorRows, assetTypeRows] = await Promise.all([
    getServiceContractsExpiryPrintReport({ expiryRange, customFrom, customTo, status, vendor, assetType }),
    prisma.service_contracts.findMany({ where: { deleted_at: null }, select: { service_company: true }, distinct: ["service_company"] }),
    prisma.service_contracts.findMany({
      where: { deleted_at: null },
      select: { assets: { select: { category: true } } },
    }),
  ]);

  const vendors = vendorRows.map((r) => r.service_company).sort((a, b) => a.localeCompare(b));
  const assetTypes = [...new Set(assetTypeRows.map((r) => r.assets.category))].sort((a, b) => a.localeCompare(b));

  const summaryItems: PrintSummaryItem[] = [
    { label: "Total Contracts", value: report.summary.totalContracts, tone: "blue" },
    { label: "Active Contracts", value: report.summary.activeContracts, tone: "green" },
    { label: "Expiring in 30 Days", value: report.summary.expiring30, tone: report.summary.expiring30 > 0 ? "amber" : "green" },
    { label: "Expiring in 60 Days", value: report.summary.expiring60, tone: report.summary.expiring60 > 0 ? "amber" : "green" },
    { label: "Expired Contracts", value: report.summary.expiredContracts, tone: report.summary.expiredContracts > 0 ? "red" : "green" },
  ];

  const colHeaders = [
    "Contract No.", "Contract Name / Description", "Vendor / Supplier", "Linked Asset",
    "Start Date", "End Date", "Days Remaining", "Status", "Remarks",
  ];

  return (
    <div className="p-4 lg:p-6">
      <ReportPrintActions />

      <ReportPrintFilterBar range="today" from="" to="" showDateRange={false}>
        <div>
          <label htmlFor="rpf-expiry-range" className="mb-1 block text-xs font-bold text-[#4B5563]">Expiry Range</label>
          <select
            id="rpf-expiry-range"
            name="expiryRange"
            defaultValue={expiryRange}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            {EXPIRY_RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rpf-custom-from" className="mb-1 block text-xs font-bold text-[#4B5563]">Custom From (if Custom above)</label>
          <input
            id="rpf-custom-from"
            type="date"
            name="customFrom"
            defaultValue={customFrom}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="rpf-custom-to" className="mb-1 block text-xs font-bold text-[#4B5563]">Custom To (if Custom above)</label>
          <input
            id="rpf-custom-to"
            type="date"
            name="customTo"
            defaultValue={customTo}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="rpf-status" className="mb-1 block text-xs font-bold text-[#4B5563]">Status</label>
          <select
            id="rpf-status"
            name="status"
            defaultValue={status}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rpf-vendor" className="mb-1 block text-xs font-bold text-[#4B5563]">Vendor / Supplier</label>
          <select
            id="rpf-vendor"
            name="vendor"
            defaultValue={vendor}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            <option value="">All Vendors</option>
            {vendors.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
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
      </ReportPrintFilterBar>

      <ReportPrintShell
        reportTitle="Service Contracts Expiry Report"
        generatedBy={context.profile.full_name}
        generatedAtIso={new Date().toISOString()}
        filters={[
          { label: "Expiry Range", value: EXPIRY_RANGE_OPTIONS.find((o) => o.value === expiryRange)?.label ?? "All" },
          { label: "Status", value: status || "All" },
          { label: "Vendor", value: vendor || "All Vendors" },
          { label: "Asset Type", value: assetType || "All Asset Types" },
        ]}
        summary={summaryItems}
      >
        <section className="mt-3">
          <h3 className="print-table-heading border-b border-[#E5E7EB] pb-1 text-[10px] font-black uppercase tracking-wide">
            Service Contracts ({report.rows.length})
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
                {report.rows.map((c) => (
                  <tr key={c.id}>
                    <td className="border border-[#E5E7EB] p-1 font-semibold">{c.contractNumber ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{c.contractTitle}</td>
                    <td className="border border-[#E5E7EB] p-1">{c.vendor}</td>
                    <td className="border border-[#E5E7EB] p-1">{c.assetLabel ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{formatDate(c.startDate)}</td>
                    <td className="border border-[#E5E7EB] p-1">{formatDate(c.endDate)}</td>
                    <td className="border border-[#E5E7EB] p-1 text-right">{c.daysRemaining}</td>
                    <td className="border border-[#E5E7EB] p-1">{c.statusLabel}</td>
                    <td className="border border-[#E5E7EB] p-1">{c.remarks ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[10px] text-[#6B7280]">No service contracts match the selected filters.</p>
          )}
        </section>
      </ReportPrintShell>
    </div>
  );
}
