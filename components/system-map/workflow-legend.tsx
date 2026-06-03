import { StatusBadge } from "@/components/ui/status-badge";

const legend = [
  { label: "Creation / input", tone: "blue" as const },
  { label: "Approval / waiting", tone: "amber" as const },
  { label: "Execution / success", tone: "green" as const },
  { label: "Escalation / threshold", tone: "red" as const },
  { label: "Upcoming / future", tone: "gray" as const }
];

export function WorkflowLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {legend.map((item) => <StatusBadge key={item.label} label={item.label} tone={item.tone} />)}
    </div>
  );
}
