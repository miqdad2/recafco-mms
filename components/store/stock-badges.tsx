import { StatusBadge } from "@/components/ui/status-badge";

export function LowStockBadge({ current, minimum }: { current: number | string; minimum: number | string }) {
  const isLow = Number(current) <= Number(minimum);
  return <StatusBadge label={isLow ? "Low Stock" : "Stock OK"} tone={isLow ? "amber" : "green"} />;
}

export function StockAvailabilityBadge({ status }: { status: string }) {
  const tone = status === "Available" ? "green" : status === "Partial" ? "amber" : status === "Unavailable" ? "red" : "gray";
  return <StatusBadge label={status} tone={tone} />;
}
