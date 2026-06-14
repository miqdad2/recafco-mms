import Link from "next/link";
import { Database, LayoutDashboard, PencilRuler, Printer, RotateCw, ShieldCheck } from "lucide-react";

import { PresentationModeToggle } from "@/components/system-map/presentation-mode-toggle";
import { Button } from "@/components/ui/button";

export function SystemMapHero({ presentation, editable = false }: { presentation: boolean; editable?: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-md border border-[#1F2937] bg-[#111827] text-white shadow-sm system-map-fade-up">
      <div className="absolute inset-x-0 top-0 h-1 bg-[#ED1C24]" />
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="relative p-6 sm:p-8 lg:p-10">
        <div className="grid gap-8 xl:grid-cols-[1fr_360px] xl:items-end">
          <div>
            <p className="text-xs font-black uppercase text-red-200">Enterprise Operations Control Center</p>
            <h1 className={presentation ? "mt-4 max-w-5xl text-5xl font-black leading-tight" : "mt-4 max-w-5xl text-4xl font-black leading-tight sm:text-5xl"}>
              RECAFCO Enterprise Maintenance Control Map
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-gray-200">
              A live visual overview of work orders, approvals, technician execution, spare parts, purchase, finance, CEO approval, and asset history.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["5 Phases Completed", "Enterprise Workflow Active", "Super Admin View", "Live Database Data"].map((badge) => (
                <span key={badge} className="rounded-md border border-white/15 bg-white/10 px-3 py-2 text-xs font-black uppercase text-white">{badge}</span>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-[#ED1C24] p-3 text-white"><ShieldCheck className="h-6 w-6" aria-hidden="true" /></span>
              <div>
                <p className="text-sm font-black">Secured management view</p>
                <p className="text-xs text-gray-300">Role-gated, audited, live data.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-2">
              <Link href="/admin/system-map"><Button variant="secondary" className="w-full"><RotateCw className="h-4 w-4" aria-hidden="true" />Refresh Data</Button></Link>
              {editable ? <Link href="/admin/system-map/edit"><Button variant="secondary" className="w-full"><PencilRuler className="h-4 w-4" aria-hidden="true" />Editable Workshop Map</Button></Link> : null}
              <Link href="/dashboard"><Button variant="secondary" className="w-full"><LayoutDashboard className="h-4 w-4" aria-hidden="true" />Dashboard</Button></Link>
              <div className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white"><Printer className="h-4 w-4" aria-hidden="true" />Print Ready</div>
              <PresentationModeToggle enabled={presentation} />
            </div>
            <div className="mt-5 flex items-center gap-2 text-xs font-semibold text-gray-300"><Database className="h-4 w-4" aria-hidden="true" />Local database-backed operational snapshot</div>
          </div>
        </div>
      </div>
    </section>
  );
}
