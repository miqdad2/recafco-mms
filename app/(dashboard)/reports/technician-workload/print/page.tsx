import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDate } from "@/lib/utils";
import { canViewCosts as canViewCostsForContext } from "@/lib/reports/data";
import { WORKER_TYPES } from "@/lib/backend/workers/constants";
import { ReportPrintShell, type PrintSummaryItem } from "@/components/reports/report-print-shell";
import { ReportPrintActions } from "@/components/reports/report-print-actions";
import { ReportPrintFilterBar } from "@/components/reports/report-print-filter-bar";
import { resolveDateRange, isDateRangePreset, type DateRangePreset } from "@/lib/reports/date-range";
import { getTechnicianWorkloadPrintReport, REPORT_DIVISIONS } from "@/lib/reports/print-reports";

// Printable Technician Workload and Inventory Control Reports Unit 10G.70,
// Task 2 — same separate-print-route pattern Unit 10G.69 established (the
// existing /reports/work-orders?report=technician-workload screen mode is
// untouched); reuses ReportPrintShell/ReportPrintActions/ReportPrintFilterBar
// and lib/reports/date-range.ts verbatim (Task 1 — "do not create a
// separate report layout style").

export default async function TechnicianWorkloadPrintPage({
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
  const workerType = sp.workerType?.trim() || "";
  const workerId = sp.workerId?.trim() || "";

  const [{ rows, summary }, workerOptions] = await Promise.all([
    getTechnicianWorkloadPrintReport(
      { from, to, division: division || undefined, workerType: workerType || undefined, workerId: workerId || undefined },
      canViewCosts
    ),
    // Lightweight, additive-only lookup for the Worker filter select.
    prisma.workerProfile.findMany({ select: { id: true, name: true, employee_id: true }, orderBy: { name: "asc" } }),
  ]);

  const selectedWorker = workerId ? workerOptions.find((w) => w.id === workerId) : null;

  const summaryItems: PrintSummaryItem[] = [
    { label: "Total Workers", value: summary.totalWorkers, tone: "blue" },
    { label: "Assigned Job Cards", value: summary.assignedJobCards, tone: "blue" },
    { label: "Completed Job Cards", value: summary.completedJobCards, tone: "green" },
    { label: "Total Work Hours", value: summary.totalWorkHours.toLocaleString("en-US", { maximumFractionDigits: 2 }), tone: "gray" },
    { label: "Active Workers", value: summary.activeWorkers, tone: summary.activeWorkers > 0 ? "amber" : "green" },
    { label: "Paused Workers", value: summary.pausedWorkers, tone: summary.pausedWorkers > 0 ? "amber" : "gray" },
  ];

  const colHeaders = [
    "Worker Name", "Employee No.", "Worker Type", "Division", "Assigned Job Cards",
    "Completed Job Cards", "Active Job Cards", "Total Hours", "Current Status",
    ...(canViewCosts ? ["Hourly Rate (KWD)", "Labor Cost (KWD)"] : []),
  ];

  return (
    <div className="p-4 lg:p-6">
      <ReportPrintActions />

      <ReportPrintFilterBar range={range} from={from} to={to} division={division} divisions={REPORT_DIVISIONS}>
        <div>
          <label htmlFor="rpf-worker-type" className="mb-1 block text-xs font-bold text-[#4B5563]">Worker Type</label>
          <select
            id="rpf-worker-type"
            name="workerType"
            defaultValue={workerType}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            <option value="">All Worker Types</option>
            {WORKER_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rpf-worker" className="mb-1 block text-xs font-bold text-[#4B5563]">Worker</label>
          <select
            id="rpf-worker"
            name="workerId"
            defaultValue={workerId}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            <option value="">All Workers</option>
            {workerOptions.map((w) => (
              <option key={w.id} value={w.id}>{w.employee_id ? `${w.employee_id} — ${w.name}` : w.name}</option>
            ))}
          </select>
        </div>
      </ReportPrintFilterBar>

      <ReportPrintShell
        reportTitle="Technician Workload Report"
        generatedBy={context.profile.full_name}
        generatedAtIso={new Date().toISOString()}
        filters={[
          { label: "Division", value: division || "All Divisions" },
          { label: "Date Range", value: `${formatDate(from)} – ${formatDate(to)}` },
          ...(workerType ? [{ label: "Worker Type", value: workerType }] : []),
          ...(selectedWorker ? [{ label: "Worker", value: selectedWorker.name }] : []),
        ]}
        summary={summaryItems}
        notes={!canViewCosts ? "Hourly rate and labor cost figures are hidden for your role." : undefined}
      >
        <section className="mt-3">
          <h3 className="print-table-heading border-b border-[#E5E7EB] pb-1 text-[10px] font-black uppercase tracking-wide">
            Workers ({rows.length})
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
                    <td className="border border-[#E5E7EB] p-1 font-semibold">{r.name}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.employee_id ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.worker_type}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.skill_category ?? "—"}</td>
                    <td className="border border-[#E5E7EB] p-1 text-right">{r.assignedJobCards}</td>
                    <td className="border border-[#E5E7EB] p-1 text-right">{r.completedJobCards}</td>
                    <td className="border border-[#E5E7EB] p-1 text-right">{r.activeJobCards}</td>
                    <td className="border border-[#E5E7EB] p-1 text-right">{r.totalHours.toFixed(2)}</td>
                    <td className="border border-[#E5E7EB] p-1">{r.currentStatus}</td>
                    {canViewCosts && (
                      <>
                        <td className="border border-[#E5E7EB] p-1 text-right">{r.hourlyRate.toFixed(3)}</td>
                        <td className="border border-[#E5E7EB] p-1 text-right">{r.laborCost.toFixed(3)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[10px] text-[#6B7280]">No workers match the selected filters.</p>
          )}
        </section>
      </ReportPrintShell>
    </div>
  );
}
