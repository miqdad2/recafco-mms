import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { workflowArchitecture } from "@/lib/architecture/config";
import { ChipList, FlowRail, SectionShell } from "@/components/architecture/shared";

const workflowLinks = [
  ["/admin/system-map", "System Map"],
  ["/maintenance/work-orders", "Work Orders"],
  ["/maintenance/approvals", "Approvals"],
  ["/technician/jobs", "Technician Jobs"],
  ["/store/parts-requests", "Parts Requests"],
  ["/purchase/requests", "Purchase"],
  ["/finance/approvals", "Finance"]
];

export function WorkflowArchitecture() {
  return (
    <SectionShell eyebrow="Business workflow" title="Workflow Engine Architecture">
      <div className="space-y-4">
        <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <FlowRail steps={workflowArchitecture} compact />
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-base font-black text-[#111827]">Supporting systems</h3>
            <ChipList items={["status history", "audit logs", "notifications", "role permissions", "cost visibility", "inventory movements"]} />
          </div>
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-base font-black text-[#111827]">Workflow links</h3>
            <div className="grid gap-2">
              {workflowLinks.map(([href, label]) => (
                <Link key={href} href={href} className="inline-flex min-h-10 items-center justify-between rounded-md border border-[#E5E7EB] px-3 text-sm font-bold text-[#111827] hover:bg-gray-50">
                  {label}
                  <ArrowRight className="h-4 w-4 text-[#ED1C24]" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
