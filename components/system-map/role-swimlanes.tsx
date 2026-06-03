import Link from "next/link";

import { toneStyles } from "@/components/system-map/system-map-icons";
import { StatusBadge } from "@/components/ui/status-badge";
import type { RoleSwimlane } from "@/lib/system-map/config";

export function RoleSwimlanes({ lanes }: { lanes: RoleSwimlane[] }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm system-map-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-[#ED1C24]">Role ownership</p>
          <h2 className="mt-1 text-2xl font-black text-[#111827]">Who does what in the workflow</h2>
          <p className="mt-2 text-sm text-[#4B5563]">Each swimlane shows department ownership, responsibility, workflow steps, and operational routes.</p>
        </div>
        <StatusBadge label="Server-side RBAC" tone="green" />
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        {lanes.map((lane, index) => {
          const tone = toneStyles[lane.tone];
          return (
            <article key={lane.role} className={`rounded-md border bg-[#F9FAFB] p-4 transition hover:-translate-y-1 hover:bg-white hover:shadow-md ${tone.border}`} style={{ animationDelay: `${index * 45}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-black text-[#111827]">{lane.role}</h3>
                  <p className="mt-1 text-xs font-black uppercase text-[#4B5563]">{lane.department}</p>
                </div>
                <StatusBadge label="owner" tone={lane.tone} />
              </div>
              <p className="mt-4 text-sm leading-6 text-[#4B5563]">{lane.responsibilities}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {lane.steps.map((step) => <span key={step} className="rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-bold text-[#111827]">{step}</span>)}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {lane.routes.map((route) => <Link key={route} href={route} className="text-xs font-black text-[#ED1C24] hover:underline">{route}</Link>)}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
