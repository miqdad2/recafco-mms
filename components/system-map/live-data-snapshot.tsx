import { StatusBadge } from "@/components/ui/status-badge";
import type { SystemMapStats } from "@/lib/system-map/stats";

const statRows: Array<{ key: keyof SystemMapStats; label: string; tone: "green" | "amber" | "red" | "blue" | "gray" }> = [
  { key: "assets", label: "Total assets", tone: "blue" },
  { key: "parts", label: "Total spare parts", tone: "blue" },
  { key: "workOrders", label: "Total work orders", tone: "blue" },
  { key: "openWorkOrders", label: "Open work orders", tone: "amber" },
  { key: "closedWorkOrders", label: "Closed work orders", tone: "green" },
  { key: "pendingApprovals", label: "Pending approvals", tone: "amber" },
  { key: "waitingForParts", label: "Waiting for parts", tone: "red" },
  { key: "partsRequests", label: "Parts requests", tone: "blue" },
  { key: "purchaseRequests", label: "Purchase requests", tone: "blue" },
  { key: "financeApprovals", label: "Finance approvals", tone: "amber" },
  { key: "lowStockItems", label: "Low stock items", tone: "red" },
  { key: "unreadNotifications", label: "Unread notifications", tone: "red" },
  { key: "profiles", label: "Users", tone: "blue" },
  { key: "roles", label: "Roles", tone: "gray" },
  { key: "departments", label: "Departments", tone: "blue" }
];

export function LiveDataSnapshot({ stats }: { stats: SystemMapStats }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm system-map-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-[#ED1C24]">Live local database data</p>
          <h2 className="mt-1 text-2xl font-black text-[#111827]">Live System Snapshot</h2>
          <p className="mt-2 text-sm text-[#4B5563]">All-time operational counts from the local database. Missing data falls back safely to zero.</p>
        </div>
        <div className="flex gap-2">
          <StatusBadge label="All Time" tone="blue" />
          <StatusBadge label="Server-rendered" tone="green" />
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {statRows.map((row, index) => (
          <div key={row.key} className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-4 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-sm" style={{ animationDelay: `${index * 25}ms` }}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-[#4B5563]">{row.label}</p>
              <StatusBadge label={row.tone === "red" ? "watch" : row.tone === "amber" ? "pending" : "live"} tone={row.tone} />
            </div>
            <p className="mt-3 text-3xl font-black text-[#111827]">{stats[row.key]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
