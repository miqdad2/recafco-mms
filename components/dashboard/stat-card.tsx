import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone?: "red" | "amber" | "green" | "blue" | "gray";
};

const toneStyles = {
  red: {
    accent: "bg-[#ED1C24]",
    icon: "bg-red-50 text-[#ED1C24]",
    value: "text-[#111827]"
  },
  amber: {
    accent: "bg-[#F59E0B]",
    icon: "bg-amber-50 text-[#B45309]",
    value: "text-[#111827]"
  },
  green: {
    accent: "bg-[#16A34A]",
    icon: "bg-green-50 text-[#16A34A]",
    value: "text-[#111827]"
  },
  blue: {
    accent: "bg-[#2563EB]",
    icon: "bg-blue-50 text-[#2563EB]",
    value: "text-[#111827]"
  },
  gray: {
    accent: "bg-[#2B2B2B]",
    icon: "bg-gray-100 text-[#2B2B2B]",
    value: "text-[#111827]"
  }
};

export function StatCard({ label, value, detail, icon: Icon, tone = "red" }: StatCardProps) {
  const styles = toneStyles[tone];

  return (
    <div className="group relative min-h-36 overflow-hidden rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#C9D0DA] hover:shadow-md">
      <div className={cn("absolute inset-x-0 top-0 h-1", styles.accent)} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#334155]">{label}</p>
          <p className={cn("mt-3 text-3xl font-black tracking-tight", styles.value)}>{value}</p>
        </div>
        <div className={cn("rounded-md p-2.5", styles.icon)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-4 line-clamp-2 text-xs font-medium leading-5 text-[#64748B]">{detail}</p>
    </div>
  );
}
