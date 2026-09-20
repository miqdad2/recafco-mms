"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { receiveGeneralInventoryRequestAction } from "@/app/actions/general-inventory-requests";

export type GeneralInventoryRequestQuickViewItem = {
  id: string;
  materialName: string;
  description: string | null;
  quantityRequested: number;
  unit: string;
  unitPrice: number | null;
  totalPrice: number | null;
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
};

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
        qty: String(item.quantityRequested),
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

  const totalRequestedValue = data.items.reduce((sum, i) => sum + (i.totalPrice ?? 0), 0);

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
                        <th className="px-3 py-2 text-right">Quantity</th>
                        <th className="px-3 py-2 text-left">Purchase Unit</th>
                        <th className="px-3 py-2 text-right">Unit Price</th>
                        <th className="px-3 py-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {data.items.map((item) => {
                        const hasConversion = Boolean(item.inventoryUnit && item.conversionQuantity);
                        return (
                          <tr key={item.id}>
                            <td className="px-3 py-2 font-semibold text-[#111827]">
                              {item.materialName}
                              {item.description && <p className="text-xs font-normal text-[#9CA3AF]">{item.description}</p>}
                              {hasConversion && (
                                <p className="mt-0.5 text-xs font-normal text-[#4B5563]">
                                  → {item.inventoryQuantity?.toFixed(3)} {item.inventoryUnit} (Inventory Unit) · Unit Cost{" "}
                                  {item.unitCost !== null ? item.unitCost.toFixed(3) : "—"} per {item.inventoryUnit}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-[#111827]">{item.quantityRequested}</td>
                            <td className="px-3 py-2 text-[#4B5563]">{item.unit}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-[#4B5563]">
                              {item.unitPrice !== null ? item.unitPrice.toFixed(3) : "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#111827]">
                              {item.totalPrice !== null ? item.totalPrice.toFixed(3) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50">
                        <td className="px-3 py-2 text-right text-xs font-bold text-[#4B5563]" colSpan={4}>
                          Total
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-bold text-[#111827]">
                          {totalRequestedValue.toFixed(3)}
                        </td>
                      </tr>
                    </tfoot>
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
                          <th className="px-3 py-2 text-right">Purchase Qty</th>
                          <th className="w-28 px-3 py-2 text-right">Received Qty</th>
                          <th className="w-28 px-3 py-2 text-right">Unit Price</th>
                          <th className="px-3 py-2 text-right">Inventory Qty / Unit Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E7EB]">
                        {data.items.map((item, i) => {
                          const hasConversion = Boolean(item.inventoryUnit && item.conversionQuantity);
                          const draft = receiveDraft(item);
                          const qty = Number(draft.qty) || 0;
                          const price = draft.price ? Number(draft.price) : null;
                          const conversion = hasConversion ? Number(item.conversionQuantity) : 1;
                          const invQty = hasConversion ? qty * conversion : qty;
                          const invUnit = hasConversion ? item.inventoryUnit : item.unit;
                          const unitCost = price !== null ? (hasConversion ? price / conversion : price) : null;
                          return (
                            <tr key={item.id}>
                              <input type="hidden" name={`item_id_${i}`} value={item.id} />
                              <td className="px-3 py-2 font-semibold text-[#111827]">{item.materialName}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-[#4B5563]">
                                {item.quantityRequested} {item.unit}
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  name={`received_quantity_${i}`}
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  value={draft.qty}
                                  onChange={(e) => updateReceiveDraft(item, { qty: e.target.value })}
                                  className="focus-ring w-full rounded border border-[#E5E7EB] px-2 py-1 text-right text-sm"
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  name={`received_unit_price_${i}`}
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  value={draft.price}
                                  onChange={(e) => updateReceiveDraft(item, { price: e.target.value })}
                                  className="focus-ring w-full rounded border border-[#E5E7EB] px-2 py-1 text-right text-sm"
                                />
                              </td>
                              <td className="px-3 py-2 text-right text-xs tabular-nums text-[#4B5563]">
                                {invQty.toFixed(3)} {invUnit}
                                {unitCost !== null && <p>{unitCost.toFixed(3)} / {invUnit}</p>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-[#9CA3AF]">
                    All items are received together and added into inventory. Received quantity defaults to the requested
                    quantity — adjust actual unit price if needed. Inventory Qty / Unit Cost updates live as you type.
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

          <div className="flex shrink-0 items-center gap-2 border-t border-[#E5E7EB] px-5 py-4">
            {data.canReceive && data.status === "Pending" && !receiving && (
              <button
                type="button"
                onClick={() => setReceiving(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#111827] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#2b2b2b]"
              >
                Receive Materials
              </button>
            )}
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
