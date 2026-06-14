import { technicalSummaryCards } from "@/lib/architecture/config";
import { SectionShell, toneClasses } from "@/components/architecture/shared";

export function TechnicalSummary() {
  return (
    <SectionShell eyebrow="Technical summary" title="Technical Summary Cards">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {technicalSummaryCards.map((card) => {
          const tone = toneClasses[card.tone];
          return (
            <div key={card.title} className={`rounded-md border-t-4 ${tone.border} border-x border-b bg-white p-4 shadow-sm`}>
              <p className="text-xs font-black uppercase text-[#4B5563]">{card.title}</p>
              <h3 className="mt-2 text-lg font-black text-[#111827]">{card.value}</h3>
              <p className="mt-2 text-xs leading-5 text-[#4B5563]">{card.detail}</p>
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}
