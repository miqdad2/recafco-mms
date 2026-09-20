"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { createGeneralInventoryRequestAction } from "@/app/actions/general-inventory-requests";
import { useLargeFormModal } from "@/components/ui/large-form-modal";
import { GENERAL_INVENTORY_UNIT_OPTIONS, CUSTOM_UNIT_VALUE, DEFAULT_UNIT } from "@/components/store/general-inventory-units";

// Materials Request Type Selection Flow Unit 10G.58, General Inventory
// Request Unit, Price, and Conversion Polish Unit 10G.58A — the "General
// Inventory / Stock Request" form. A single plain form (no Job Card step,
// no multi-step wizard needed), submitted the same plain-FormData-POST-and-
// redirect way createPartsRequestAction already works, so both flows
// behave consistently. Never touches parts_requests, work_orders, or any
// Job Card table.

const MAX_ITEM_ROWS = 8;

const inp = "focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm";
const selectCls = "focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm";
const cellSelectCls = "w-full rounded bg-transparent px-1.5 py-1.5 text-sm outline-none focus:bg-red-50";

function unitOptionList() {
  return [...GENERAL_INVENTORY_UNIT_OPTIONS, CUSTOM_UNIT_VALUE];
}

function unitLabel(value: string) {
  return value === CUSTOM_UNIT_VALUE ? "OTHER / CUSTOM" : value;
}

// Per-row local UI state only — the actual values submitted are read from
// the form's own inputs (name={..._${slot}}) at submit time, same as every
// other indexed-row form in this app. This mirror just drives what's
// visible (custom-unit inputs, the conversion section, live totals).
type RowUi = {
  unit: string;
  customUnit: string;
  quantity: string;
  unitPrice: string;
  conversionEnabled: boolean;
  inventoryUnit: string;
  customInventoryUnit: string;
  conversionQuantity: string;
};

function emptyRow(): RowUi {
  return {
    unit: DEFAULT_UNIT,
    customUnit: "",
    quantity: "",
    unitPrice: "",
    conversionEnabled: false,
    inventoryUnit: DEFAULT_UNIT,
    customInventoryUnit: "",
    conversionQuantity: ""
  };
}

function fmt3(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "0.000";
}

export function GeneralInventoryRequestForm({
  requesterName,
  requestedDateLabel,
  modalMode = false,
  errorMessage
}: {
  requesterName: string | null;
  requestedDateLabel: string;
  modalMode?: boolean;
  errorMessage?: string | null;
}) {
  const modal = useLargeFormModal();
  const formRef = useRef<HTMLFormElement>(null);
  // Task 1: only one default row (slot 0); Add Row appends the next unused
  // slot, Remove drops one — real removal (not just hiding a fixed count of
  // trailing rows), since a row can now be removed from the middle.
  const [rowSlots, setRowSlots] = useState<number[]>([0]);
  const [rows, setRows] = useState<Record<number, RowUi>>({ 0: emptyRow() });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function addRow() {
    if (rowSlots.length >= MAX_ITEM_ROWS) return;
    const nextSlot = (rowSlots.length ? Math.max(...rowSlots) : -1) + 1;
    setRowSlots((prev) => [...prev, nextSlot]);
    setRows((prev) => ({ ...prev, [nextSlot]: emptyRow() }));
  }

  function removeRow(slot: number) {
    // Task 1: never remove the last remaining row.
    if (rowSlots.length <= 1) return;
    setRowSlots((prev) => prev.filter((s) => s !== slot));
  }

  function updateRow(slot: number, patch: Partial<RowUi>) {
    setRows((prev) => ({ ...prev, [slot]: { ...(prev[slot] ?? emptyRow()), ...patch } }));
  }

  // Task 5/6 — live preview only (final numbers are recalculated
  // server-side by the DB's own generated columns on save, same as Total).
  function computePreview(row: RowUi) {
    const qty = Number(row.quantity) || 0;
    const price = row.unitPrice ? Number(row.unitPrice) : null;
    const total = price !== null ? qty * price : null;
    const conversion = row.conversionEnabled ? Number(row.conversionQuantity) || 0 : 0;
    const inventoryQty = row.conversionEnabled && conversion > 0 ? qty * conversion : qty;
    const unitCost =
      price !== null ? (row.conversionEnabled && conversion > 0 ? price / conversion : price) : null;
    const inventoryUnitLabel = row.conversionEnabled
      ? row.inventoryUnit === CUSTOM_UNIT_VALUE
        ? row.customInventoryUnit || "—"
        : row.inventoryUnit
      : row.unit === CUSTOM_UNIT_VALUE
        ? row.customUnit || "—"
        : row.unit;
    return { total, inventoryQty, unitCost, inventoryUnitLabel };
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const form = formRef.current;
    if (!form) return true;
    const fd = new FormData(form);

    if (!String(fd.get("purpose") ?? "").trim()) {
      errs.purpose = "Purpose / reason is required.";
    }

    let hasItem = false;
    for (const slot of rowSlots) {
      const name = String(fd.get(`material_name_${slot}`) ?? "").trim();
      if (!name) continue;
      hasItem = true;
      const qty = Number(fd.get(`quantity_${slot}`));
      if (!Number.isFinite(qty) || qty <= 0) {
        errs.items = "Quantity must be greater than 0 for every item.";
      }
      const priceRaw = String(fd.get(`unit_price_${slot}`) ?? "").trim();
      if (priceRaw && Number(priceRaw) < 0) {
        errs.items = "Unit price must be 0 or greater.";
      }
      const row = rows[slot];
      if (row?.unit === CUSTOM_UNIT_VALUE && !row.customUnit.trim()) {
        errs.items = "Enter the custom unit, or choose one from the list.";
      }
      if (row?.conversionEnabled) {
        const invUnit = row.inventoryUnit === CUSTOM_UNIT_VALUE ? row.customInventoryUnit : row.inventoryUnit;
        if (!invUnit?.trim()) {
          errs.items = "Inventory unit is required when conversion is enabled.";
        }
        if (!(Number(row.conversionQuantity) > 0)) {
          errs.items = "Conversion quantity must be greater than 0 when conversion is enabled.";
        }
      }
    }
    if (!hasItem) errs.items = "At least one item is required.";

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!validate()) e.preventDefault();
  }

  return (
    <div className={modalMode ? "" : "mx-auto max-w-3xl"}>
      {errorMessage && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <form ref={formRef} action={createGeneralInventoryRequestAction} onSubmit={handleSubmit}>
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <div className="mb-5 border-b border-[#E5E7EB] pb-4">
            <h2 className="text-base font-bold text-[#111827]">Request details</h2>
            <p className="mt-0.5 text-xs text-[#4B5563]">
              General Inventory / Stock Request — no Job Card required.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="block text-sm font-semibold text-[#111827]">Requested by</span>
              <p className="mt-1 text-sm text-[#4B5563]">{requesterName ?? "Current user"}</p>
            </div>
            <div>
              <span className="block text-sm font-semibold text-[#111827]">Request date</span>
              <p className="mt-1 text-sm text-[#4B5563]">{requestedDateLabel}</p>
            </div>
            <label className="block">
              <span className="block text-sm font-semibold text-[#111827]">
                Department <span className="text-xs font-normal text-[#9CA3AF]">optional</span>
              </span>
              <input name="department" className={inp} placeholder="e.g. Maintenance" />
            </label>
            <label className="block">
              <span className="block text-sm font-semibold text-[#111827]">
                Location <span className="text-xs font-normal text-[#9CA3AF]">optional</span>
              </span>
              <input name="location" className={inp} placeholder="e.g. Main Store" />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="block text-sm font-semibold text-[#111827]">
              Purpose / reason <span className="ml-0.5 text-[#ED1C24]">*</span>
            </span>
            <input name="purpose" className={inp} placeholder="e.g. Stock replenishment" />
            {errors.purpose && <p className="mt-1 text-xs text-[#DC2626]">{errors.purpose}</p>}
          </label>

          <label className="mt-4 block">
            <span className="block text-sm font-semibold text-[#111827]">
              Remarks <span className="text-xs font-normal text-[#9CA3AF]">optional</span>
            </span>
            <input name="remarks" className={inp} placeholder="General notes for this request…" />
          </label>
        </div>

        <div className="mt-4 rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <div className="mb-5 border-b border-[#E5E7EB] pb-4">
            <h2 className="text-base font-bold text-[#111827]">Material items</h2>
            <p className="mt-0.5 text-xs text-[#4B5563]">List the materials needed for stock/general inventory.</p>
          </div>

          <div className="space-y-4">
            {rowSlots.map((slot, position) => {
              const row = rows[slot] ?? emptyRow();
              const preview = computePreview(row);
              return (
                <div key={slot} className="rounded-md border border-[#E5E7EB] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wide text-[#9CA3AF]">
                      Item {position + 1}
                    </span>
                    {rowSlots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(slot)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#DC2626] hover:bg-red-50"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse text-sm">
                      <thead>
                        <tr className="bg-[#F3F4F6] text-left text-[10px] font-black uppercase tracking-wide text-[#4B5563]">
                          <th className="border border-[#E5E7EB] px-3 py-2">Material Name</th>
                          <th className="border border-[#E5E7EB] px-3 py-2">Description</th>
                          <th className="w-24 border border-[#E5E7EB] px-3 py-2">Quantity</th>
                          <th className="w-28 border border-[#E5E7EB] px-3 py-2">Purchase Unit</th>
                          <th className="w-24 border border-[#E5E7EB] px-3 py-2">Unit Price</th>
                          <th className="w-24 border border-[#E5E7EB] px-3 py-2">Total</th>
                          <th className="border border-[#E5E7EB] px-3 py-2">Supplier</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="border border-[#E5E7EB] p-0.5">
                            <input
                              name={`material_name_${slot}`}
                              className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                              placeholder="e.g. oil filter"
                            />
                          </td>
                          <td className="border border-[#E5E7EB] p-0.5">
                            <input
                              name={`description_${slot}`}
                              className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                              placeholder="brand, size, specification"
                            />
                          </td>
                          <td className="border border-[#E5E7EB] p-0.5">
                            <input
                              name={`quantity_${slot}`}
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="e.g. 5"
                              value={row.quantity}
                              onChange={(e) => updateRow(slot, { quantity: e.target.value })}
                              className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                            />
                          </td>
                          <td className="border border-[#E5E7EB] p-0.5">
                            <select
                              name={`unit_${slot}`}
                              value={row.unit}
                              onChange={(e) => updateRow(slot, { unit: e.target.value })}
                              className={cellSelectCls}
                            >
                              {unitOptionList().map((u) => (
                                <option key={u} value={u}>
                                  {unitLabel(u)}
                                </option>
                              ))}
                            </select>
                            {row.unit === CUSTOM_UNIT_VALUE && (
                              <input
                                name={`custom_unit_${slot}`}
                                value={row.customUnit}
                                onChange={(e) => updateRow(slot, { customUnit: e.target.value })}
                                placeholder="e.g. Bundle"
                                className="mt-1 w-full rounded border border-[#E5E7EB] bg-white px-2 py-1 text-xs outline-none focus:bg-red-50"
                              />
                            )}
                          </td>
                          <td className="border border-[#E5E7EB] p-0.5">
                            <input
                              name={`unit_price_${slot}`}
                              type="number"
                              step="0.001"
                              min="0"
                              placeholder="e.g. 2.500"
                              value={row.unitPrice}
                              onChange={(e) => updateRow(slot, { unitPrice: e.target.value })}
                              className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                            />
                          </td>
                          <td className="border border-[#E5E7EB] px-2.5 py-1.5 text-right text-xs font-semibold text-[#4B5563]">
                            {preview.total !== null ? fmt3(preview.total) : "—"}
                          </td>
                          <td className="border border-[#E5E7EB] p-0.5">
                            <input
                              name={`supplier_${slot}`}
                              className="w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50"
                              placeholder="optional supplier name"
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <p className="mt-2 text-xs text-[#4B5563]">
                    Unit Price means price for one {row.unit === CUSTOM_UNIT_VALUE ? (row.customUnit || "purchase unit") : row.unit}.
                  </p>

                  {/* Task 5/6/7 — optional inventory conversion, per row. */}
                  <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#111827]">
                    <input
                      type="checkbox"
                      name={`use_conversion_${slot}`}
                      checked={row.conversionEnabled}
                      onChange={(e) => updateRow(slot, { conversionEnabled: e.target.checked })}
                      className="h-4 w-4 accent-[#ED1C24]"
                    />
                    Use different inventory stock unit
                  </label>
                  <p className="mt-0.5 text-xs text-[#9CA3AF]">
                    Use conversion when the item is purchased in one unit but stored or issued in another unit.
                    Example: 1 BARREL = 200 LITER.
                  </p>

                  {row.conversionEnabled && (
                    <div className="mt-2 grid gap-3 rounded-md bg-gray-50 p-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="block text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                          Inventory Unit
                        </span>
                        <select
                          name={`inventory_unit_${slot}`}
                          value={row.inventoryUnit}
                          onChange={(e) => updateRow(slot, { inventoryUnit: e.target.value })}
                          className={selectCls}
                        >
                          {unitOptionList().map((u) => (
                            <option key={u} value={u}>
                              {unitLabel(u)}
                            </option>
                          ))}
                        </select>
                        {row.inventoryUnit === CUSTOM_UNIT_VALUE && (
                          <input
                            name={`custom_inventory_unit_${slot}`}
                            value={row.customInventoryUnit}
                            onChange={(e) => updateRow(slot, { customInventoryUnit: e.target.value })}
                            placeholder="e.g. LITER"
                            className="mt-1 w-full rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:bg-red-50"
                          />
                        )}
                      </label>
                      <label className="block">
                        <span className="block text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                          Conversion (per 1 {row.unit === CUSTOM_UNIT_VALUE ? row.customUnit || "unit" : row.unit})
                        </span>
                        <input
                          name={`conversion_quantity_${slot}`}
                          type="number"
                          step="0.0001"
                          min="0"
                          placeholder="e.g. 200"
                          value={row.conversionQuantity}
                          onChange={(e) => updateRow(slot, { conversionQuantity: e.target.value })}
                          className={selectCls}
                        />
                      </label>
                      <div className="sm:col-span-2 rounded-md border border-[#E5E7EB] bg-white p-2.5 text-xs text-[#111827]">
                        <p>
                          Inventory Quantity ={" "}
                          <span className="font-bold">
                            {fmt3(preview.inventoryQty)} {preview.inventoryUnitLabel}
                          </span>
                        </p>
                        <p className="mt-0.5">
                          Unit Cost ={" "}
                          <span className="font-bold">
                            {preview.unitCost !== null ? fmt3(preview.unitCost) : "—"} per {preview.inventoryUnitLabel}
                          </span>
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {errors.items && <p className="mt-2 text-xs text-[#DC2626]">{errors.items}</p>}

          <div className="mt-3 space-y-1 text-xs text-[#9CA3AF]">
            <p>Total = Quantity × Unit Price, calculated automatically.</p>
            <p>Unit Price means price for one selected purchase unit. Example: if Unit is BARREL, Unit Price is price for one barrel.</p>
            <p>For items purchased in one unit but issued in another, use conversion. Example: 1 BARREL = 200 LITER.</p>
          </div>

          {rowSlots.length < MAX_ITEM_ROWS && (
            <button
              type="button"
              onClick={addRow}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#4B5563] hover:bg-[#F3F4F6]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Row
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          {modalMode ? (
            <button
              type="button"
              onClick={() => modal?.requestClose()}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#ED1C24] shadow-sm transition hover:bg-red-50"
            >
              Cancel
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            className="focus-ring inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#c8181e]"
          >
            Submit Materials Request
          </button>
        </div>
      </form>
    </div>
  );
}
