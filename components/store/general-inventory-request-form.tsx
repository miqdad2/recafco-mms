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
import { GENERAL_INVENTORY_UNIT_OPTIONS, CUSTOM_UNIT_VALUE, DEFAULT_UNIT } from "@/components/store/general-inventory-units";
import { stockStatusLabel, stockStatusTone } from "@/components/store/offline-inventory-types";
import { cn } from "@/lib/utils";
import {
  basisUnit,
  computeRequestLine,
  formatKwd,
  isLargeEstimatedTotal,
  largeTotalAckKey,
  type PriceBasis
} from "@/lib/materials/request-pricing";
import { PriceBasisField, PriceBasisWarnings } from "@/components/store/price-basis-field";

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
// two things: Existing Inventory (picked from the autocomplete) or not found.
// Inventory-First Material Request Workflow: units are never set up here —
// an Inventory material brings its Purchase Unit, Stock Unit and conversion
// (read-only, from Inventory Control), and a name not found in Inventory
// gets a "Material not found" panel with Add New Material (Manager / Super
// Admin may still request it unlinked, one unit, no conversion). The
// quantity is Requested Purchase Qty in the Purchase Unit; the row under
// each item shows the unit setup, Expected Stock After Receiving and the
// estimate. The Estimated Unit Price carries a Price Basis (per purchase
// unit or per stock unit).
// Submitting only saves the request — it never
// creates stock, a movement, or a new inventory material. The Estimated
// Unit Price / Estimated Total columns exist only when the server says the
// viewer may price material requests (canEnterPrices prop — Manager, Super
// Admin, Data Entry); the server drops a posted price otherwise.

const MAX_ITEM_ROWS = 8;
const SEARCH_DEBOUNCE_MS = 300;

const inp = "focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm";
const cell = "border border-[#E5E7EB] p-0.5 align-top";
const cellInput = "w-full rounded bg-transparent px-2.5 py-1.5 text-sm outline-none focus:bg-red-50";
const cellSelect = "w-full rounded bg-transparent px-1.5 py-1.5 text-sm outline-none focus:bg-red-50";
const subInput = "mt-1 w-full rounded border border-[#E5E7EB] bg-white px-2 py-1 text-xs outline-none focus:bg-red-50";
const miniLabel = "block text-[10px] font-black uppercase tracking-wide text-[#4B5563]";

function unitOptionList() {
  return [...GENERAL_INVENTORY_UNIT_OPTIONS, CUSTOM_UNIT_VALUE];
}

function unitLabel(value: string) {
  return value === CUSTOM_UNIT_VALUE ? "OTHER / CUSTOM" : value;
}

// Per-row local UI state. The values submitted are still read from the
// form's own inputs (name={..._${slot}}) at submit time, same as every
// other indexed-row form in this app; this mirror drives what's visible.
//
// Inventory-First Material Request Workflow: a row's units are never set
// up here. A material picked from Inventory brings its own Purchase Unit,
// Stock Unit and conversion (saved in Inventory Control → Add New Material
// or its Unit Setup), shown read-only. A name not found in Inventory gets a
// "Material not found" panel pointing to Add New Material; only a Manager /
// Super Admin may request it anyway (unlinkedOverride), with one plain unit
// and no conversion. All maths lives in lib/materials/request-pricing.ts.
type RowUi = {
  materialName: string;
  // Set only while the row is linked to a selected inventory material;
  // typing in the name again clears it.
  existing: MaterialsRequestInventoryMatch | null;
  suggestions: MaterialsRequestInventoryMatch[];
  showSuggestions: boolean;
  loading: boolean;
  searched: boolean;
  purchaseQty: string;
  // Manager / Super Admin only: request a material not in Inventory.
  unlinkedOverride: boolean;
  unlinkedUnit: string;
  customUnlinkedUnit: string;
  unitPrice: string;
  // null until the user picks it — required when the purchase and stock
  // units differ (no silent default); automatic when they are the same.
  priceBasis: PriceBasis | null;
  // "I confirm the price basis is correct" for a large total, keyed to the
  // exact price/basis/total it was given for (largeTotalAckKey).
  largeTotalAckKey: string | null;
};

function emptyRow(): RowUi {
  return {
    materialName: "",
    existing: null,
    suggestions: [],
    showSuggestions: false,
    loading: false,
    searched: false,
    purchaseQty: "",
    unlinkedOverride: false,
    unlinkedUnit: DEFAULT_UNIT,
    customUnlinkedUnit: "",
    unitPrice: "",
    priceBasis: null,
    largeTotalAckKey: null
  };
}

// Quantities: up to 3 decimals, no trailing zeros (0.25, 2, 90).
function fmtQty(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toFixed(3))) : "0";
}

// The row's units: from Inventory for a linked material; one plain unit
// for a Manager override row; none otherwise.
function rowUnits(row: RowUi): { purchaseUnit: string; stockUnit: string; conversion: number | null } {
  if (row.existing) {
    return {
      purchaseUnit: row.existing.purchase_unit ?? row.existing.unit,
      stockUnit: row.existing.unit,
      conversion: row.existing.purchase_unit ? row.existing.conversion_quantity : null
    };
  }
  if (row.unlinkedOverride) {
    const unit = row.unlinkedUnit === CUSTOM_UNIT_VALUE ? row.customUnlinkedUnit.trim() : row.unlinkedUnit;
    return { purchaseUnit: unit, stockUnit: unit, conversion: null };
  }
  return { purchaseUnit: "", stockUnit: "", conversion: null };
}

export function GeneralInventoryRequestForm({
  requesterName,
  requestedDateLabel,
  canEnterPrices,
  canRequestUnlinked = false,
  modalMode = false,
  errorMessage
}: {
  requesterName: string | null;
  requestedDateLabel: string;
  canEnterPrices: boolean;
  // Manager / Super Admin: may request a material not in Inventory
  // (emergency override). Everyone else must add it in Inventory first.
  canRequestUnlinked?: boolean;
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
  // Material, Description, Purchase Qty, Purchase Unit, Supplier, Remarks,
  // Action (+ price, price basis and total for a price-permitted viewer).
  const colCount = canEnterPrices ? 10 : 7;

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
    // A row error is stale as soon as a row is edited; re-checked on submit.
    setErrors((prev) => (prev.items ? { ...prev, items: "" } : prev));
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
    // Units come from the material's Inventory setup (rowUnits).
    updateRow(slot, {
      materialName: match.display_name,
      existing: match,
      unlinkedOverride: false,
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

  // Live preview only — the saved figures are derived again server-side
  // with the same computeRequestLine(), from the Inventory unit setup.
  function computePreview(row: RowUi) {
    const { purchaseUnit, stockUnit, conversion } = rowUnits(row);
    const price = row.unitPrice.trim() ? Number(row.unitPrice) : null;
    const figures = computeRequestLine({
      purchaseQty: Number(row.purchaseQty) || 0,
      purchaseUnit,
      stockUnit,
      conversion,
      price,
      basis: row.priceBasis
    });
    // With one unit there is only one basis; "per purchase unit" and "per
    // stock unit" mean the same thing, so it is purchase_unit automatically.
    // With two units it stays null (no total) until the user picks one.
    const basis: PriceBasis | null = figures.unitsDiffer ? row.priceBasis : "purchase_unit";
    const total = basis === null ? null : figures.total;
    const largeTotal = basis !== null && isLargeEstimatedTotal(total, price);
    const largeTotalAcked = largeTotal && row.largeTotalAckKey === largeTotalAckKey(price!, basis!, total!);
    const usable = Boolean(row.existing) || (row.unlinkedOverride && purchaseUnit !== "");
    return {
      ...figures,
      total,
      qty: Number(row.purchaseQty) || 0,
      purchaseUnit,
      stockUnit,
      price,
      basis,
      largeTotal,
      largeTotalAcked,
      usable
    };
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
      const preview = computePreview(row);
      if (!row.existing && !row.unlinkedOverride) {
        errs.items = `"${row.materialName.trim()}" is not in Inventory. Add this material in Inventory first, then create the request.`;
      } else if (!(Number(row.purchaseQty) > 0)) {
        errs.items = "Enter requested purchase quantity.";
      } else if (!preview.usable) {
        errs.items = "Select purchase unit.";
      } else if (canEnterPrices && preview.price !== null && !(preview.price >= 0)) {
        errs.items = "Estimated price must be 0 or greater.";
      } else if (canEnterPrices && preview.price !== null && preview.basis === null) {
        errs.items = `Select whether the price is for 1 ${preview.purchaseUnit} or 1 ${preview.stockUnit}.`;
      } else if (canEnterPrices && preview.largeTotal && !preview.largeTotalAcked) {
        errs.items = `Estimated total is ${formatKwd(preview.total!)} KWD. Please confirm the price basis is correct.`;
      }
      if (errs.items) break;
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
              Type a material name and pick it from the Inventory list. A material that is not in Inventory must be added in
              Inventory first (Add New Material). Submitting a request does not change any stock balance.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className={cn("w-full border-collapse text-sm", canEnterPrices ? "min-w-[1180px]" : "min-w-[860px]")}>
              <thead>
                <tr className="bg-[#F3F4F6] text-left text-[10px] font-black uppercase tracking-wide text-[#4B5563]">
                  <th className="border border-[#E5E7EB] px-3 py-2">Material Name</th>
                  <th className="border border-[#E5E7EB] px-3 py-2">Description / Specification</th>
                  <th className="w-24 border border-[#E5E7EB] px-3 py-2">Requested Purchase Qty</th>
                  <th className="w-32 border border-[#E5E7EB] px-3 py-2">Purchase Unit</th>
                  {canEnterPrices && <th className="w-32 border border-[#E5E7EB] px-3 py-2">Estimated Price (KWD)</th>}
                  {canEnterPrices && <th className="w-40 border border-[#E5E7EB] px-3 py-2">Price Basis</th>}
                  {canEnterPrices && <th className="w-28 border border-[#E5E7EB] px-3 py-2">Estimated Total</th>}
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
                  const purchaseUnitText = preview.purchaseUnit || "purchase unit";
                  const stockUnitText = preview.stockUnit || "stock unit";
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
                            placeholder="e.g. 1"
                            value={row.purchaseQty}
                            onChange={(e) => updateRow(slot, { purchaseQty: e.target.value })}
                            aria-label={`Requested purchase quantity, ${itemLabel}`}
                            className={cellInput}
                          />
                        </td>
                        <td className={cell}>
                          {/* Purchase Unit comes from the material's Inventory
                              setup (read-only); only a Manager override row
                              for a material not in Inventory picks one. */}
                          {row.existing ? (
                            <p className="px-2.5 py-1.5 text-sm font-semibold text-[#111827]">{preview.purchaseUnit}</p>
                          ) : row.unlinkedOverride ? (
                            <>
                              <select
                                value={row.unlinkedUnit}
                                onChange={(e) => updateRow(slot, { unlinkedUnit: e.target.value })}
                                aria-label={`Unit, ${itemLabel}`}
                                className={cellSelect}
                              >
                                {unitOptionList().map((u) => (
                                  <option key={u} value={u}>
                                    {unitLabel(u)}
                                  </option>
                                ))}
                              </select>
                              {row.unlinkedUnit === CUSTOM_UNIT_VALUE && (
                                <input
                                  value={row.customUnlinkedUnit}
                                  onChange={(e) => updateRow(slot, { customUnlinkedUnit: e.target.value })}
                                  placeholder="e.g. Bundle"
                                  aria-label={`Custom unit, ${itemLabel}`}
                                  className={subInput}
                                />
                              )}
                            </>
                          ) : (
                            <p className="px-2.5 py-1.5 text-sm text-[#9CA3AF]">—</p>
                          )}
                          {/* What the server reads; it re-takes the units from
                              Inventory for a linked material. */}
                          <input type="hidden" name={`purchase_unit_${slot}`} value={preview.purchaseUnit} />
                          <input type="hidden" name={`unit_${slot}`} value={preview.stockUnit} />
                          {preview.unitsDiffer && preview.conversion !== null && (
                            <input type="hidden" name={`conversion_quantity_${slot}`} value={preview.conversion} />
                          )}
                          {!row.existing && row.unlinkedOverride && (
                            <input type="hidden" name={`unlinked_override_${slot}`} value="1" />
                          )}
                        </td>
                        {canEnterPrices && (
                          <td className={cell}>
                            <input
                              name={`unit_price_${slot}`}
                              type="number"
                              step="0.001"
                              min="0"
                              inputMode="decimal"
                              placeholder={
                                preview.basis
                                  ? `Price for 1 ${preview.basis === "stock_unit" ? stockUnitText : purchaseUnitText}`
                                  : "Price, then choose its unit"
                              }
                              value={row.unitPrice}
                              onChange={(e) => updateRow(slot, { unitPrice: e.target.value })}
                              aria-label={`Estimated price, ${itemLabel}`}
                              className={cellInput}
                            />
                            {preview.price !== null && preview.basis && (
                              <p className="px-2.5 pb-1 text-[10px] font-semibold text-[#111827]">
                                for 1 {basisUnit(preview.basis, preview.purchaseUnit, preview.stockUnit)}
                              </p>
                            )}
                          </td>
                        )}
                        {canEnterPrices && (
                          <td className={cell}>
                            <PriceBasisField
                              name={`price_basis_${slot}`}
                              purchaseUnit={preview.purchaseUnit}
                              stockUnit={preview.stockUnit}
                              unitsDiffer={preview.unitsDiffer}
                              value={preview.basis}
                              onChange={(basis) => updateRow(slot, { priceBasis: basis })}
                              needsChoice={preview.price !== null && preview.basis === null}
                              label={`Price basis, ${itemLabel}`}
                            />
                          </td>
                        )}
                        {canEnterPrices && (
                          <td className="border border-[#E5E7EB] px-2.5 py-1.5 text-right align-top text-xs font-semibold tabular-nums text-[#111827]">
                            {preview.total !== null ? `${formatKwd(preview.total)} KWD` : preview.price === null ? "Not priced yet" : "Choose price basis"}
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

                      {/* Inventory unit setup and the calculation preview, under the row. */}
                      {hasName && (
                        <tr>
                          <td colSpan={colCount} className="border border-[#E5E7EB] bg-[#FAFAFA] px-3 py-2">
                            {row.existing ? (
                              <>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[#4B5563]">
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
                                  <a
                                    href={`/store/offline-inventory?material=${encodeURIComponent(row.existing.key)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-auto font-semibold text-[#2563EB] hover:underline"
                                  >
                                    Edit units in Inventory
                                  </a>
                                </div>
                                <div className="mt-2 flex flex-wrap items-start gap-x-6 gap-y-2 text-sm text-[#111827]">
                                  <div>
                                    <span className={miniLabel}>Purchase Unit</span>
                                    <p className="mt-1 font-semibold">{preview.purchaseUnit}</p>
                                  </div>
                                  <div>
                                    <span className={miniLabel}>Stock Unit</span>
                                    <p className="mt-1 font-semibold">{preview.stockUnit}</p>
                                  </div>
                                  <div>
                                    <span className={miniLabel}>Conversion</span>
                                    <p className="mt-1 font-semibold">
                                      {preview.unitsDiffer && preview.conversion !== null
                                        ? `1 ${preview.purchaseUnit} = ${fmtQty(preview.conversion)} ${preview.stockUnit}`
                                        : "Same unit (1)"}
                                    </p>
                                  </div>
                                  <div>
                                    <span className={miniLabel}>Expected Stock After Receiving</span>
                                    <p className="mt-1 font-bold tabular-nums">
                                      {preview.stockQty !== null && preview.qty > 0 ? `${fmtQty(preview.stockQty)} ${preview.stockUnit}` : "—"}
                                    </p>
                                  </div>
                                  {canEnterPrices && preview.price !== null && (
                                    <div className="min-w-[230px] rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs leading-relaxed">
                                      <p>Requested: <span className="font-bold">{fmtQty(preview.qty)} {preview.purchaseUnit}</span></p>
                                      {preview.unitsDiffer && preview.conversion !== null && (
                                        <p>
                                          Conversion: <span className="font-bold">1 {preview.purchaseUnit} = {fmtQty(preview.conversion)} {preview.stockUnit}</span>
                                        </p>
                                      )}
                                      <p>
                                        Expected stock after receiving:{" "}
                                        <span className="font-bold">{preview.stockQty !== null ? `${fmtQty(preview.stockQty)} ${preview.stockUnit}` : "—"}</span>
                                      </p>
                                      <p>
                                        Price:{" "}
                                        <span className="font-bold">
                                          {preview.basis
                                            ? `${formatKwd(preview.price)} KWD for 1 ${basisUnit(preview.basis, preview.purchaseUnit, preview.stockUnit)}`
                                            : `${formatKwd(preview.price)} KWD — choose 1 ${preview.purchaseUnit} or 1 ${preview.stockUnit}`}
                                        </span>
                                      </p>
                                      <p>
                                        Estimated Total:{" "}
                                        <span className="font-bold">{preview.total !== null ? `${formatKwd(preview.total)} KWD` : "—"}</span>
                                      </p>
                                    </div>
                                  )}
                                </div>
                                {canEnterPrices && (
                                  <PriceBasisWarnings
                                    purchaseUnit={preview.purchaseUnit}
                                    stockUnit={preview.stockUnit}
                                    unitsDiffer={preview.unitsDiffer}
                                    conversion={preview.conversion}
                                    price={preview.price}
                                    basis={preview.basis}
                                    total={preview.total}
                                    largeTotal={preview.largeTotal}
                                    acknowledged={preview.largeTotalAcked}
                                    onAcknowledge={(checked) =>
                                      updateRow(slot, {
                                        largeTotalAckKey:
                                          checked && preview.basis && preview.total !== null && preview.price !== null
                                            ? largeTotalAckKey(preview.price, preview.basis, preview.total)
                                            : null
                                      })
                                    }
                                  />
                                )}
                              </>
                            ) : (
                              <>
                                <div role="alert" className="rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                                  <p className="font-black">Material not found in Inventory.</p>
                                  <p className="mt-0.5">
                                    Add this material in Inventory first so purchase unit, stock unit, and conversion are recorded
                                    correctly. Then search for it again here.
                                  </p>
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <a
                                      href="/store/offline-inventory/add-material"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex min-h-9 items-center rounded-md bg-[#ED1C24] px-4 py-1.5 text-sm font-bold text-white hover:bg-[#c8181e]"
                                    >
                                      Add New Material
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => handleMaterialNameChange(slot, row.materialName)}
                                      className="inline-flex min-h-9 items-center rounded-md border border-amber-400 bg-white px-4 py-1.5 text-sm font-bold text-amber-900 hover:bg-amber-100"
                                    >
                                      Search again
                                    </button>
                                    <span className="text-xs">Add New Material opens in a new tab, so this request is kept.</span>
                                  </div>
                                  {canRequestUnlinked && (
                                    <label className="mt-2 flex items-center gap-2 border-t border-amber-200 pt-2 text-xs font-semibold">
                                      <input
                                        type="checkbox"
                                        checked={row.unlinkedOverride}
                                        onChange={(e) => updateRow(slot, { unlinkedOverride: e.target.checked })}
                                        className="h-4 w-4 accent-[#ED1C24]"
                                      />
                                      Manager override: request without an Inventory link (one unit, no conversion). Use only for
                                      emergencies.
                                    </label>
                                  )}
                                </div>
                                {row.unlinkedOverride && (
                                  <p className="mt-1.5 text-xs text-[#4B5563]">
                                    Requested: <span className="font-bold">{fmtQty(preview.qty)} {preview.purchaseUnit || "—"}</span> · Not
                                    linked to Inventory — the material is registered when it is received.
                                    {canEnterPrices && preview.total !== null && preview.price !== null
                                      ? ` · Price: ${formatKwd(preview.price)} KWD for 1 ${preview.purchaseUnit} · Estimated Total: ${formatKwd(preview.total)} KWD`
                                      : ""}
                                  </p>
                                )}
                              </>
                            )}
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
            <p>
              Requested Purchase Qty is in the Purchase Unit. Units and conversion come from Inventory Control — to change them,
              use Edit units in Inventory.
            </p>
            {canEnterPrices && (
              <p>
                Estimated Price is for the unit chosen under Price Basis: for 1 Purchase Unit, total = purchase qty × price; for 1
                Stock Unit, total = expected stock × price. A large total must be confirmed before submit.
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
