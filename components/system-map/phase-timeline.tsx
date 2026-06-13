import { StatusBadge } from "@/components/ui/status-badge";
import type { SystemPhase } from "@/lib/system-map/config";

function tone(status: SystemPhase["status"]) {
  if (status === "Completed") return "green";
  if (status === "Upcoming") return "gray";
  return "gray";
}

export function PhaseTimeline({ phases }: { phases: SystemPhase[] }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm system-map-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-[#ED1C24]">Implementation progress</p>
          <h2 className="mt-1 text-2xl font-black text-[#111827]">Phase Timeline</h2>
          <p className="mt-2 text-sm text-[#4B5563]">Completed phases are shown in green. Upcoming work remains gray until implemented.</p>
        </div>
        <StatusBadge label="Phase 6 active" tone="amber" />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        {phases.map((phase, index) => (
          <article key={phase.id} className="relative rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-4 transition hover:-translate-y-1 hover:bg-white hover:shadow-md" style={{ animationDelay: `${index * 55}ms` }}>
            <div className={phase.status === "Completed" ? "absolute inset-x-0 top-0 h-1 bg-[#16A34A]" : "absolute inset-x-0 top-0 h-1 bg-gray-300"} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-[#ED1C24]">{phase.title}</p>
                <h3 className="mt-1 font-black text-[#111827]">{phase.subtitle}</h3>
              </div>
              <StatusBadge label={phase.status} tone={tone(phase.status)} />
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-200">
              <div className={phase.status === "Completed" ? "h-full bg-[#16A34A]" : "h-full bg-gray-400"} style={{ width: `${phase.progress}%` }} />
            </div>
            <ul className="mt-4 space-y-2 text-sm text-[#4B5563]">
              {phase.items.map((item) => <li key={item}>- {item}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
