import type { ArchitectureTone } from "@/lib/architecture/config";
import { cn } from "@/lib/utils";

export const toneClasses: Record<ArchitectureTone, { border: string; bg: string; text: string; soft: string; line: string }> = {
  green: { border: "border-emerald-500", bg: "bg-emerald-600", text: "text-emerald-700", soft: "bg-emerald-50", line: "from-emerald-500" },
  amber: { border: "border-amber-500", bg: "bg-amber-500", text: "text-amber-700", soft: "bg-amber-50", line: "from-amber-500" },
  red: { border: "border-[#ED1C24]", bg: "bg-[#ED1C24]", text: "text-[#ED1C24]", soft: "bg-red-50", line: "from-[#ED1C24]" },
  blue: { border: "border-blue-600", bg: "bg-blue-600", text: "text-blue-700", soft: "bg-blue-50", line: "from-blue-600" },
  gray: { border: "border-gray-400", bg: "bg-gray-500", text: "text-gray-600", soft: "bg-gray-50", line: "from-gray-400" },
  charcoal: { border: "border-[#111827]", bg: "bg-[#111827]", text: "text-[#111827]", soft: "bg-gray-100", line: "from-[#111827]" }
};

export function SectionShell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="animate-in fade-in duration-500">
      <div className="mb-4">
        <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-black text-[#111827]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function FlowRail<T extends { title: string; description: string; tone: ArchitectureTone }>({ steps, compact = false }: { steps: T[]; compact?: boolean }) {
  return (
    <div className={cn("grid gap-3", compact ? "md:grid-cols-3 xl:grid-cols-6" : "md:grid-cols-2 xl:grid-cols-6")}>
      {steps.map((step, index) => {
        const tone = toneClasses[step.tone];
        return (
          <div key={`${step.title}-${index}`} className="group relative rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            {index < steps.length - 1 ? <span className={cn("absolute right-[-14px] top-8 hidden h-0.5 w-7 bg-gradient-to-r to-transparent xl:block", tone.line)} /> : null}
            <div className="flex items-start gap-3">
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-black text-white transition group-hover:animate-pulse", tone.bg)}>{index + 1}</span>
              <div>
                <h3 className="text-sm font-black text-[#111827]">{step.title}</h3>
                <p className="mt-2 text-xs leading-5 text-[#4B5563]">{step.description}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ChipList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className="rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#111827]">
          {item}
        </span>
      ))}
    </div>
  );
}
