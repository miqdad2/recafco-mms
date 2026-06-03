import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import type { CurrentUserContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/utils";

export function InventoryMovementTable({ movements, context }: { movements: Array<Record<string, unknown>>; context: CurrentUserContext }) {
  return (
    <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
            <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Part</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Qty</th><th className="px-4 py-3">Unit Price</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Comments</th></tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {movements.map((movement) => {
              const part = movement.parts as { part_code?: string; part_name?: string } | null;
              return (
                <tr key={String(movement.id)}>
                  <td className="px-4 py-3">{formatDateTime(String(movement.created_at ?? ""))}</td>
                  <td className="px-4 py-3">{part ? `${part.part_code} - ${part.part_name}` : "Part"}</td>
                  <td className="px-4 py-3">{String(movement.movement_type ?? "-")}</td>
                  <td className="px-4 py-3">{String(movement.quantity ?? "-")}</td>
                  <td className="px-4 py-3"><CostVisibilityGuard context={context}>{String(movement.unit_price ?? "0")}</CostVisibilityGuard></td>
                  <td className="px-4 py-3">{String(movement.reference ?? "-")}</td>
                  <td className="px-4 py-3">{String(movement.comments ?? "-")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
