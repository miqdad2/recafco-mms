import { ClipboardCheck, Gauge, Package, PackageSearch, Wrench, Activity } from "lucide-react";

import type { SystemMapStats } from "@/lib/system-map/stats";

const cards = [
  { label: "Phases Completed", value: "4", detail: "Foundation to finance workflow", icon: ClipboardCheck, accent: "bg-green-50 text-green-700" },
  { label: "Core Modules Built", value: "19", detail: "Operational modules active", icon: Activity, accent: "bg-blue-50 text-blue-700" },
  { label: "Active Work Orders", key: "openWorkOrders", detail: "Currently moving through workflow", icon: Wrench, accent: "bg-amber-50 text-amber-700" },
  { label: "Pending Approvals", key: "pendingApprovals", detail: "Waiting for manager review", icon: ClipboardCheck, accent: "bg-amber-50 text-amber-700" },
  { label: "Waiting for Parts", key: "waitingForParts", detail: "Blocked by store or purchase", icon: PackageSearch, accent: "bg-red-50 text-red-700" },
  { label: "Assets / Spare Parts", compound: true, detail: "Asset and inventory foundation", icon: Gauge, secondIcon: Package, accent: "bg-blue-50 text-blue-700" }
] as const;

export function SystemProgressOverview({ stats }: { stats: SystemMapStats }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
      {cards.map((card, index) => {
        const Icon = card.icon;
        const value = "value" in card ? card.value : "compound" in card ? `${stats.assets}/${stats.parts}` : stats[card.key];
        return (
          <article key={card.label} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-[#ED1C24] hover:shadow-md system-map-fade-up" style={{ animationDelay: `${index * 55}ms` }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-[#4B5563]">{card.label}</p>
                <p className="mt-3 text-3xl font-black text-[#111827]">{value}</p>
              </div>
              <span className={`rounded-md p-2 ${card.accent}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
            </div>
            <p className="mt-4 text-xs font-semibold text-[#4B5563]">{card.detail}</p>
          </article>
        );
      })}
    </section>
  );
}
