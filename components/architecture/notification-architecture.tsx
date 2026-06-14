import { notificationExamples, notificationFlow } from "@/lib/architecture/config";
import { ChipList, FlowRail, SectionShell } from "@/components/architecture/shared";

export function NotificationArchitecture() {
  return (
    <SectionShell eyebrow="Notification engine" title="Notification Architecture">
      <div className="space-y-4">
        <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <FlowRail steps={notificationFlow} compact />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-5">
            <h3 className="text-base font-black text-emerald-800">Implemented</h3>
            <p className="mt-2 text-sm font-semibold text-emerald-700">In-app notifications with header bell, unread count, Notification Center, templates, preferences, and delivery logs.</p>
          </div>
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <h3 className="text-base font-black text-[#111827]">Foundation ready</h3>
            <div className="mt-3">
              <ChipList items={["Email", "WhatsApp", "SMS", "Push"]} />
            </div>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50 p-5">
            <h3 className="text-base font-black text-[#7F1D1D]">Safety rule</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#7F1D1D]">Notification failures are logged safely and must not crash the main business workflow. Critical notifications can be forced.</p>
          </div>
        </div>
        <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-base font-black text-[#111827]">Workflow examples</h3>
          <ChipList items={notificationExamples} />
        </div>
      </div>
    </SectionShell>
  );
}
