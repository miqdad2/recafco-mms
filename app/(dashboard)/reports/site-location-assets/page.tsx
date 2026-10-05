import Link from "next/link";
import { ArrowLeft, MapPin, Printer, RotateCcw } from "lucide-react";

import { ReportSummaryGrid } from "@/components/reports/report-summary-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import {
  MOVEMENT_STATUS_OPTIONS,
  getSiteLocationAssetsReport,
  parseSiteLocationReportFilters,
  siteLocationReportQuery,
  type SiteLocationReportRow,
} from "@/lib/reports/site-location-assets";
import { formatDate } from "@/lib/utils";

const selectCls =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]";
const labelCls = "mb-1 block text-xs font-bold text-[#4B5563]";
const headerBtn =
  "inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50";

const COLUMNS = [
  "Asset Code",
  "Asset / Equipment",
  "Type",
  "Plate No.",
  "Chassis No.",
  "Current Site / Location",
  "Responsible Person",
  "Sent Date",
  "Expected Return",
  "Days at Site",
  "Status",
  "Purpose",
  "Remarks",
];

// Site Location Asset Report — which assets are currently at each approved
// site (or were, with Movement status = Returned / All). Same reports.view
// gate as every other report; quantities and dates only, no cost fields.
export default async function SiteLocationAssetsReportPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("reports.view");
  const report = await getSiteLocationAssetsReport(parseSiteLocationReportFilters((await searchParams) ?? {}));
  const { filters, summary } = report;
  const oneLocation = filters.locationId !== "all";
  const printHref = `/reports/site-location-assets/print?${siteLocationReportQuery(filters)}`;

  const summaryCards = oneLocation
    ? [
        { label: "Total assets in this location", value: summary.atSite, tone: "blue" as const },
        { label: "Overdue return in this location", value: summary.overdue, tone: summary.overdue > 0 ? ("red" as const) : ("green" as const) },
        { label: "Due this week in this location", value: summary.dueThisWeek, tone: summary.dueThisWeek > 0 ? ("amber" as const) : ("gray" as const) },
      ]
    : [
        { label: "Total assets at site", value: summary.atSite, tone: "blue" as const },
        { label: "Overdue return", value: summary.overdue, tone: summary.overdue > 0 ? ("red" as const) : ("green" as const) },
        { label: "Due this week", value: summary.dueThisWeek, tone: summary.dueThisWeek > 0 ? ("amber" as const) : ("gray" as const) },
        { label: "Locations with active assets", value: summary.locationsWithAssets, tone: "gray" as const },
      ];

  const emptyMessage = !report.hasAnyLocations
    ? null
    : filters.movementStatus !== "current"
      ? "No asset movements match the selected filters."
      : oneLocation
        ? "No assets are currently assigned to this location."
        : "No assets are currently assigned to a site location.";

  return (
    <>
      <PageHeader
        title="Site Location Assets Report"
        description="View assets currently assigned to approved site/project locations."
        actions={
          <>
            <Link href="/reports" className={headerBtn}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to Reports
            </Link>
            <Link
              href={printHref}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print Report
            </Link>
          </>
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {/* Plain GET form: Apply re-reads the same page with new query params. */}
        <form className="grid gap-3 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
          <div>
            <label htmlFor="sla-location" className={labelCls}>Location / Site</label>
            <select id="sla-location" name="locationId" defaultValue={filters.locationId} className={selectCls}>
              <option value="all">All locations</option>
              {report.locationOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sla-type" className={labelCls}>Asset Type</label>
            <select id="sla-type" name="assetType" defaultValue={filters.assetType} className={selectCls}>
              <option value="">All asset types</option>
              {report.assetTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sla-asset-status" className={labelCls}>Asset Status</label>
            <select id="sla-asset-status" name="assetStatus" defaultValue={filters.assetStatus} className={selectCls}>
              <option value="">All</option>
              {report.assetStatuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sla-movement" className={labelCls}>Movement Status</label>
            <select id="sla-movement" name="movementStatus" defaultValue={filters.movementStatus} className={selectCls}>
              {MOVEMENT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="inline-flex h-[38px] items-center rounded-md bg-[#111827] px-4 text-sm font-bold text-white hover:bg-[#2b2b2b]">
              Apply
            </button>
            <Link
              href="/reports/site-location-assets"
              className="inline-flex h-[38px] items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset
            </Link>
          </div>
        </form>

        <ReportSummaryGrid cards={summaryCards} />

        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] px-4 py-2.5">
            <p className="text-sm font-black text-[#111827]">
              {report.selectedLocationLabel} · {MOVEMENT_STATUS_OPTIONS.find((o) => o.value === filters.movementStatus)?.label}
            </p>
            <p className="text-xs font-semibold text-[#4B5563]">
              {report.rows.length} record{report.rows.length === 1 ? "" : "s"}
            </p>
          </div>

          {!report.hasAnyLocations ? (
            <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <MapPin className="h-6 w-6 text-[#9CA3AF]" aria-hidden="true" />
              </div>
              <p className="max-w-md text-sm font-semibold text-[#111827]">
                No site locations have been added yet. Add site locations first from Site Locations.
              </p>
            </div>
          ) : report.rows.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm font-semibold text-[#4B5563]">{emptyMessage}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1280px] text-left text-[13px]">
                <thead className="border-b-2 border-[#E5E7EB] bg-[#F3F4F6] text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c} className="px-3 py-2.5">{c}</th>
                    ))}
                  </tr>
                </thead>
                {oneLocation ? (
                  <tbody className="divide-y divide-[#F3F4F6]">{report.rows.map(renderRow)}</tbody>
                ) : (
                  // All locations: one body per location, under its own heading row.
                  report.groups.map((group) => (
                    <tbody key={group.key} className="divide-y divide-[#F3F4F6]">
                      <tr className="bg-[#F9FAFB]">
                        <td colSpan={COLUMNS.length} className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5 text-sm font-black text-[#111827]">
                            <MapPin className="h-4 w-4 text-[#ED1C24]" aria-hidden="true" />
                            {group.label}
                          </span>
                          <span className="ml-2 text-xs font-semibold text-[#4B5563]">
                            {group.rows.length} record{group.rows.length === 1 ? "" : "s"}
                          </span>
                        </td>
                      </tr>
                      {group.rows.map(renderRow)}
                    </tbody>
                  ))
                )}
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function renderRow(row: SiteLocationReportRow) {
  return (
    <tr key={row.movementId} className="align-top hover:bg-gray-50">
      <td className="whitespace-nowrap px-3 py-2">
        <Link href={`/assets/${row.assetId}?tab=movements`} className="font-bold text-[#111827] hover:text-[#ED1C24]">
          {row.assetCode}
        </Link>
      </td>
      <td className="px-3 py-2 font-semibold text-[#111827]">{row.assetName}</td>
      <td className="whitespace-nowrap px-3 py-2 text-[#4B5563]">{row.assetType}</td>
      <td className="whitespace-nowrap px-3 py-2 text-[#4B5563]">{row.plateNumber ?? "—"}</td>
      <td className="px-3 py-2 text-[#4B5563]">{row.chassisNumber ?? "—"}</td>
      <td className="px-3 py-2 font-semibold text-[#111827]">{row.location}</td>
      <td className="px-3 py-2 text-[#4B5563]">{row.responsiblePerson ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2 text-[#4B5563]">{formatDate(row.sentDate)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-[#4B5563]">
        {row.isActive
          ? row.expectedReturnDate
            ? formatDate(row.expectedReturnDate)
            : "—"
          : row.actualReturnDate
            ? `Returned ${formatDate(row.actualReturnDate)}`
            : "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-[#111827]">{row.daysAtSite}</td>
      <td className="whitespace-nowrap px-3 py-2">
        <StatusBadge label={row.statusLabel} tone={row.statusTone} />
      </td>
      <td className="max-w-[220px] px-3 py-2 text-xs text-[#4B5563]">{row.purpose ?? "—"}</td>
      <td className="max-w-[220px] px-3 py-2 text-xs text-[#4B5563]">{row.remarks ?? "—"}</td>
    </tr>
  );
}
