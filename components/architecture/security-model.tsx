import { roleHierarchy, securityFeatures, securityFlow } from "@/lib/architecture/config";
import { FlowRail, SectionShell, toneClasses } from "@/components/architecture/shared";

export function SecurityModel() {
  return (
    <SectionShell eyebrow="Access control" title="Security and Access Control Model">
      <div className="space-y-4">
        <FlowRail steps={securityFlow} />
        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <h3 className="text-lg font-black text-[#111827]">Role hierarchy</h3>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {roleHierarchy.map((role, index) => (
                <div key={role} className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#111827] text-xs font-black text-white">{index + 1}</span>
                  <span className="text-sm font-bold text-[#111827]">{role}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <h3 className="text-lg font-black text-[#111827]">Security principles</h3>
            <ul className="mt-4 grid gap-2 text-sm font-semibold leading-6 text-[#4B5563] md:grid-cols-2">
              <li>UI hiding is not enough.</li>
              <li>Permissions are enforced server-side.</li>
              <li>RLS protects data at database level.</li>
              <li>Technicians only see assigned jobs.</li>
              <li>Cost visibility is permission-based.</li>
              <li>Private files use signed URLs.</li>
              <li>Service role key is server-side only.</li>
              <li>Important actions write audit logs.</li>
            </ul>
          </div>
        </div>
        <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="grid grid-cols-3 bg-[#111827] px-4 py-3 text-xs font-black uppercase text-white">
            <span>Security Feature</span>
            <span>Purpose</span>
            <span>Status</span>
          </div>
          {securityFeatures.map((row) => {
            const tone = toneClasses[row.tone];
            return (
              <div key={row.feature} className="grid grid-cols-3 gap-3 border-t border-[#E5E7EB] px-4 py-3 text-sm">
                <span className="font-black text-[#111827]">{row.feature}</span>
                <span className="text-[#4B5563]">{row.purpose}</span>
                <span><span className={`${tone.soft} ${tone.text} rounded-md px-2.5 py-1 text-xs font-black uppercase`}>{row.status}</span></span>
              </div>
            );
          })}
        </div>
      </div>
    </SectionShell>
  );
}
