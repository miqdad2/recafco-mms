"use client";

import { Fragment, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import {
  createGeneralInventoryRequestAction,
  searchInventoryMaterialsForRequestAction
} from "@/app/actions/general-inventory-requests";
import type { MaterialsRequestInventoryMatch } from "@/lib/backend/general-inventory-requests/service";
import { useLargeFormModal } from "@/components/ui/large-form-modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { GENERAL_INVENTORY_UNIT_OPTIONS, CUSTOM_UNIT_VALUE } from "@/components/store/general-inventory-units";
import { stockStatusLabel, stockStatusTone } from "@/components/store/offline-inventory-types";
import { cn } from "@/lib/utils";

// Materials Request Type Selection Flow Unit 10G.58, General Inventory
// Request Unit, Price, and Conversion Polish Unit 10G.58A — the "General
// Inventory / Stock Request" form. A single plain form (no Job Card step,
// no multi-step wizard needed), submitted the same plain-FormData-POST-and-
// redirect way createPartsRequestAction already works, so both flows
// behave consistently. Never touches parts_requests, work_orders, or any
// Job Card table.
//
// General Materials Request Table Layout and Inventory Search Fix — material
// items are entered in one compact table again (one row per item, one
// blank row by default), not a card per item. Each row is explicitly one of
// two things: Existing Inventory (picked from the autocomplete; its Request
// Unit and current balance come from Offline Inventory) or New Material
// (typed name, not linked to inventory, unit chosen by the user with no PCS
// default). Everything that is not a plain cell opens as a full-width row
// directly under the item: the suggestion list, the existing/new status
// line, and — when "Purchased in a different unit" is ticked — a mini-row
// with Purchase Unit, Conversion Quantity and the Purchase Estimate, always
// read as "1 Purchase Unit = N Request Unit". The quantity is always
// entered in the Request Unit. Submitting only saves the request — it never
// creates stock, a movement, or a new inventory material. The Estimated
// Unit Price / Estimated Total columns exist only when the server says the
// viewer may see costs (canViewCosts prop); the server drops a posted price
// otherwise.

const MAX_ITEM_ROWS = 8;
const SEARCH_DEBOUNCE_MS = 300;

const inp = "focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm";
const cell = "border border-[#E5E7EB] p-0.5 align-top";
const cellInput = "w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50";
const cellSelect = "w-full rounded bg-transparent px-1.5 py-1.5 text-sm outline-none focus:bg-red-50";
const subInput = "mt-1 w-full rounded border border-[#E5E7EB] bg-white px-2 py-1 text-xs outline-none focus:bg-red-50";
const miniLabel = "block text-[10px] font-black uppercase tracking-wide text-[#4B5563]";
const miniInput = "focus-ring mt-1 w-44 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-sm";

function unitOptionList() {
  return [...GENERAL_INVENTORY_UNIT_OPTIONS, CUSTOM_UNIT_VALUE];
}

function unitLabel(value: string) {
  return value === CUSTOM_UNIT_VALUE ? "OTHER / CUSTOM" : value;
}

// Per-row local UI state. The values submitted are still read from the
// form's own inputs (name={..._${slot}}) at submit time, same as every
// other indexed-row form in this app; this mirror drives what's visible
// (existing/new badge, suggestions, custom-unit inputs, the purchase-unit
// section, live estimates).
type RowUi = {
  materialName: string;
  // Set only while the row is linked to a selected inventory material;
  // typing in the name again clears it (the row becomes a new material).
  existing: MaterialsRequestInventoryMatch | null;
  suggestions: MaterialsRequestInventoryMatch[];
  showSuggestions: boolean;
  loading: boolean;
  searched: boolean;
  unit: string;
  customUnit: string;
  quantity: string;
  unitPrice: string;
  conversionEnabled: boolean;
  purchaseUnit: string;
  customPurchaseUnit: string;
  conversionQuantity: string;
};

function emptyRow(): RowUi {
  return {
    materialName: "",
    existing: null,
    suggestions: [],
    showSuggestions: false,
    loading: false,
    searched: false,
    // Blank on purpose — no unit is pre-selected, so a row can never end
    // up in PCS just because the dropdown was not touched.
    unit: "",
    customUnit: "",
    quantity: "",
    unitPrice: "",
    conversionEnabled: false,
    purchaseUnit: "",
    customPurchaseUnit: "",
    conversionQuantity: ""
  };
}

function fmt3(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "0.000";
}

// Quantities: up to 3 decimals, no trailing zeros (0.25, 2, 90).
function fmtQty(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toFixed(3))) : "0";
}

function requestUnitOf(row: RowUi): string {
  if (row.existing) return row.existing.unit;
  return row.unit === CUSTOM_UNIT_VALUE ? row.customUnit.trim() : row.unit;
}

function purchaseUnitOf(row: RowUi): string {
  return row.purchaseUnit === CUSTOM_UNIT_VALUE ? row.customPurchaseUnit.trim() : row.purchaseUnit;
}

export function GeneralInventoryRequestForm({
  requesterName,
  requestedDateLabel,
  canViewCosts,
  modalMode = false,
  errorMessage
}: {
  requesterName: string | null;
  requestedDateLabel: string;
  canViewCosts: boolean;
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
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const searchSeq = useRef<Record<number, number>>({});
  const blurTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  // Material, Description, Quantity, Unit, Supplier, Remarks, Action (+ two cost columns).
  const colCount = canViewCosts ? 9 : 7;

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

  // Same debounce + stale-response guard as the New Job Card wizard's
  // Required Materials search.
  function handleMaterialNameChange(slot: number, value: string) {
    // Editing the name always unlinks the row: it is a New Material Request
    // again until a suggestion is selected.
    updateRow(slot, { materialName: value, existing: null, showSuggestions: true });

    if (searchTimers.current[slot]) clearTimeout(searchTimers.current[slot]);
    const seq = (searchSeq.current[slot] ?? 0) + 1;
    searchSeq.current[slot] = seq;

    const trimmed = value.trim();
    if (trimmed.length < 2) {
      updateRow(slot, { suggestions: [], loading: false, searched: false });
      return;
    }

    updateRow(slot, { loading: true });
    searchTimers.current[slot] = setTimeout(async () => {
      try {
        const results = await searchInventoryMaterialsForRequestAction(trimmed);
        if (searchSeq.current[slot] !== seq) return;
        updateRow(slot, { suggestions: results, loading: false, searched: true });
      } catch {
        if (searchSeq.current[slot] !== seq) return;
        updateRow(slot, { suggestions: [], loading: false, searched: true });
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleSelectSuggestion(slot: number, match: MaterialsRequestInventoryMatch) {
    if (searchTimers.current[slot]) clearTimeout(searchTimers.current[slot]);
    searchSeq.current[slot] = (searchSeq.current[slot] ?? 0) + 1;
    updateRow(slot, {
      materialName: match.display_name,
      existing: match,
      // The Request / Issue Unit now comes from the material itself; any
      // unit picked while the row was still "new" is discarded.
      unit: "",
      customUnit: "",
      suggestions: [],
      showSuggestions: false,
      loading: false,
      searched: false
    });
  }

  function handleNameBlur(slot: number) {
    // Delayed so a click on a suggestion registers before the list closes.
    blurTimers.current[slot] = setTimeout(() => updateRow(slot, { showSuggestions: false }), 150);
  }

  function handleNameFocus(slot: number) {
    if (blurTimers.current[slot]) clearTimeout(blurTimers.current[slot]);
    updateRow(slot, { showSuggestions: true });
  }

  // Live preview only — the saved figures are derived again server-side.
  function computePreview(row: RowUi) {
    const qty = Number(row.quantity) || 0;
    const requestUnit = requestUnitOf(row);
    const purchaseUnit = purchaseUnitOf(row);
    const conversion = row.conversionEnabled ? Number(row.conversionQuantity) || 0 : 0;
    // 1 Purchase Unit = `conversion` Request / Issue Unit, so the purchase
    // estimate is the requested quantity divided by it.
    const purchaseQty = row.conversionEnabled && conversion > 0 ? qty / conversion : null;
    // Unit price is per Purchase Unit when a purchase conversion is used,
    // per Request / Issue Unit otherwise.
    const price = row.unitPrice ? Number(row.unitPrice) : null;
    const total =
      price === null ? null : row.conversionEnabled ? (purchaseQty !== null ? purchaseQty * price : null) : qty * price;
    const priceUnit = row.conversionEnabled ? purchaseUnit : requestUnit;
    return { qty, requestUnit, purchaseUnit, conversion, purchaseQty, total, priceUnit };
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};

    const form = formRef.current;
    if (form && !String(new FormData(form).get("purpose") ?? "").trim()) {
      errs.purpose = "Purpose / reason is required.";
    }

    let hasItem = false;
    for (const slot of rowSlots) {
      const row = rows[slot] ?? emptyRow();
      if (!row.materialName.trim()) continue;
      hasItem = true;
      const qty = Number(row.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        errs.items = "Quantity must be greater than 0 for every item.";
      }
      if (canViewCosts && row.unitPrice.trim() && Number(row.unitPrice) < 0) {
        errs.items = "Unit price must be 0 or greater.";
      }
      const requestUnit = requestUnitOf(row);
      if (!requestUnit) {
        errs.items =
          row.unit === CUSTOM_UNIT_VALUE
            ? "Enter the custom unit, or choose one from the list."
            : "Select the request unit for every item.";
      }
      if (row.conversionEnabled) {
        const purchaseUnit = purchaseUnitOf(row);
        if (!purchaseUnit) {
          errs.items = "Select the purchase unit when the item is purchased in a different unit.";
        } else if (requestUnit && purchaseUnit.toLowerCase() === requestUnit.toLowerCase()) {
          errs.items =
            "Purchase unit must be different from the request unit. Turn off “Purchased in a different unit” if they are the same.";
        }
        if (!(Number(row.conversionQuantity) > 0)) {
          errs.items = "Conversion quantity must be greater than 0 when the item is purchased in a different unit.";
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
    <div className={modalMode ? "" : "mx-auto max-w-5xl"}>
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
          <div className="mb-4 border-b border-[#E5E7EB] pb-4">
            <h2 className="text-base font-bold text-[#111827]">Material items</h2>
            <p className="mt-0.5 text-xs text-[#4B5563]">
              Type a material name and pick it from the list if it is already in inventory. If it is not in the list, keep
              the name you typed — it is saved as a new material. Submitting a request does not change any stock balance.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className={cn("w-full border-collapse text-sm", canViewCosts ? "min-w-[1080px]" : "min-w-[860px]")}>
              <thead>
                <tr className="bg-[#F3F4F6] text-left text-[10px] font-black uppercase tracking-wide text-[#4B5563]">
                  <th className="border border-[#E5E7EB] px-3 py-2">Material Name</th>
                  <th className="border border-[#E5E7EB] px-3 py-2">Description / Specification</th>
                  <th className="w-28 border border-[#E5E7EB] px-3 py-2">Requested Quantity</th>
                  <th className="w-36 border border-[#E5E7EB] px-3 py-2">Request Unit</th>
                  {canViewCosts && <th className="w-28 border border-[#E5E7EB] px-3 py-2">Estimated Unit Price</th>}
                  {canViewCosts && <th className="w-28 border border-[#E5E7EB] px-3 py-2">Estimated Total</th>}
                  <th className="border border-[#E5E7EB] px-3 py-2">Supplier</th>
                  <th className="border border-[#E5E7EB] px-3 py-2">Remarks / Note</th>
                  <th className="w-16 border border-[#E5E7EB] px-2 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {rowSlots.map((slot, position) => {
                  const row = rows[slot] ?? emptyRow();
                  const preview = computePreview(row);
                  const hasName = row.materialName.trim().length > 0;
                  const listOpen = row.showSuggestions && !row.existing && row.materialName.trim().length >= 2;
                  const requestUnitText = preview.requestUnit || "request unit";
                  const purchaseUnitText = preview.purchaseUnit || "purchase unit";
                  const itemLabel = `item ${position + 1}`;
                  return (
                    <Fragment key={slot}>
                      <tr>
                        <td className={cell}>
                          <input type="hidden" name={`material_key_${slot}`} value={row.existing?.key ?? ""} />
                          <input
                            name={`material_name_${slot}`}
                            value={row.materialName}
                            onChange={(e) => handleMaterialNameChange(slot, e.target.value)}
                            onFocus={() => handleNameFocus(slot)}
                            onBlur={() => handleNameBlur(slot)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape" && listOpen) {
                                e.stopPropagation();
                                updateRow(slot, { showSuggestions: false });
                              }
                            }}
                            autoComplete="off"
                            role="combobox"
                            aria-expanded={listOpen}
                            aria-controls={`gir-suggestions-${slot}`}
                            aria-autocomplete="list"
                            aria-label={`Material name, ${itemLabel}`}
                            className={cellInput}
                            placeholder="Name, part no. or SS Rec. Code"
                          />
                        </td>
                        <td className={cell}>
                          <input
                            name={`description_${slot}`}
                            aria-label={`Description / specification, ${itemLabel}`}
                            className={cellInput}
                            placeholder="brand, size, specification"
                          />
                        </td>
                        <td className={cell}>
                          <input
                            name={`quantity_${slot}`}
                            type="number"
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            placeholder="e.g. 5"
                            value={row.quantity}
                            onChange={(e) => updateRow(slot, { quantity: e.target.value })}
                            aria-label={`Requested quantity, ${itemLabel}`}
                            className={cellInput}
                          />
                        </td>
                        <td className={cell}>
                          {row.existing ? (
                            <>
                              {/* Auto-filled: an existing material is requested in its own stock unit. */}
                              <input type="hidden" name={`unit_${slot}`} value={row.existing.unit} />
                              <p className="px-2.5 py-1.5 text-sm font-semibold text-[#111827]">{row.existing.unit}</p>
                            </>
                          ) : (
                            <>
                              <select
                                name={`unit_${slot}`}
                                value={row.unit}
                                onChange={(e) => updateRow(slot, { unit: e.target.value })}
                                aria-label={`Request unit, ${itemLabel}`}
                                className={cellSelect}
                              >
                                <option value="" disabled>
                                  Select unit
                                </option>
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
                                  aria-label={`Custom request unit, ${itemLabel}`}
                                  className={subInput}
                                />
                              )}
                            </>
                          )}
                        </td>
                        {canViewCosts && (
                          <td className={cell}>
                            <input
                              name={`unit_price_${slot}`}
                              type="number"
                              step="0.001"
                              min="0"
                              inputMode="decimal"
                              placeholder="optional"
                              value={row.unitPrice}
                              onChange={(e) => updateRow(slot, { unitPrice: e.target.value })}
                              aria-label={`Estimated unit price, ${itemLabel}`}
                              className={cellInput}
                            />
                            {/* Per Purchase Unit when a purchase conversion is used, per Request Unit otherwise. */}
                            <p className="px-2.5 pb-1 text-[11px] text-[#4B5563]">
                              per {preview.priceUnit || (row.conversionEnabled ? "purchase unit" : "request unit")}
                            </p>
                          </td>
                        )}
                        {canViewCosts && (
                          <td className="border border-[#E5E7EB] px-2.5 py-1.5 text-right align-top text-xs font-semibold tabular-nums text-[#4B5563]">
                            {preview.total !== null ? fmt3(preview.total) : "—"}
                          </td>
                        )}
                        <td className={cell}>
                          <input
                            name={`supplier_${slot}`}
                            aria-label={`Supplier, ${itemLabel}`}
                            className={cellInput}
                            placeholder="optional"
                          />
                        </td>
                        <td className={cell}>
                          <input
                            name={`remarks_${slot}`}
                            aria-label={`Remarks / note, ${itemLabel}`}
                            className={cellInput}
                            placeholder="optional"
                          />
                        </td>
                        <td className="border border-[#E5E7EB] p-0.5 text-center align-top">
                          <button
                            type="button"
                            onClick={() => removeRow(slot)}
                            disabled={rowSlots.length <= 1}
                            aria-label={`Remove ${itemLabel}`}
                            title={rowSlots.length <= 1 ? "At least one row is required" : "Remove row"}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#DC2626] hover:bg-red-50 disabled:cursor-not-allowed disabled:text-[#D1D5DB] disabled:hover:bg-transparent"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>

                      {/* Suggestions open as a row directly under the item, so the
                          table's horizontal scroll never clips them. */}
                      {listOpen && (
                        <tr>
                          <td colSpan={colCount} className="border border-[#E5E7EB] bg-white p-0">
                            <div id={`gir-suggestions-${slot}`} role="listbox" className="max-h-56 overflow-y-auto">
                              {row.loading && <p className="px-3 py-2 text-xs text-[#4B5563]">Searching inventory…</p>}
                              {!row.loading &&
                                row.suggestions.map((match) => (
                                  <button
                                    key={`${match.key}|${match.unit}`}
                                    type="button"
                                    role="option"
                                    aria-selected={false}
                                    // onMouseDown so the selection lands before the input's blur closes the list.
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      handleSelectSuggestion(slot, match);
                                    }}
                                    className="flex min-h-[44px] w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#F3F4F6] px-3 py-1.5 text-left last:border-b-0 hover:bg-red-50 focus:bg-red-50 focus:outline-none"
                                  >
                                    <span className="text-sm font-semibold text-[#111827]">{match.display_name}</span>
                                    {(match.part_number || match.ss_rec_code) && (
                                      <span className="text-xs text-[#4B5563]">
                                        {[
                                          match.part_number ? `Part No. ${match.part_number}` : null,
                                          match.ss_rec_code ? `SS Rec. Code ${match.ss_rec_code}` : null
                                        ]
                                          .filter(Boolean)
                                          .join(" · ")}
                                      </span>
                                    )}
                                    <span className="text-xs font-semibold tabular-nums text-[#111827]">
                                      — Balance {fmtQty(match.balance)} {match.unit} —
                                    </span>
                                    <StatusBadge
                                      label={stockStatusLabel(match.stock_status)}
                                      tone={stockStatusTone(match.stock_status)}
                                    />
                                  </button>
                                ))}
                              {!row.loading && row.searched && row.suggestions.length === 0 && (
                                <p className="px-3 py-2 text-xs text-[#4B5563]">
                                  No matching inventory material. This will be saved as a new material.
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Existing / new status and the purchase-unit option, compact under the row. */}
                      {hasName && (
                        <tr>
                          <td colSpan={colCount} className="border border-[#E5E7EB] bg-[#FAFAFA] px-3 py-1.5">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[#4B5563]">
                              {row.existing ? (
                                <>
                                  <StatusBadge label="Existing Inventory" tone="green" />
                                  <span className="text-[#111827]">
                                    Balance:{" "}
                                    <span className="font-bold tabular-nums">
                                      {fmtQty(row.existing.balance)} {row.existing.unit}
                                    </span>
                                  </span>
                                  <StatusBadge
                                    label={stockStatusLabel(row.existing.stock_status)}
                                    tone={stockStatusTone(row.existing.stock_status)}
                                  />
                                </>
                              ) : (
                                <>
                                  <StatusBadge label="New Material" tone="amber" />
                                  <span>Not linked to inventory yet. Store can register it during receiving if required.</span>
                                </>
                              )}
                              <label
                                className="ml-auto flex min-h-[32px] items-center gap-2 font-semibold text-[#111827]"
                                title="Use this when the requested unit is different from how supplier sells the item. Example: request in LITER, purchase in BARREL."
                              >
                                <input
                                  type="checkbox"
                                  name={`use_conversion_${slot}`}
                                  checked={row.conversionEnabled}
                                  onChange={(e) => updateRow(slot, { conversionEnabled: e.target.checked })}
                                  className="h-4 w-4 accent-[#ED1C24]"
                                />
                                Purchased in a different unit
                              </label>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Conversion mini-row: 1 [Purchase Unit] = [Conversion Quantity] [Request Unit]. */}
                      {hasName && row.conversionEnabled && (
                        <tr>
                          <td colSpan={colCount} className="border border-[#E5E7EB] bg-gray-50 px-3 py-2">
                            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                              <label className="block">
                                <span className={miniLabel}>Purchase Unit</span>
                                <select
                                  name={`purchase_unit_${slot}`}
                                  value={row.purchaseUnit}
                                  onChange={(e) => updateRow(slot, { purchaseUnit: e.target.value })}
                                  className={miniInput}
                                >
                                  <option value="" disabled>
                                    Select purchase unit
                                  </option>
                                  {unitOptionList().map((u) => (
                                    <option key={u} value={u}>
                                      {unitLabel(u)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {row.purchaseUnit === CUSTOM_UNIT_VALUE && (
                                <label className="block">
                                  <span className={miniLabel}>Custom Purchase Unit</span>
                                  <input
                                    name={`custom_purchase_unit_${slot}`}
                                    value={row.customPurchaseUnit}
                                    onChange={(e) => updateRow(slot, { customPurchaseUnit: e.target.value })}
                                    placeholder="e.g. BARREL"
                                    className={miniInput}
                                  />
                                </label>
                              )}
                              <label className="block">
                                <span className={miniLabel}>
                                  Conversion Quantity — {requestUnitText} in 1 {purchaseUnitText}
                                </span>
                                <input
                                  name={`conversion_quantity_${slot}`}
                                  type="number"
                                  step="0.0001"
                                  min="0"
                                  inputMode="decimal"
                                  placeholder="e.g. 200"
                                  value={row.conversionQuantity}
                                  onChange={(e) => updateRow(slot, { conversionQuantity: e.target.value })}
                                  className={miniInput}
                                />
                              </label>
                              <div>
                                <span className={miniLabel}>Purchase Estimate</span>
                                <p className="mt-1 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-sm font-bold tabular-nums text-[#111827]">
                                  {preview.purchaseQty !== null && preview.qty > 0 ? fmtQty(preview.purchaseQty) : "—"}{" "}
                                  {preview.purchaseUnit}
                                </p>
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-[#111827]">
                              <span className="font-bold">
                                1 {purchaseUnitText} = {preview.conversion > 0 ? fmtQty(preview.conversion) : "?"} {requestUnitText}
                              </span>
                              {preview.qty > 0 && (
                                <span className="ml-2 text-[#4B5563]">
                                  Requested: {fmtQty(preview.qty)} {requestUnitText}
                                </span>
                              )}
                            </p>
                            <p className="mt-0.5 text-xs text-[#9CA3AF]">
                              Use this when the requested unit is different from how supplier sells the item. Example: request
                              in LITER, purchase in BARREL.
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {errors.items && <p className="mt-2 text-xs text-[#DC2626]">{errors.items}</p>}

          <div className="mt-3 space-y-1 text-xs text-[#9CA3AF]">
            <p>Request Unit: the unit requested for store/general inventory.</p>
            {canViewCosts && (
              <p>
                Estimated Total = quantity × Estimated Unit Price. When an item is purchased in a different unit, the price is
                per Purchase Unit and the total uses the Purchase Estimate.
              </p>
            )}
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
