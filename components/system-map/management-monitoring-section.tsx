import { getSystemMapIcon, toneStyles } from "@/components/system-map/system-map-icons";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ManagementMonitorCard } from "@/lib/system-map/config";

export function ManagementMonitoringSection({ cards }: { cards: ManagementMonitorCard[] }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm system-map-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-[#ED1C24]">Management visibility</p>
          <h2 className="mt-1 text-2xl font-black text-[#111827]">What Management Can Monitor</h2>
          <p className="mt-2 text-sm text-[#4B5563]">The system gives visibility across operational, financial, and asset maintenance workflows.</p>
        </div>
        <StatusBadge label="Executive control" tone="blue" />
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => {
          const Icon = getSystemMapIcon(card.icon);
          const tone = toneStyles[card.tone];
          return (
            <article key={card.id} className={`rounded-md border bg-[#F9FAFB] p-4 transition hover:-translate-y-1 hover:bg-white hover:shadow-md ${tone.border}`} style={{ animationDelay: `${index * 45}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <span className={`rounded-md p-2 text-white ${tone.solid}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
                <span className={`rounded-md px-2 py-1 text-[11px] font-black uppercase ${tone.bg} ${tone.text}`}>{card.valueLabel}</span>
              </div>
              <h3 className="mt-4 font-black text-[#111827]">{card.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[#4B5563]">{card.benefit}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
