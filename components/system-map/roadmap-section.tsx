import { StatusBadge } from "@/components/ui/status-badge";
import type { RoadmapItem } from "@/lib/system-map/config";

export function RoadmapSection({ items }: { items: RoadmapItem[] }) {
  const upcoming = items.filter((item) => item.group === "Upcoming");
  const future = items.filter((item) => item.group === "Future");

  return (
    <section className="rounded-md border border-[#1F2937] bg-[#111827] p-5 text-white shadow-sm system-map-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-red-200">Roadmap</p>
          <h2 className="mt-1 text-2xl font-black">Phase Timeline and Roadmap</h2>
          <p className="mt-2 text-sm text-gray-300">Phase 6 activates the workflow engine. Future phases cover integrations, mobile depth, and ERP connectivity.</p>
        </div>
        <StatusBadge label="Phase 6 active" tone="gray" />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <RoadmapGroup title="Phase 6 — Upcoming" items={upcoming} />
        <RoadmapGroup title="Future Enhancements" items={future} />
      </div>
    </section>
  );
}

function RoadmapGroup({ title, items }: { title: string; items: RoadmapItem[] }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-4">
      <h3 className="font-black text-white">{title}</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map((item) => <div key={item.title} className="rounded-md border border-white/10 bg-white/5 p-3 text-sm font-semibold text-gray-100">{item.title}</div>)}
      </div>
    </div>
  );
}
