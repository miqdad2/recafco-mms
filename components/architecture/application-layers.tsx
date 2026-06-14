import { architectureLayers } from "@/lib/architecture/config";
import { SectionShell, toneClasses } from "@/components/architecture/shared";

export function ApplicationLayers() {
  return (
    <SectionShell eyebrow="Layer breakdown" title="Application Layer Breakdown">
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {architectureLayers.map((layer) => {
          const tone = toneClasses[layer.tone];
          return (
            <article key={layer.name} className={`rounded-md border-t-4 ${tone.border} border-x border-b bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-black text-[#111827]">{layer.name}</h3>
                <span className={`${tone.soft} ${tone.text} rounded-md px-2.5 py-1 text-xs font-black uppercase`}>{layer.status}</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#4B5563]">{layer.responsibility}</p>
              <div className="mt-4">
                <p className="text-xs font-black uppercase text-[#111827]">Key files / folders</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {layer.files.map((file) => (
                    <span key={file} className="rounded-md bg-[#F3F5F8] px-2.5 py-1 text-xs font-bold text-[#111827]">{file}</span>
                  ))}
                </div>
              </div>
              <p className="mt-4 rounded-md bg-red-50 p-3 text-xs font-semibold leading-5 text-[#7F1D1D]">{layer.securityNote}</p>
            </article>
          );
        })}
      </div>
    </SectionShell>
  );
}
