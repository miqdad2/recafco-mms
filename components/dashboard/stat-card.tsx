import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  mobileLabel?: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone?: "red" | "amber" | "green" | "blue" | "gray";
};

const toneStyles = {
  red: {
    accent: "bg-[#ED1C24]",
    bg: "bg-red-50/40",
    icon: "bg-red-100 text-[#ED1C24]",
    value: "text-[#111827]",
  },
  amber: {
    accent: "bg-[#F59E0B]",
    bg: "bg-amber-50/50",
    icon: "bg-amber-100 text-[#B45309]",
    value: "text-[#111827]",
  },
  green: {
    accent: "bg-[#16A34A]",
    bg: "bg-green-50/30",
    icon: "bg-green-100 text-[#16A34A]",
    value: "text-[#111827]",
  },
  blue: {
    accent: "bg-[#2563EB]",
    bg: "bg-blue-50/20",
    icon: "bg-blue-100 text-[#2563EB]",
    value: "text-[#111827]",
  },
  gray: {
    accent: "bg-[#6B7280]",
    bg: "bg-white",
    icon: "bg-gray-100 text-[#4B5563]",
    value: "text-[#111827]",
  },
};

export function StatCard({ label, mobileLabel, value, detail, icon: Icon, tone = "red" }: StatCardProps) {
  const styles = toneStyles[tone];

  return (
    <div
      className={cn(
        "group relative min-h-28 overflow-hidden rounded-md border border-[#DDE2EA] p-4 pl-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#C9D0DA] hover:shadow-md sm:min-h-32",
        styles.bg
      )}
    >
      {/* Left accent bar */}
      <div className={cn("absolute inset-y-0 left-0 w-1 rounded-l-md", styles.accent)} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-[#334155] sm:text-sm">
            {mobileLabel ? (
              <>
                <span className="sm:hidden">{mobileLabel}</span>
                <span className="hidden sm:inline">{label}</span>
              </>
            ) : (
              label
            )}
          </p>
          <p className={cn("mt-2 text-2xl font-black tracking-tight sm:text-3xl", styles.value)}>{value}</p>
        </div>
        <div className={cn("rounded-lg p-2 sm:p-2.5", styles.icon)}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] font-medium leading-4 text-[#64748B] sm:mt-3 sm:text-xs sm:leading-5">
        {detail}
      </p>
    </div>
  );
}
