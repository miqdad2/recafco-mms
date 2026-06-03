import Link from "next/link";
import { LayoutDashboard, Printer, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PresentationModeToggle } from "@/components/system-map/presentation-mode-toggle";

export function SystemMapHeader({ presentation }: { presentation: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-md border border-[#E5E7EB] bg-[#111827] p-6 text-white shadow-sm system-map-fade-up">
      <div className="absolute inset-x-0 top-0 h-1 bg-[#ED1C24]" />
      <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-4xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-red-200">Enterprise maintenance command view</p>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">RECAFCO Maintenance System Map</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-200">
            A live overview of the enterprise maintenance workflow, modules, roles, and implementation progress.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/system-map">
            <Button variant="secondary">
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Refresh data
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="secondary">
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              Dashboard
            </Button>
          </Link>
          <div className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white">
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print ready
          </div>
          <PresentationModeToggle enabled={presentation} />
        </div>
      </div>
    </section>
  );
}
