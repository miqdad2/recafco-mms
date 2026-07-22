import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { StatusBadge } from "@/components/ui/status-badge";
import { StockAvailabilityBadge } from "@/components/store/stock-badges";
import type { CurrentUserContext } from "@/lib/auth/context";

// Per-item issue status — distinct from `stock_availability` (a pre-issue
// stock-check concept, still shown separately). This reflects what has
// actually moved out through the Offline Inventory Control ledger so far
// (Maintenance Workflow Redesign Unit 8 Task 5).
function itemIssueStatus(requested: number, issued: number): { label: string; tone: "green" | "amber" | "gray" } {
  if (issued <= 0) return { label: "Pending", tone: "gray" };
  if (issued < requested) return { label: "Partially Issued", tone: "amber" };
  return { label: "Issued", tone: "green" };
}

export function PartsRequestItemsTable({ items, context }: { items: Array<Record<string, unknown>>; context: CurrentUserContext }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
          <tr>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2">Part No.</th>
            <th className="px-3 py-2">SS Rec. Code</th>
            <th className="px-3 py-2">Requested</th>
            <th className="px-3 py-2">Unit price</th>
            <th className="px-3 py-2">Total</th>
            <th className="px-3 py-2">Issued</th>
            <th className="px-3 py-2">Remaining</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Availability</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {items.map((item) => {
            const requested = Number(item.quantity_requested ?? 0);
            const issued = Number(item.issued_quantity ?? 0);
            const remaining = Math.max(requested - issued, 0);
            const status = itemIssueStatus(requested, issued);
            return (
              <tr key={String(item.id)}>
                <td className="px-3 py-2 font-semibold">{String(item.description ?? "-")}</td>
                <td className="px-3 py-2">{String(item.part_number ?? "-")}</td>
                <td className="px-3 py-2">{String(item.ss_rec_code ?? "-")}</td>
                <td className="px-3 py-2">{String(item.quantity_requested ?? "0")}</td>
                <td className="px-3 py-2"><CostVisibilityGuard context={context}>{String(item.unit_price ?? "0")}</CostVisibilityGuard></td>
                <td className="px-3 py-2"><CostVisibilityGuard context={context}>{String(item.total_price ?? "0")}</CostVisibilityGuard></td>
                <td className="px-3 py-2">{String(item.issued_quantity ?? "0")}</td>
                <td className="px-3 py-2">{remaining.toFixed(2)}</td>
                <td className="px-3 py-2"><StatusBadge label={status.label} tone={status.tone} /></td>
                <td className="px-3 py-2"><StockAvailabilityBadge status={String(item.stock_availability ?? "Unchecked")} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
