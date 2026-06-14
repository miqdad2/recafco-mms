import { businessModules, highLevelFlow, outputModules } from "@/lib/architecture/config";
import { ChipList, FlowRail, SectionShell } from "@/components/architecture/shared";

const columns = [
  { title: "User Devices", items: ["Desktop Browser", "Mobile Browser", "PWA Install"] },
  { title: "Frontend Layer", items: ["Next.js App Router", "Role-based Layouts", "Dashboard Pages", "Forms and Tables", "Mobile Technician UI"] },
  { title: "Server Layer", items: ["Server Actions", "API Routes", "Permission Guards", "Zod Validation", "Audit Logging", "Notification Service", "Export Service", "QR Service"] },
  { title: "Supabase Layer", items: ["Supabase Auth", "PostgreSQL Database", "Row Level Security", "Private Storage Buckets", "Signed URLs", "Realtime/Polling Foundation"] }
];

export function HighLevelArchitecture() {
  return (
    <SectionShell eyebrow="System overview" title="High-Level System Architecture">
      <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm lg:p-5">
        <FlowRail steps={highLevelFlow} />
        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          {columns.map((column) => (
            <div key={column.title} className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-4">
              <h3 className="text-sm font-black text-[#111827]">{column.title}</h3>
              <ul className="mt-3 space-y-2">
                {column.items.map((item) => (
                  <li key={item} className="text-xs font-semibold text-[#4B5563]">{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-sm font-black text-[#111827]">Business Modules</h3>
            <ChipList items={businessModules} />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-black text-[#111827]">Output Layer</h3>
            <ChipList items={outputModules} />
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
