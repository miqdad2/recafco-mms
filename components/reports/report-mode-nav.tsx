import Link from "next/link";
import { AlertTriangle, BarChart3, Calendar, ClipboardCheck, Package, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ReportMode } from "@/lib/reports/data";

type ModeConfig = {
  id: ReportMode;
  label: string;
  description: string;
  icon: React.ElementType;
  urgency?: boolean;
};

const MODES: ModeConfig[] = [
  {
    id: "pending-approvals",
    label: "Pending Approvals",
    description: "WOs needing your decision",
    icon: ClipboardCheck,
    urgency: true
  },
  {
    id: "overdue",
    label: "Overdue",
    description: "Jobs delayed past target date",
    icon: AlertTriangle,
    urgency: true
  },
  {
    id: "waiting-parts",
    label: "Waiting Parts",
    description: "Jobs blocked by parts or purchase",
    icon: Package
  },
  {
    id: "asset-history",
    label: "Asset History",
    description: "Repeated issues by asset",
    icon: Wrench
  },
  {
    id: "monthly-summary",
    label: "Monthly Summary",
    description: "Department summary by status and type",
    icon: Calendar
  },
  {
    id: "technician-workload",
    label: "Technician Workload",
    description: "Workload by technician or team",
    icon: BarChart3
  }
];

export function ReportModeNav({ selectedMode }: { selectedMode: ReportMode }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-2 pb-1">
        {MODES.map((mode) => {
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
