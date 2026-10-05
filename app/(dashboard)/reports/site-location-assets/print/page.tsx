import { ReportPrintActions } from "@/components/reports/report-print-actions";
import { ReportPrintShell, type PrintSummaryItem } from "@/components/reports/report-print-shell";
import { requirePermission } from "@/lib/auth/context";
import {
  MOVEMENT_STATUS_OPTIONS,
  getSiteLocationAssetsReport,
  parseSiteLocationReportFilters,
  siteLocationReportQuery,
  type SiteLocationReportRow,
} from "@/lib/reports/site-location-assets";
import { formatDate } from "@/lib/utils";

const COLUMNS = [
  "Asset Code",
  "Asset Name",
  "Type",
  "Plate No.",
  "Current Site / Location",
  "Responsible Person",
  "Sent Date",
  "Expected Return",
  "Days at Site",
  "Status",
];

const cell = "border border-[#E5E7EB] p-1";

// Site Location Asset Report — A4 landscape print view. Takes the same
// query params as the screen report (locationId, assetType, assetStatus,
// movementStatus) and reads the same data module, so it prints exactly
// what the screen showed. No cost fields.
export default async function SiteLocationAssetsPrintPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("reports.view");
  const report = await getSiteLocationAssetsReport(parseSiteLocationReportFilters((await searchParams) ?? {}));
  const { filters, summary } = report;
  const oneLocation = filters.locationId !== "all";
  const movementLabel = MOVEMENT_STATUS_OPTIONS.find((o) => o.value === filters.movementStatus)?.label ?? "";

  const summaryItems: PrintSummaryItem[] = [
    { label: oneLocation ? "Assets in this location" : "Total assets at site", value: summary.atSite, tone: "blue" },
    { label: "Overdue return", value: summary.overdue, tone: summary.overdue > 0 ? "red" : "green" },
    { label: "Due this week", value: summary.dueThisWeek, tone: summary.dueThisWeek > 0 ? "amber" : "gray" },
    ...(oneLocation
      ? []
      : ([{ label: "Locations with active assets", value: summary.locationsWithAssets, tone: "gray" }] as PrintSummaryItem[])),
  ];

  const emptyMessage = !report.hasAnyLocations
    ? "No site locations have been added yet. Add site locations first from Site Locations."
    : filters.movementStatus !== "current"
      ? "No asset movements match the selected filters."
      : oneLocation
        ? "No assets are currently assigned to this location."
        : "No assets are currently assigned to a site location.";

  return (
    <div className="p-4 lg:p-6">
      <ReportPrintActions
        backHref={`/reports/site-location-assets?${siteLocationReportQuery(filters)}`}
        backLabel="Back to Report"
      />

      <ReportPrintShell
        reportTitle="Site Location Assets Report"
        orientation="landscape"
        generatedBy={context.profile.full_name}
        generatedAtIso={new Date().toISOString()}
        filters={[
          { label: "Location / Site", value: report.selectedLocationLabel },
          { label: "Asset Type", value: filters.assetType || "All asset types" },
          { label: "Asset Status", value: filters.assetStatus || "All" },
          { label: "Movement Status", value: movementLabel },
        ]}
        summary={summaryItems}
      >
        <section className="mt-3">
          <h3 className="print-table-heading border-b border-[#E5E7EB] pb-1 text-[10px] font-black uppercase tracking-wide">
            {report.selectedLocationLabel} — {movementLabel} ({report.rows.length})
          </h3>
          {report.rows.length ? (
            <table className="print-table mt-1.5 w-full border-collapse text-left">
              <thead>
                <tr>
                  {COLUMNS.map((h) => (
                    <th key={h} className="border border-[#E5E7EB] bg-gray-50 p-1 text-[8.5px] font-bold uppercase text-[#4B5563]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {oneLocation
                  ? report.rows.map(renderRow)
                  : report.groups.flatMap((group) => [
                      // Location heading row; never left alone at the bottom of a page.
                      <tr key={`g-${group.key}`} className="print-group-row">
                        <td colSpan={COLUMNS.length} className="border border-[#E5E7EB] bg-[#F3F4F6] p-1 text-[10px] font-black">
                          {group.label} ({group.rows.length})
                        </td>
                      </tr>,
                      ...group.rows.map(renderRow),
                    ])}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[10px] text-[#6B7280]">{emptyMessage}</p>
          )}
        </section>
      </ReportPrintShell>
    </div>
  );
}

function renderRow(row: SiteLocationReportRow) {
  return (
    <tr key={row.movementId}>
      <td className={`${cell} whitespace-nowrap font-semibold`}>{row.assetCode}</td>
      <td className={cell}>{row.assetName}</td>
      <td className={cell}>{row.assetType}</td>
      <td className={cell}>{row.plateNumber ?? "—"}</td>
      <td className={`${cell} font-semibold`}>{row.location}</td>
      <td className={cell}>{row.responsiblePerson ?? "—"}</td>
      <td className={`${cell} whitespace-nowrap`}>{formatDate(row.sentDate)}</td>
      <td className={`${cell} whitespace-nowrap`}>
        {row.isActive
          ? row.expectedReturnDate
            ? formatDate(row.expectedReturnDate)
            : "—"
          : row.actualReturnDate
            ? `Returned ${formatDate(row.actualReturnDate)}`
            : "—"}
      </td>
      <td className={`${cell} text-right`}>{row.daysAtSite}</td>
      <td className={`${cell} whitespace-nowrap font-semibold`}>{row.statusLabel}</td>
    </tr>
  );
}
