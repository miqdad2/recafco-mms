import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  label: string;
  tone?: "green" | "amber" | "red" | "blue" | "gray";
};

export function StatusBadge({ label, tone = "gray" }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold",
        tone === "green" && "border-green-200 bg-green-50 text-green-700",
        tone === "amber" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "red" && "border-red-200 bg-red-50 text-red-700",
        tone === "blue" && "border-blue-200 bg-blue-50 text-blue-700",
        tone === "gray" && "border-gray-200 bg-gray-50 text-gray-700"
      )}
    >
      {label}
    </span>
  );
}
