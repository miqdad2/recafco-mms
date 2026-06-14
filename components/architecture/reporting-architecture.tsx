import { reportingFlow } from "@/lib/architecture/config";
import { ChipList, FlowRail, SectionShell } from "@/components/architecture/shared";

export function ReportingArchitecture() {
  return (
    <SectionShell eyebrow="Reports and outputs" title="Reporting and Export Architecture">
      <div className="space-y-4 rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <FlowRail steps={reportingFlow} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-base font-black text-[#111827]">Reports</h3>
            <ChipList items={["Work Orders", "Assets", "Costs", "Preventive Maintenance", "Inventory", "Purchase", "Finance"]} />
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-800">
            Exports are true `.xlsx` workbooks. Cost exports are permission-protected. Browser print is the current PDF path; server-side PDF generation remains a future enhancement.
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
