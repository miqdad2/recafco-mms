import { StatusBadge } from "@/components/ui/status-badge";
import { StockAvailabilityBadge } from "@/components/store/stock-badges";
import type { CurrentUserContext } from "@/lib/auth/context";
import { canEnterMaterialRequestPrice } from "@/lib/security/permissions";
import { formatKwd, isPriceBasis } from "@/lib/materials/request-pricing";

// Per-item issue status — distinct from `stock_availability` (a pre-issue
// stock-check concept, still shown separately). This reflects what has
// actually moved out through the Offline Inventory Control ledger so far
// (Maintenance Workflow Redesign Unit 8 Task 5).
function itemIssueStatus(requested: number, issued: number): { label: string; tone: "green" | "amber" | "gray" } {
  if (issued <= 0) return { label: "Pending", tone: "gray" };
  if (issued < requested) return { label: "Partially Issued", tone: "amber" };
  return { label: "Issued", tone: "green" };
}

const qtyText = (n: number) => String(Number(n.toFixed(3)));

// Purchase-first view of one saved line. quantity_requested/unit are the
// stock side; the purchase side exists only when purchase_unit/
// conversion_quantity were saved (1 purchase_unit = conversion unit).
// Pricing follows the saved price basis (lib/materials/request-pricing.ts);
// lines saved before the basis existed show their stored unit_price/
// total_price, which are per stock unit.
function lineView(item: Record<string, unknown>) {
  const stockQty = Number(item.quantity_requested ?? 0);
  const stockUnit = String(item.unit ?? "");
  const conversion = item.purchase_unit && Number(item.conversion_quantity) > 0 ? Number(item.conversion_quantity) : null;
  const purchaseUnit = conversion ? String(item.purchase_unit) : stockUnit;
  const purchaseQty = conversion ? stockQty / conversion : stockQty;
  const basis = isPriceBasis(item.price_basis) ? item.price_basis : null;
  const entered = item.entered_unit_price == null ? null : Number(item.entered_unit_price);
  if (basis && entered !== null) {
    const perStock = basis === "stock_unit";
    return {
      stockQty, stockUnit, conversion, purchaseUnit, purchaseQty,
      // Always states the unit the price is for: "45.000 KWD for 1 BARREL".
      priceText: `${formatKwd(entered)} KWD for 1 ${perStock ? stockUnit : purchaseUnit}`,
      totalText: `${formatKwd(perStock ? stockQty * entered : purchaseQty * entered)} KWD`,
    };
  }
  return {
    stockQty, stockUnit, conversion, purchaseUnit, purchaseQty,
    // Older lines: unit_price is per stock unit.
    priceText: item.unit_price == null ? null : `${formatKwd(Number(item.unit_price))} KWD for 1 ${stockUnit || "unit"}`,
    totalText: item.total_price == null ? null : `${formatKwd(Number(item.total_price))} KWD`,
  };
}

export function PartsRequestItemsTable({ items, context }: { items: Array<Record<string, unknown>>; context: CurrentUserContext }) {
  // Request line prices follow the material-request-price permission
  // (Manager, Super Admin, Data Entry), not general cost visibility.
  const showPrices = canEnterMaterialRequestPrice(context);
  const restricted = <span className="text-[#4B5563]">Restricted</span>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
          <tr>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2">Part No.</th>
            <th className="px-3 py-2">SS Rec. Code</th>
            <th className="px-3 py-2">Requested Purchase Qty</th>
            <th className="px-3 py-2">Expected Stock</th>
            <th className="px-3 py-2">Estimated Price</th>
            <th className="px-3 py-2">Estimated Total</th>
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
            const line = lineView(item);
            return (
              <tr key={String(item.id)}>
                <td className="px-3 py-2 font-semibold">
                  {String(item.description ?? "-")}
                  {/* Always 1 purchase unit = N stock units, never reversed. */}
                  {line.conversion ? (
                    <span className="block text-xs font-normal text-[#4B5563]">
                      Conversion: 1 {line.purchaseUnit} = {qtyText(line.conversion)} {line.stockUnit}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{String(item.part_number ?? "-")}</td>
                <td className="px-3 py-2">{String(item.ss_rec_code ?? "-")}</td>
                <td className="px-3 py-2">
                  {qtyText(line.purchaseQty)} {line.purchaseUnit}
                </td>
                <td className="px-3 py-2">
                  {qtyText(line.stockQty)} {line.stockUnit}
                </td>
                {/* Job Card Materials Request UX and Existing Inventory
                    Selection Fix, Task 8 — unit_price/total_price are only
                    ever null when genuinely "not priced yet"; shown as
                    that phrase, never a misleading 0. */}
                <td className="px-3 py-2">
                  {showPrices ? (
                    line.priceText === null ? (
                      "Not priced yet"
                    ) : (
                      <>
                        {line.priceText}
                      </>
                    )
                  ) : (
                    restricted
                  )}
                </td>
                <td className="px-3 py-2">{showPrices ? (line.totalText === null ? "Not priced yet" : line.totalText) : restricted}</td>
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
