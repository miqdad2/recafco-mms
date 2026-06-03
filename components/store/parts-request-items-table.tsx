import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { StockAvailabilityBadge } from "@/components/store/stock-badges";
import type { CurrentUserContext } from "@/lib/auth/context";

export function PartsRequestItemsTable({ items, context }: { items: Array<Record<string, unknown>>; context: CurrentUserContext }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
          <tr><th className="px-3 py-2">Description</th><th className="px-3 py-2">Part No.</th><th className="px-3 py-2">SS rec</th><th className="px-3 py-2">Requested</th><th className="px-3 py-2">Unit price</th><th className="px-3 py-2">Total</th><th className="px-3 py-2">Issued</th><th className="px-3 py-2">Availability</th></tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {items.map((item) => (
            <tr key={String(item.id)}>
              <td className="px-3 py-2 font-semibold">{String(item.description ?? "-")}</td>
              <td className="px-3 py-2">{String(item.part_number ?? "-")}</td>
              <td className="px-3 py-2">{String(item.ss_rec_code ?? "-")}</td>
              <td className="px-3 py-2">{String(item.quantity_requested ?? "0")}</td>
              <td className="px-3 py-2"><CostVisibilityGuard context={context}>{String(item.unit_price ?? "0")}</CostVisibilityGuard></td>
              <td className="px-3 py-2"><CostVisibilityGuard context={context}>{String(item.total_price ?? "0")}</CostVisibilityGuard></td>
              <td className="px-3 py-2">{String(item.issued_quantity ?? "0")}</td>
              <td className="px-3 py-2"><StockAvailabilityBadge status={String(item.stock_availability ?? "Unchecked")} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
