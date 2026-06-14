import Link from "next/link";
import { AlertTriangle, BarChart3, Building2, DollarSign, ShieldAlert, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CeoReportMode } from "@/lib/reports/data";

type CeoModeConfig = {
  id: CeoReportMode;
  label: string;
  description: string;
  icon: React.ElementType;
  urgency?: boolean;
};

const CEO_MODES: CeoModeConfig[] = [
  {
    id: "executive-summary",
    label: "Executive Summary",
    description: "Monthly overview across all departments",
    icon: TrendingUp
  },
  {
    id: "ceo-approvals",
    label: "CEO Approvals",
    description: "Purchase requests pending your decision",
    icon: ShieldAlert,
    urgency: true
  },
  {
    id: "cost-exposure",
    label: "Cost Exposure",
    description: "Pending and approved purchase values",
    icon: DollarSign,
    urgency: true
  },
  {
    id: "blocked-operations",
    label: "Blocked Operations",
    description: "Work orders waiting for parts or purchase",
    icon: AlertTriangle,
    urgency: true
  },
  {
    id: "department-performance",
    label: "Dept. Performance",
    description: "Work order volume by department",
    icon: Building2
  },
  {
    id: "asset-risk",
    label: "Asset Risk",
    description: "High-risk and frequently broken assets",
    icon: BarChart3
  }
];

export function CeoReportModeNav({ selectedMode }: { selectedMode: CeoReportMode }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-2 pb-1">
        {CEO_MODES.map((mode) => {
          const isSelected = selectedMode === mode.id;
          const Icon = mode.icon;
          return (
            <Link
              key={mode.id}
              href={`?report=${mode.id}`}
              className={cn(
                "flex min-w-[136px] max-w-[160px] flex-col gap-1 rounded-lg border p-3 text-left transition",
                isSelected
                  ? "border-[#ED1C24] bg-red-50 shadow-sm"
                  : "border-[#E5E7EB] bg-white hover:border-gray-300 hover:bg-gray-50"
              )}
            >
              <div className="flex items-center gap-1.5">
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isSelected ? "text-[#ED1C24]" : mode.urgency ? "text-amber-500" : "text-[#4B5563]"
                  )}
                  aria-hidden="true"
                />
                <span className={cn("text-xs font-bold leading-tight", isSelected ? "text-[#ED1C24]" : "text-[#111827]")}>
                  {mode.label}
                </span>
              </div>
              <p className={cn("text-xs leading-snug", isSelected ? "text-red-700/80" : "text-[#6B7280]")}>
                {mode.description}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
