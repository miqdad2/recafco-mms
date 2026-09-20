import { requirePermission } from "@/lib/auth/context";
import { formatDate } from "@/lib/utils";
import { displayStatus } from "@/lib/display/work-order-labels";
import { ReportPrintShell, type PrintSummaryItem } from "@/components/reports/report-print-shell";
import { ReportPrintActions } from "@/components/reports/report-print-actions";
import { ReportPrintFilterBar } from "@/components/reports/report-print-filter-bar";
import { resolveDateRange, isDateRangePreset, type DateRangePreset } from "@/lib/reports/date-range";
import { getJobCardSummaryPrintReport, REPORT_DIVISIONS, JOB_CARD_STATUSES } from "@/lib/reports/print-reports";

// Printable Division-Based Reports Foundation Unit 10G.69, Task 4.
//
// A separate print route (not a change to the existing, working
// /reports/work-orders screen page) — same pattern this codebase already
// uses for a single Job Card's own print view
// (app/(dashboard)/maintenance/work-orders/[id]/print/page.tsx): the
// interactive report stays interactive, and this page is both the
// filter UI (screen-only) and the A4 printable output for the currently
// selected filters.

const COL_HEADERS = ["Job Card No.", "Date", "Division", "Asset", "Maintenance Type", "Complaint / Issue", "Status", "Reported By", "Closed Date"];

export default async function JobCardSummaryPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("reports.view");
  const sp = (await searchParams) ?? {};

  const range: DateRangePreset = isDateRangePreset(sp.range) ? sp.range : "this_month";
  const { from, to } = resolveDateRange(range, sp.from, sp.to);
  const division = sp.division?.trim() || "";
  const status = sp.status?.trim() || "";

  const { rows, summary } = await getJobCardSummaryPrintReport(context, {
    from,
    to,
    division: division || undefined,
    status: status || undefined,
  });

  const summaryItems: PrintSummaryItem[] = [
    { label: "Total Job Cards", value: summary.total, tone: "blue" },
    { label: "Open / Active", value: summary.open, tone: summary.open > 0 ? "amber" : "green" },
    { label: "Closure Requested", value: summary.closureRequested, tone: summary.closureRequested > 0 ? "amber" : "gray" },
    { label: "Closed", value: summary.closed, tone: "green" },
    { label: "Materials Pending", value: summary.materialsPending, tone: summary.materialsPending > 0 ? "amber" : "green" },
    { label: "Overdue", value: summary.overdue, tone: summary.overdue > 0 ? "red" : "green" },
  ];

  return (
    <div className="p-4 lg:p-6">
      <ReportPrintActions />

      <ReportPrintFilterBar range={range} from={from} to={to} division={division} divisions={REPORT_DIVISIONS}>
        <div>
          <label htmlFor="rpf-status" className="mb-1 block text-xs font-bold text-[#4B5563]">Status</label>
          <select
            id="rpf-status"
            name="status"
            defaultValue={status}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            <option value="">All Statuses</option>
            {JOB_CARD_STATUSES.map((s) => (
              <option key={s} value={s}>{displayStatus(s)}</option>
            ))}
          </select>
        </div>
      </ReportPrintFilterBar>

      <ReportPrintShell
        reportTitle="Job Card Summary Report"
        generatedBy={context.profile.full_name}
        generatedAtIso={new Date().toISOString()}
        filters={[
          { label: "Division", value: division || "All Divisions" },
          { label: "Date Range", value: `${formatDate(from)} – ${formatDate(to)}` },
          ...(status ? [{ label: "Status", value: displayStatus(status) }] : []),
        ]}
        summary={summaryItems}
      >
        <section className="mt-3">
          <h3 className="print-table-heading border-b border-[#E5E7EB] pb-1 text-[10px] font-black uppercase tracking-wide">
            Job Cards ({rows.length})
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
                    <td className="border border-[#E5E7EB] p-1 font-semibold">{r.work_order_number ?? "Draft"}</td>
                    <td className="border border-[#E5E7EB] p-1">{formatDate(r.date_of_order)}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.worker_type}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.asset_label}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.maintenance_type}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.operator_complaint ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{displayStatus(r.status)}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.ordered_by}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.closed_date ? formatDate(r.closed_date) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[10px] text-[#6B7280]">No job cards match the selected filters.</p>
          )}
        </section>
      </ReportPrintShell>
    </div>
  );
}
