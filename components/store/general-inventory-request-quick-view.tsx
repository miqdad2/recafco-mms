"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { receiveGeneralInventoryRequestAction } from "@/app/actions/general-inventory-requests";
import { formatKwd, round3, type PriceBasis } from "@/lib/materials/request-pricing";

export type GeneralInventoryRequestQuickViewItem = {
  id: string;
  materialName: string;
  description: string | null;
  quantityRequested: number;
  unit: string;
  unitPrice: number | null;
  totalPrice: number | null;
  // Purchase-first price basis: the price exactly as typed and which unit
  // it is per. Both null on rows saved before that unit (their unit_price
  // above is then shown per purchase unit).
  enteredUnitPrice: number | null;
  priceBasis: PriceBasis | null;
  supplier: string | null;
  receivedQuantity: number;
  // General Inventory Request Unit, Price, and Conversion Polish Unit
  // 10G.58A, Task 5/8/9 — both null means no conversion (inventory unit =
  // purchase unit, 1:1); inventoryQuantity/unitCost are the DB's own
  // generated-column values for the ORIGINAL requested quantity/price
  // (`inventory_quantity_to_add`/`unit_cost`), shown here and then
  // recalculated live in the Receive form as the user edits.
  inventoryUnit: string | null;
  conversionQuantity: number | null;
  inventoryQuantity: number | null;
  unitCost: number | null;
  // Materials Request Existing-vs-New Material and Unit Conversion UX Fix —
  // the Request / Issue Unit and the quantity entered in it; both null on
  // rows saved before that unit (their requested figures are then derived
  // from the purchase quantity and conversion, see itemQuantities below).
  // isExistingMaterial: true = linked to an Offline Inventory material,
  // false = New Material Request, null = older row with no link recorded.
  requestUnit: string | null;
  requestQuantity: number | null;
  isExistingMaterial: boolean | null;
  // Live Offline Inventory balance of the linked material, in its own unit;
  // null for an unlinked row or when the link no longer resolves.
  currentBalance: number | null;
  remarks: string | null;
};

// One place for the two units of a row: Requested is always in the
// Request / Issue Unit; the purchase side only exists when the row has a
// conversion ("1 purchaseUnit = conversion requestedUnit").
// Estimated price as entered, the unit it is per, and the total — same
// rule as the request form (lib/materials/request-pricing.ts): per purchase
// unit -> purchase qty × price; per stock unit -> stock qty × price. Rows
// saved before the price basis existed show their stored unit_price, which
// is per purchase unit.
function requestUnitPricing(item: GeneralInventoryRequestQuickViewItem, q: ReturnType<typeof itemQuantities>) {
  if (item.enteredUnitPrice !== null && item.priceBasis) {
    const perStock = item.priceBasis === "stock_unit";
    const unitLabel = perStock ? q.requestedUnit : q.purchaseUnit;
    return {
      price: item.enteredUnitPrice,
      unitLabel,
      total: round3((perStock ? q.requestedQty : item.quantityRequested) * item.enteredUnitPrice)
    };
  }
  if (item.unitPrice === null) return { price: null, unitLabel: "", total: null };
  return {
    price: item.unitPrice,
    unitLabel: q.purchaseUnit,
    total: round3(item.quantityRequested * item.unitPrice)
  };
}

function itemQuantities(item: GeneralInventoryRequestQuickViewItem) {
  const conversion = item.inventoryUnit && item.conversionQuantity ? item.conversionQuantity : null;
  if (!conversion) {
    return {
      conversion: null,
      requestedQty: item.requestQuantity ?? item.quantityRequested,
      requestedUnit: item.requestUnit ?? item.unit,
      purchaseQty: item.quantityRequested,
      purchaseUnit: item.unit
    };
  }
  return {
    conversion,
    requestedQty: item.requestQuantity ?? item.inventoryQuantity ?? item.quantityRequested * conversion,
    requestedUnit: item.inventoryUnit ?? item.unit,
    // From the exact requested quantity where it was recorded, so the
    // estimate is not limited to the stored purchase quantity's 2 decimals.
    purchaseQty: item.requestQuantity !== null ? item.requestQuantity / conversion : item.quantityRequested,
    purchaseUnit: item.unit
  };
}

// Quantities: up to 3 decimals, no trailing zeros (0.111, 0.25, 2) — same
// precision the request form's own Purchase Estimate preview uses.
function fmtQty(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toFixed(3))) : "0";
}

export type GeneralInventoryRequestQuickViewData = {
  id: string;
  requestNumber: string | null;
  purpose: string;
  remarks: string | null;
  department: string | null;
  location: string | null;
  requestedByName: string | null;
  requestedDateLabel: string;
  status: string;
  items: GeneralInventoryRequestQuickViewItem[];
  closeHref: string;
  // True only right after a successful submit (and only while Pending):
  // shows the "request submitted" message and the next-action buttons.
  // viewHref is this same request's plain detail view, without that state.
  justSubmitted: boolean;
  viewHref: string;
  // Both decided server-side; when false the matching item fields above
  // are already null. canViewPrices covers the request's own Estimated Unit
  // Price / Estimated Total (Manager, Super Admin, Data Entry).
  // canViewCosts is full cost visibility and covers the receive-side unit
  // price input and the inventory unit cost.
  canViewPrices: boolean;
  canViewCosts: boolean;
  canReceive: boolean;
  inventoryReference: string | null;
  errorMessage?: string | null;
};

function statusTone(status: string): "green" | "amber" | "gray" {
  if (status === "Completed") return "green";
  if (status === "Cancelled") return "gray";
  return "amber";
}

// Materials Request Type Selection Flow Unit 10G.58, Task 6/10 — detail
// view for a General Inventory / Stock Request, plus (when Pending and the
// viewer has the offline-inventory receive permission) an inline Receive
// Materials form. Submitting it posts to receiveGeneralInventoryRequestAction,
// which writes offline_inventory_movements rows (movement_type "RECEIVED",
// reference_number = this request's number) — never touches any Job Card
// table. Entirely separate from MaterialsRequestQuickView/
// StoreSendMaterialsPopup (the Job Card-linked equivalents), which are
// unchanged.
export function GeneralInventoryRequestQuickView({ data }: { data: GeneralInventoryRequestQuickViewData }) {
  const router = useRouter();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [receiving, setReceiving] = useState(false);
  // Task 8 — live-recalculated Inventory Quantity/Unit Cost as the user
  // edits Received Qty / Unit Price in the receive form below; keyed by
  // item id, seeded from the requested values.
  const [receiveDrafts, setReceiveDrafts] = useState<Record<string, { qty: string; price: string }>>({});

  function receiveDraft(item: GeneralInventoryRequestQuickViewItem) {
    return (
      receiveDrafts[item.id] ?? {
        // Received quantity is entered in the purchase unit (the same unit
        // as the request when there is no conversion).
        qty: fmtQty(itemQuantities(item).purchaseQty),
        price: item.unitPrice !== null ? String(item.unitPrice) : ""
      }
    );
  }

  function updateReceiveDraft(item: GeneralInventoryRequestQuickViewItem, patch: Partial<{ qty: string; price: string }>) {
    setReceiveDrafts((prev) => ({ ...prev, [item.id]: { ...receiveDraft(item), ...patch } }));
  }

  function close() {
    router.replace(data.closeHref, { scroll: false });
  }

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.closeHref]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const canStartReceive = data.canReceive && data.status === "Pending" && !receiving;
  const secondaryButton =
    "inline-flex min-h-[44px] items-center rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] hover:bg-gray-50 sm:min-h-0";

  const pricedItems = data.items.filter((i) => i.unitPrice !== null);
  const pricedCount = pricedItems.length;
  const totalRequestedValue = pricedItems.reduce((sum, i) => sum + (requestUnitPricing(i, itemQuantities(i)).total ?? 0), 0);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={close} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="girqv-heading"
          className="relative flex w-full max-w-[720px] flex-col rounded-xl bg-white shadow-2xl max-h-[90vh] sm:max-h-[85vh]"
        >
          <div className="flex shrink-0 items-start gap-3 rounded-t-xl border-b border-[#E5E7EB] bg-[#F5F6F8] px-5 py-4">
            <div className="min-w-0 flex-1">
              <p id="girqv-heading" className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">
                {data.requestNumber ?? "General Inventory Request"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#111827] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  General Inventory Request
                </span>
                <StatusBadge label={data.status} tone={statusTone(data.status)} />
              </div>
              {data.status === "Pending" && (
                <p className="mt-1.5 text-xs text-[#4B5563]">
                  Pending means materials have been requested but not received yet.
                </p>
              )}
            </div>
            <button
              ref={closeButtonRef}
              onClick={close}
              className="mt-0.5 shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-200 hover:text-[#111827] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
              aria-label="Close quick view"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#E5E7EB]">
            {data.errorMessage && (
              <div className="mx-5 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {data.errorMessage}
              </div>
            )}

            {/* Shown once, right after submit. The request's own status
                badge above stays Pending — nothing has been received. */}
            {data.justSubmitted && (
              <div role="status" className="mx-5 my-4 flex items-start gap-3 rounded-md border border-green-200 bg-green-50 px-4 py-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-green-800">General Inventory Material Request Submitted</p>
                  <p className="mt-0.5 text-sm text-green-800">
                    Your request has been saved. Stock balance will update only after materials are received.
                  </p>
                  <p className="mt-1.5 text-sm text-[#111827]">
                    Request No: <span className="font-bold">{data.requestNumber ?? "—"}</span>
                    <span className="mx-2 text-[#9CA3AF]">·</span>
                    Status: <span className="font-bold">{data.status}</span>
                  </p>
                </div>
              </div>
            )}

            <section className="grid gap-3 px-5 py-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Purpose</p>
                <p className="mt-0.5 text-sm font-semibold text-[#111827]">{data.purpose}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Requested By / Date</p>
                <p className="mt-0.5 text-sm font-semibold text-[#111827]">
                  {data.requestedByName ?? "—"} · {data.requestedDateLabel}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Department / Location</p>
                <p className="mt-0.5 text-sm font-semibold text-[#111827]">
                  {[data.department, data.location].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              {data.remarks && (
                <div className="sm:col-span-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Remarks</p>
                  <p className="mt-0.5 text-sm text-[#4B5563]">{data.remarks}</p>
                </div>
              )}
              {data.status === "Completed" && data.inventoryReference && (
                <div className="sm:col-span-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Inventory movement reference</p>
                  <p className="mt-0.5 text-sm font-semibold text-[#111827]">{data.inventoryReference}</p>
                </div>
              )}
            </section>

            <section className="px-5 py-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#4B5563]">Material Items</p>
              {!receiving ? (
                <div className="overflow-x-auto rounded-md border border-[#E5E7EB]">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                      <tr>
                        <th className="px-3 py-2 text-left">Material</th>
                        <th className="px-3 py-2 text-right">Requested Purchase Qty</th>
                        <th className="px-3 py-2 text-right">Expected Stock After Receiving</th>
                        {data.canViewPrices && <th className="px-3 py-2 text-right">Estimated Price</th>}
                        {data.canViewPrices && <th className="px-3 py-2 text-right">Estimated Total</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {data.items.map((item) => {
                        const q = itemQuantities(item);
                        const pricing = requestUnitPricing(item, q);
                        return (
                          <tr key={item.id}>
                            <td className="px-3 py-2 font-semibold text-[#111827]">
                              {item.isExistingMaterial !== null && (
                                <span className="mb-1 block">
                                  <StatusBadge
                                    label={item.isExistingMaterial ? "Existing Inventory" : "New Material"}
                                    tone={item.isExistingMaterial ? "green" : "amber"}
                                  />
                                </span>
                              )}
                              {item.materialName}
                              {item.isExistingMaterial === true && item.currentBalance !== null && (
                                <p className="text-xs font-normal text-[#4B5563]">
                                  Current Balance: {fmtQty(item.currentBalance)} {q.requestedUnit}
                                </p>
                              )}
                              {item.isExistingMaterial === false && (
                                <p className="text-xs font-normal text-[#4B5563]">Not linked to inventory yet</p>
                              )}
                              {item.description && <p className="text-xs font-normal text-[#9CA3AF]">{item.description}</p>}
                              {item.supplier && <p className="text-xs font-normal text-[#9CA3AF]">Supplier: {item.supplier}</p>}
                              {item.remarks && <p className="text-xs font-normal text-[#9CA3AF]">Note: {item.remarks}</p>}
                              {q.conversion && (
                                <p className="mt-0.5 text-xs font-normal text-[#4B5563]">
                                  1 {q.purchaseUnit} = {fmtQty(q.conversion)} {q.requestedUnit}
                                  {data.canViewCosts && item.unitCost !== null && (
                                    <> · Unit Cost {item.unitCost.toFixed(3)} per {q.requestedUnit}</>
                                  )}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-[#111827]">
                              {fmtQty(q.purchaseQty)} {q.purchaseUnit}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-[#4B5563]">
                              {fmtQty(q.requestedQty)} {q.requestedUnit}
                            </td>
                            {data.canViewPrices && (
                              <td className="px-3 py-2 text-right tabular-nums text-[#4B5563]">
                                {pricing.price !== null ? (
                                  <>
                                    {/* Always states the unit the price is for. */}
                                    {formatKwd(pricing.price)} KWD for 1 {pricing.unitLabel}
                                  </>
                                ) : (
                                  "Not priced yet"
                                )}
                              </td>
                            )}
                            {data.canViewPrices && (
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#111827]">
                                {/* Per the price basis; "—" when unpriced, never 0. */}
                                {pricing.total !== null ? `${formatKwd(pricing.total)} KWD` : "—"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    {data.canViewPrices && (
                      <tfoot>
                        <tr className="bg-gray-50">
                          <td className="px-3 py-2 text-right text-xs font-bold text-[#4B5563]" colSpan={4}>
                            Estimated Total{pricedCount > 0 && pricedCount < data.items.length ? " (priced items only)" : ""}
                          </td>
                          <td className="px-3 py-2 text-right text-sm font-bold text-[#111827]">
                            {pricedCount > 0 ? `${formatKwd(totalRequestedValue)} KWD` : "Not priced yet"}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              ) : (
                <form action={receiveGeneralInventoryRequestAction}>
                  <input type="hidden" name="request_id" value={data.id} />
                  <div className="overflow-x-auto rounded-md border border-[#E5E7EB]">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                        <tr>
                          <th className="px-3 py-2 text-left">Material</th>
                          <th className="px-3 py-2 text-right">Requested</th>
                          <th className="w-32 px-3 py-2 text-right">Received Qty</th>
                          {data.canViewCosts && <th className="w-28 px-3 py-2 text-right">Unit Price</th>}
                          <th className="px-3 py-2 text-right">Added to Inventory</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E7EB]">
                        {data.items.map((item, i) => {
                          const q = itemQuantities(item);
                          const draft = receiveDraft(item);
                          const qty = Number(draft.qty) || 0;
                          const price = draft.price ? Number(draft.price) : null;
                          const conversion = q.conversion ?? 1;
                          const invQty = qty * conversion;
                          const unitCost = price !== null ? price / conversion : null;
                          return (
                            <tr key={item.id}>
                              <input type="hidden" name={`item_id_${i}`} value={item.id} />
                              <td className="px-3 py-2 font-semibold text-[#111827]">
                                {item.materialName}
                                <p className="text-xs font-normal text-[#4B5563]">
                                  {item.isExistingMaterial
                                    ? "Existing inventory material — added to its current balance."
                                    : "Not linked to Inventory — registered as a new material on receive."}
                                </p>
                                {q.conversion && (
                                  <p className="text-xs font-normal text-[#4B5563]">
                                    1 {q.purchaseUnit} = {fmtQty(q.conversion)} {q.requestedUnit}
                                  </p>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-[#4B5563]">
                                {fmtQty(q.requestedQty)} {q.requestedUnit}
                                {q.conversion && (
                                  <p className="text-xs">
                                    ≈ {fmtQty(q.purchaseQty)} {q.purchaseUnit}
                                  </p>
                                )}
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  name={`received_quantity_${i}`}
                                  type="number"
                                  step="any"
                                  min="0.0001"
                                  value={draft.qty}
                                  onChange={(e) => updateReceiveDraft(item, { qty: e.target.value })}
                                  aria-label={`Received quantity in ${q.purchaseUnit}`}
                                  className="focus-ring w-full rounded border border-[#E5E7EB] px-2 py-1 text-right text-sm"
                                />
                                <p className="mt-0.5 text-right text-xs text-[#4B5563]">{q.purchaseUnit}</p>
                              </td>
                              {data.canViewCosts && (
                                <td className="px-1.5 py-1">
                                  <input
                                    name={`received_unit_price_${i}`}
                                    type="number"
                                    step="0.001"
                                    min="0"
                                    value={draft.price}
                                    onChange={(e) => updateReceiveDraft(item, { price: e.target.value })}
                                    aria-label={`Unit price per ${q.purchaseUnit}`}
                                    className="focus-ring w-full rounded border border-[#E5E7EB] px-2 py-1 text-right text-sm"
                                  />
                                  <p className="mt-0.5 text-right text-xs text-[#4B5563]">per {q.purchaseUnit}</p>
                                </td>
                              )}
                              <td className="px-3 py-2 text-right text-xs tabular-nums text-[#111827]">
                                <span className="font-semibold">
                                  {fmtQty(invQty)} {q.requestedUnit}
                                </span>
                                {data.canViewCosts && unitCost !== null && (
                                  <p className="text-[#4B5563]">{unitCost.toFixed(3)} / {q.requestedUnit}</p>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-[#9CA3AF]">
                    All items are received together and added into inventory. Enter the received quantity in the unit shown
                    under each field; where an item is purchased in a different unit, it is converted to the request unit
                    shown under Added to Inventory.
                  </p>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#111827] px-4 py-2 text-sm font-bold text-white hover:bg-[#2b2b2b]"
                    >
                      Add to Inventory
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceiving(false)}
                      className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>

          <div className="shrink-0 border-t border-[#E5E7EB] px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {canStartReceive && (
                <button
                  type="button"
                  onClick={() => setReceiving(true)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-[#111827] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#2b2b2b] sm:min-h-0"
                >
                  Receive Materials
                </button>
              )}
              {data.justSubmitted ? (
                <>
                  {/* Same request, plain detail view — drops the submitted state. */}
                  <button
                    type="button"
                    onClick={() => router.replace(data.viewHref, { scroll: false })}
                    className={secondaryButton}
                  >
                    View Material Request
                  </button>
                  <Link href="/store/offline-inventory" className={secondaryButton}>
                    Go to Inventory Control
                  </Link>
                  <button type="button" onClick={close} className={secondaryButton}>
                    Back to Materials Requests
                  </button>
                </>
              ) : (
                <button type="button" onClick={close} className={secondaryButton}>
                  Close
                </button>
              )}
            </div>
            {canStartReceive && (
              <p className="mt-2 text-xs text-[#4B5563]">
                Use Receive Materials only when the physical materials are available in store.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
