import { requirePermission } from "@/lib/auth/context";
import { canViewCosts as canViewCostsForContext } from "@/lib/reports/data";
import { formatDate } from "@/lib/utils";
import { ReportPrintShell, type PrintSummaryItem } from "@/components/reports/report-print-shell";
import { ReportPrintActions } from "@/components/reports/report-print-actions";
import { ReportPrintFilterBar } from "@/components/reports/report-print-filter-bar";
import { resolveDateRange, isDateRangePreset, type DateRangePreset } from "@/lib/reports/date-range";
import { getMaterialsRequestsPrintReport, REPORT_DIVISIONS } from "@/lib/reports/print-reports";

// Printable Asset Register, Materials Requests, and Service Contracts
// Reports Unit 10G.71, Task 3.
//
// Lives entirely under /reports/, so — same as Unit 10G.70's Technician
// Workload print report — cost gating uses lib/reports/data.ts's own
// canViewCosts, not lib/security/permissions.ts's variant (that one is
// reserved for pages that reuse an existing store screen's own data
// function verbatim, which this report does not).

const REQUEST_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "job_card", label: "Job Card Request" },
  { value: "general", label: "General Inventory / Stock Request" },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export default async function MaterialsRequestsPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("parts_requests.view");
  const canViewCosts = canViewCostsForContext(context);
  const sp = (await searchParams) ?? {};

  const rangeParam = sp.range?.trim();
  const range: DateRangePreset = isDateRangePreset(rangeParam) ? rangeParam : "this_month";
  const { from, to } = resolveDateRange(range, sp.from, sp.to);

  const requestType = sp.requestType?.trim() || "";
  const status = sp.status?.trim() || "";
  const division = sp.division?.trim() || "";

  const report = await getMaterialsRequestsPrintReport(context, { from, to, requestType, status, division }, canViewCosts);

  const summaryItems: PrintSummaryItem[] = [
    { label: "Total Requests", value: report.summary.totalRequests, tone: "blue" },
    { label: "Pending", value: report.summary.pending, tone: report.summary.pending > 0 ? "amber" : "green" },
    { label: "Completed", value: report.summary.completed, tone: "green" },
    { label: "Cancelled", value: report.summary.cancelled, tone: report.summary.cancelled > 0 ? "red" : "gray" },
    { label: "Job Card Requests", value: report.summary.jobCardRequests, tone: "gray" },
    { label: "General Inventory Requests", value: report.summary.generalInventoryRequests, tone: "gray" },
  ];

  const colHeaders = [
    "Request No.", "Request Type", "Date", "Requested By", "Job Card No. / Purpose", "Asset", "Division", "Status", "Items Count", "Completed Date",
    ...(canViewCosts ? ["Value (KWD)"] : []),
  ];

  return (
    <div className="p-4 lg:p-6">
      <ReportPrintActions />

      <ReportPrintFilterBar range={range} from={from} to={to} divisions={REPORT_DIVISIONS}>
        <div>
          <label htmlFor="rpf-request-type" className="mb-1 block text-xs font-bold text-[#4B5563]">Request Type</label>
          <select
            id="rpf-request-type"
            name="requestType"
            defaultValue={requestType}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            {REQUEST_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
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
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </ReportPrintFilterBar>

      <ReportPrintShell
        reportTitle="Materials Requests Report"
        generatedBy={context.profile.full_name}
        generatedAtIso={new Date().toISOString()}
        filters={[
          { label: "Date Range", value: `${formatDate(from)} – ${formatDate(to)}` },
          { label: "Request Type", value: REQUEST_TYPE_OPTIONS.find((o) => o.value === requestType)?.label ?? "All" },
          { label: "Status", value: STATUS_OPTIONS.find((o) => o.value === status)?.label ?? "All" },
          { label: "Division", value: division || "All Divisions" },
        ]}
        summary={summaryItems}
        notes={!canViewCosts ? "Request value figures are hidden for your role." : undefined}
      >
        <section className="mt-3">
          <h3 className="print-table-heading border-b border-[#E5E7EB] pb-1 text-[10px] font-black uppercase tracking-wide">
            Materials Requests ({report.rows.length})
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
                {report.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="border border-[#E5E7EB] p-1 font-semibold">{r.requestNumber ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.requestType}</td>
                    <td className="border border-[#E5E7EB] p-1">{formatDate(r.date)}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.requestedBy ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.jobCardOrPurpose}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.assetLabel ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.division ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.status}</td>
                    <td className="border border-[#E5E7EB] p-1 text-right">{r.itemsCount}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.completedDate ? formatDate(r.completedDate) : "—"}</td>
                    {canViewCosts && (
                      <td className="border border-[#E5E7EB] p-1 text-right">{r.value.toFixed(3)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[10px] text-[#6B7280]">No materials requests match the selected filters.</p>
          )}
        </section>
      </ReportPrintShell>
    </div>
  );
}
