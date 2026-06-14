import { scalabilityRoadmap } from "@/lib/architecture/config";
import { SectionShell, toneClasses } from "@/components/architecture/shared";

export function ScalabilityRoadmap() {
  return (
    <SectionShell eyebrow="Future scale" title="Scalability and Future Roadmap">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {scalabilityRoadmap.map((group) => {
          const tone = toneClasses[group.tone];
          return (
            <article key={group.area} className={`rounded-md border-t-4 ${tone.border} border-x border-b bg-white p-5 shadow-sm`}>
              <h3 className="text-lg font-black text-[#111827]">{group.area}</h3>
              <ul className="mt-4 space-y-2">
                {group.items.map((item) => (
                  <li key={item} className="rounded-md bg-[#F8FAFC] px-3 py-2 text-sm font-semibold text-[#4B5563]">{item}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </SectionShell>
  );
}
