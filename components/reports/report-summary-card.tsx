import { cn } from "@/lib/utils";

const toneClass = {
  red: "border-red-100 bg-red-50 text-[#DC2626]",
  amber: "border-amber-100 bg-amber-50 text-[#B45309]",
  green: "border-green-100 bg-green-50 text-[#16A34A]",
  blue: "border-blue-100 bg-blue-50 text-[#2563EB]",
  gray: "border-gray-100 bg-gray-50 text-[#4B5563]"
};

export function ReportSummaryGrid({ cards }: { cards: Array<{ label: string; value: string | number; tone?: keyof typeof toneClass }> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className={cn("rounded-md border bg-white p-4 shadow-sm", toneClass[card.tone ?? "gray"])}>
          <p className="text-xs font-bold uppercase tracking-wide opacity-80">{card.label}</p>
          <p className="mt-2 text-2xl font-black">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
