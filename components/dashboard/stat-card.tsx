import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  mobileLabel?: string;
  value: string | number;
  detail?: string;
  icon: LucideIcon;
  tone?: "red" | "amber" | "green" | "blue" | "gray";
  compact?: boolean;
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

export function StatCard({ label, mobileLabel, value, detail, icon: Icon, tone = "red", compact = false }: StatCardProps) {
  const styles = toneStyles[tone];

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-md border border-[#DDE2EA] shadow-sm transition hover:-translate-y-0.5 hover:border-[#C9D0DA] hover:shadow-md",
        compact ? "p-3 pl-4" : "min-h-28 p-4 pl-5 sm:min-h-32",
        styles.bg
      )}
    >
      {/* Left accent bar */}
      <div className={cn("absolute inset-y-0 left-0 w-1 rounded-l-md", styles.accent)} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("truncate font-semibold text-[#334155]", compact ? "text-xs" : "text-xs sm:text-sm")}>
            {mobileLabel ? (
              <>
                <span className="sm:hidden">{mobileLabel}</span>
                <span className="hidden sm:inline">{label}</span>
              </>
            ) : (
              label
            )}
          </p>
          <p className={cn("font-black tracking-tight", compact ? "mt-1 text-2xl" : "mt-2 text-2xl sm:text-3xl", styles.value)}>{value}</p>
        </div>
        <div className={cn("rounded-lg", compact ? "p-1.5" : "p-2 sm:p-2.5", styles.icon)}>
          <Icon className={compact ? "h-4 w-4" : "h-4 w-4 sm:h-5 sm:w-5"} aria-hidden="true" />
        </div>
      </div>
      {detail && (
        <p
          className={cn(
            "text-[11px] font-medium leading-4 text-[#64748B]",
            compact ? "mt-1.5 line-clamp-1" : "mt-2 line-clamp-2 sm:mt-3 sm:text-xs sm:leading-5"
          )}
        >
          {detail}
        </p>
      )}
    </div>
  );
}
