import Link from "next/link";
import { ArrowRight, MonitorPlay, RefreshCw } from "lucide-react";

import { heroBadges } from "@/lib/architecture/config";
import type { ArchitectureStats } from "@/lib/architecture/stats";

const statLabels: Array<[keyof ArchitectureStats, string]> = [
  ["users", "Users"],
  ["roles", "Roles"],
  ["permissions", "Permissions"],
  ["departments", "Departments"],
  ["assets", "Assets"],
  ["workOrders", "Work Orders"],
  ["notifications", "Notifications"],
  ["unreadNotifications", "Unread"],
  ["auditLogs", "Audit Logs"]
];

export function ArchitectureHero({ stats }: { stats: ArchitectureStats }) {
  return (
    <section className="rounded-md border border-[#111827] bg-[#111827] p-5 text-white shadow-sm lg:p-7">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-4xl">
          <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">RECAFCO MMS</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">RECAFCO System Architecture</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-300">
            A technical overview of the secure, scalable, role-based enterprise maintenance platform.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {heroBadges.map((badge) => (
              <span key={badge} className="rounded-md border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white">
                {badge}
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href="/admin/system-map" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-black text-white hover:bg-red-700">Open System Map <ArrowRight className="h-4 w-4" /></Link>
          <Link href="/admin/demo-guide" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-black text-[#111827] hover:bg-gray-100">Open Demo Guide <ArrowRight className="h-4 w-4" /></Link>
          <Link href="/admin/architecture?presentation=1" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-black text-[#111827] hover:bg-gray-100">Presentation Mode <MonitorPlay className="h-4 w-4" /></Link>
          <Link href="/admin/architecture" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-black text-[#111827] hover:bg-gray-100">Refresh Health Stats <RefreshCw className="h-4 w-4" /></Link>
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-9">
        {statLabels.map(([key, label]) => (
          <div key={key} className="rounded-md border border-white/10 bg-white/10 p-3">
            <p className="text-2xl font-black">{stats[key]}</p>
            <p className="mt-1 text-[11px] font-bold uppercase text-gray-300">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
