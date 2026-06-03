import { getSystemMapIcon, toneStyles } from "@/components/system-map/system-map-icons";
import type { ExecutiveWorkflowStep } from "@/lib/system-map/config";

export function ExecutiveWorkflowStrip({ steps, presentation = false }: { steps: ExecutiveWorkflowStep[]; presentation?: boolean }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm system-map-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-[#ED1C24]">10-second executive view</p>
          <h2 className="mt-1 text-2xl font-black text-[#111827]">From request to closure, stock control, cost approval, and reports.</h2>
        </div>
        <p className="max-w-xl text-sm text-[#4B5563]">Each handoff is role-based and recorded with live system data, notifications, status history, and audit logs.</p>
      </div>
      <div className={presentation ? "mt-6 grid gap-3 lg:grid-cols-11" : "mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-11"}>
        {steps.map((step, index) => {
          const Icon = getSystemMapIcon(step.icon);
          const tone = toneStyles[step.tone];
          return (
            <div key={step.id} className="relative">
              <div className={`group flex min-h-24 flex-col items-center justify-center rounded-md border bg-white p-3 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-md ${tone.border}`}>
                <span className={`rounded-md p-2 text-white ${tone.solid}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
                <p className="mt-2 text-xs font-black text-[#111827]">{step.name}</p>
              </div>
              {index < steps.length - 1 ? <div className="hidden xl:block absolute left-[calc(100%-2px)] top-1/2 h-0.5 w-5 bg-[#ED1C24] system-map-connector-pulse" /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
