import Link from "next/link";

import { getSystemMapIcon } from "@/components/system-map/system-map-icons";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SystemModule } from "@/lib/system-map/config";

function statusTone(status: SystemModule["status"]) {
  if (status === "completed") return "green";
  if (status === "active") return "blue";
  return "gray";
}

export function ModuleGrid({ modules }: { modules: SystemModule[] }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm system-map-fade-up">
      <div>
        <p className="text-xs font-black uppercase text-[#ED1C24]">Completed capability</p>
        <h2 className="mt-1 text-2xl font-black text-[#111827]">Completed Modules Grid</h2>
        <p className="mt-2 text-sm text-[#4B5563]">Small, clickable module cards that show what the system can already demonstrate.</p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {modules.map((module, index) => {
          const Icon = getSystemMapIcon(module.icon);
          return (
            <article key={module.id} className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-4 transition hover:-translate-y-1 hover:border-[#ED1C24] hover:bg-white hover:shadow-md" style={{ animationDelay: `${index * 35}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <span className="rounded-md bg-[#111827] p-2 text-white"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                <StatusBadge label={module.status} tone={statusTone(module.status)} />
              </div>
              <h3 className="mt-4 font-black text-[#111827]">{module.name}</h3>
              <p className="mt-2 min-h-10 text-sm leading-5 text-[#4B5563]">{module.description}</p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-gray-200">
                <div className={module.status === "upcoming" ? "h-full bg-gray-400" : "h-full bg-[#ED1C24]"} style={{ width: `${module.progress}%` }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {module.routes.map((route) => <Link key={route} href={route} className="rounded border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-black text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]">{route}</Link>)}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
