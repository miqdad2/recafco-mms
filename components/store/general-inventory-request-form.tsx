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
  computeRequestLine,
  priceBasisLabel,
  reversedUnitsMessage,
  suggestedStockUnit,
  unitPairKey,
  unitsLookReversed,
  type PriceBasis
} from "@/lib/materials/request-pricing";

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
// (typed name, not linked to inventory). Material Request Purchase-First
// Unit and Flexible Price Basis: the quantity is entered as Requested
// Purchase Qty in the Purchase Unit; the full-width row under each item
// holds the existing/new status, Stock Unit, Conversion Quantity (only when
// the two units differ, always "1 Purchase Unit = N Stock Unit"), the
// Calculated Stock Quantity and a calculation preview. The Estimated Unit
// Price carries a Price Basis (per purchase unit or per stock unit).
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
// (existing/new badge, suggestions, custom-unit inputs, the stock-unit /
// conversion row, live estimates).
//
// Purchase-first: the row is entered as Requested Purchase Qty + Purchase
// Unit (how the supplier sells it); Stock Unit is how inventory tracks it
// after receiving, and Conversion Quantity (stock units inside 1 purchase
// unit) is only asked for when the two units differ. All maths lives in
// lib/materials/request-pricing.ts.
type RowUi = {
  materialName: string;
  // Set only while the row is linked to a selected inventory material;
  // typing in the name again clears it (the row becomes a new material).
  existing: MaterialsRequestInventoryMatch | null;
  suggestions: MaterialsRequestInventoryMatch[];
  showSuggestions: boolean;
  loading: boolean;
  searched: boolean;
  purchaseQty: string;
  purchaseUnit: string;
  customPurchaseUnit: string;
  // New material only — an existing material always uses its own unit.
  stockUnit: string;
  customStockUnit: string;
  // True once the user picks a Stock Unit themselves; until then a
  // Purchase Unit change may suggest one (suggestedStockUnit).
  stockUnitTouched: boolean;
  conversionQuantity: string;
  // Set by "Keep as entered" on a reversed-units warning, keyed to the
  // exact unit pair it was given for (unitPairKey).
  unitsConfirmedKey: string | null;
  unitPrice: string;
  priceBasis: PriceBasis;
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
    purchaseUnit: DEFAULT_UNIT,
    customPurchaseUnit: "",
    stockUnit: DEFAULT_UNIT,
    customStockUnit: "",
    stockUnitTouched: false,
    conversionQuantity: "",
    unitsConfirmedKey: null,
    unitPrice: "",
    priceBasis: "purchase_unit"
  };
}

function fmt3(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "0.000";
}

// Quantities: up to 3 decimals, no trailing zeros (0.25, 2, 90).
function fmtQty(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toFixed(3))) : "0";
}

// A unit stored outside the dropdown list (e.g. an existing material's
// "litter") is shown through the OTHER / CUSTOM option with its text.
function unitSelectState(unit: string): { value: string; custom: string } {
  return (GENERAL_INVENTORY_UNIT_OPTIONS as readonly string[]).includes(unit)
    ? { value: unit, custom: "" }
    : { value: CUSTOM_UNIT_VALUE, custom: unit };
}

function stockUnitOf(row: RowUi): string {
  if (row.existing) return row.existing.unit;
  return row.stockUnit === CUSTOM_UNIT_VALUE ? row.customStockUnit.trim() : row.stockUnit;
}

function purchaseUnitOf(row: RowUi): string {
  return row.purchaseUnit === CUSTOM_UNIT_VALUE ? row.customPurchaseUnit.trim() : row.purchaseUnit;
}

export function GeneralInventoryRequestForm({
  requesterName,
  requestedDateLabel,
  canEnterPrices,
  modalMode = false,
  errorMessage
}: {
  requesterName: string | null;
  requestedDateLabel: string;
  canEnterPrices: boolean;
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
    // Stock Unit comes from the material itself. Inventory stores no
    // purchase unit or conversion, so Purchase Unit starts as the same
    // unit (conversion 1); the user changes it if the supplier sells in a
    // different unit.
    const purchase = unitSelectState(match.unit);
    updateRow(slot, {
      materialName: match.display_name,
      existing: match,
      purchaseUnit: purchase.value,
      customPurchaseUnit: purchase.custom,
      conversionQuantity: "",
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

  // "Fix automatically" on the reversed-units panel. A new material swaps
  // the two units and keeps the Conversion Quantity (1 PCS = 9 BOX ->
  // 1 BOX = 9 PCS). An existing material's Stock Unit is fixed by
  // inventory, so the Purchase Unit is set to that same unit instead.
  function fixUnits(slot: number) {
    const row = rows[slot];
    if (!row) return;
    if (row.existing) {
      const purchase = unitSelectState(row.existing.unit);
      updateRow(slot, { purchaseUnit: purchase.value, customPurchaseUnit: purchase.custom, conversionQuantity: "" });
      return;
    }
    updateRow(slot, {
      purchaseUnit: row.stockUnit,
      customPurchaseUnit: row.customStockUnit,
      stockUnit: row.purchaseUnit,
      customStockUnit: row.customPurchaseUnit,
      stockUnitTouched: true
    });
  }

  // "Keep as entered": the user confirms an unusual pair on purpose.
  function keepUnits(slot: number) {
    const row = rows[slot];
    if (!row) return;
    updateRow(slot, { unitsConfirmedKey: unitPairKey(purchaseUnitOf(row), stockUnitOf(row)) });
  }

  // Purchase Unit change. On a new material whose Stock Unit the user has
  // not picked yet, suggest the usual Stock Unit (BARREL -> LITER, ROLL ->
  // METER, BAG -> KG, BOX -> PCS).
  function handlePurchaseUnitChange(slot: number, value: string) {
    const row = rows[slot] ?? emptyRow();
    const patch: Partial<RowUi> = { purchaseUnit: value };
    if (!row.existing && !row.stockUnitTouched && value !== CUSTOM_UNIT_VALUE) {
      const suggestion = suggestedStockUnit(value);
      if (suggestion) {
        const stock = unitSelectState(suggestion);
        patch.stockUnit = stock.value;
        patch.customStockUnit = stock.custom;
      }
    }
    updateRow(slot, patch);
  }

  // Live preview only — the saved figures are derived again server-side
  // with the same computeRequestLine().
  function computePreview(row: RowUi) {
    const purchaseUnit = purchaseUnitOf(row);
    const stockUnit = stockUnitOf(row);
    const price = row.unitPrice.trim() ? Number(row.unitPrice) : null;
    const figures = computeRequestLine({
      purchaseQty: Number(row.purchaseQty) || 0,
      purchaseUnit,
      stockUnit,
      conversion: row.conversionQuantity.trim() ? Number(row.conversionQuantity) : null,
      price,
      basis: row.priceBasis
    });
    // With one unit there is only one basis; "per purchase unit" and "per
    // stock unit" mean the same thing, so it is posted as purchase_unit.
    const basis: PriceBasis = figures.unitsDiffer ? row.priceBasis : "purchase_unit";
    // Reversed units (Stock Unit = BOX, Purchase Unit = PCS) that the user
    // has not kept on purpose: show no conversion or stock result at all
    // rather than "1 PCS = 9 BOX", and block the row.
    const reversed = unitsLookReversed(purchaseUnit, stockUnit);
    const unitsConfirmed = reversed && row.unitsConfirmedKey === unitPairKey(purchaseUnit, stockUnit);
    const blocked = reversed && !unitsConfirmed;
    return {
      ...figures,
      stockQty: blocked ? null : figures.stockQty,
      total: blocked && basis === "stock_unit" ? null : figures.total,
      reversed,
      unitsConfirmed,
      blocked,
      qty: Number(row.purchaseQty) || 0,
      purchaseUnit,
      stockUnit,
      price,
      basis
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
      if (!(Number(row.purchaseQty) > 0)) {
        errs.items = "Enter requested purchase quantity.";
      } else if (!preview.purchaseUnit) {
        errs.items = "Select purchase unit.";
      } else if (!preview.stockUnit) {
        errs.items = "Select stock unit.";
      } else if (preview.blocked) {
        errs.items = reversedUnitsMessage(preview.purchaseUnit, preview.stockUnit);
      } else if (preview.unitsDiffer && preview.conversion === null) {
        errs.items = "Enter how many stock units are inside 1 purchase unit.";
      } else if (canEnterPrices && preview.price !== null && !(preview.price >= 0)) {
        errs.items = "Estimated unit price must be 0 or greater.";
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
              Type a material name and pick it from the list if it is already in inventory. If it is not in the list, keep
              the name you typed — it is saved as a new material. Submitting a request does not change any stock balance.
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
                  {canEnterPrices && <th className="w-36 border border-[#E5E7EB] px-3 py-2">Estimated Unit Price (KWD)</th>}
                  {canEnterPrices && <th className="w-28 border border-[#E5E7EB] px-3 py-2">Price Basis</th>}
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
                          <select
                            name={`purchase_unit_${slot}`}
                            value={row.purchaseUnit}
                            onChange={(e) => handlePurchaseUnitChange(slot, e.target.value)}
                            aria-label={`Purchase unit, ${itemLabel}`}
                            className={cellSelect}
                          >
                            {unitOptionList().map((u) => (
                              <option key={u} value={u}>
                                {unitLabel(u)}
                              </option>
                            ))}
                          </select>
                          {row.purchaseUnit === CUSTOM_UNIT_VALUE && (
                            <input
                              name={`custom_purchase_unit_${slot}`}
                              value={row.customPurchaseUnit}
                              onChange={(e) => updateRow(slot, { customPurchaseUnit: e.target.value })}
                              placeholder="e.g. PALLET"
                              aria-label={`Custom purchase unit, ${itemLabel}`}
                              className={subInput}
                            />
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
                              placeholder={`Price per ${preview.basis === "stock_unit" ? stockUnitText : purchaseUnitText}`}
                              value={row.unitPrice}
                              onChange={(e) => updateRow(slot, { unitPrice: e.target.value })}
                              aria-label={`Estimated unit price, ${itemLabel}`}
                              className={cellInput}
                            />
                            <p className="px-2.5 pb-1 text-[10px] text-[#9CA3AF]">Enter price based on selected Price Basis.</p>
                          </td>
                        )}
                        {canEnterPrices && (
                          <td className={cell}>
                            {preview.unitsDiffer ? (
                              <select
                                name={`price_basis_${slot}`}
                                value={row.priceBasis}
                                onChange={(e) => updateRow(slot, { priceBasis: e.target.value as PriceBasis })}
                                aria-label={`Price basis, ${itemLabel}`}
                                className={cellSelect}
                              >
                                <option value="purchase_unit">{priceBasisLabel("purchase_unit", preview.purchaseUnit, preview.stockUnit)}</option>
                                <option value="stock_unit">{priceBasisLabel("stock_unit", preview.purchaseUnit, preview.stockUnit)}</option>
                              </select>
                            ) : (
                              <>
                                {/* One unit: only one basis exists. */}
                                <input type="hidden" name={`price_basis_${slot}`} value="purchase_unit" />
                                <p className="px-2.5 py-1.5 text-sm text-[#111827]">
                                  {priceBasisLabel("purchase_unit", preview.purchaseUnit, preview.stockUnit)}
                                </p>
                              </>
                            )}
                          </td>
                        )}
                        {canEnterPrices && (
                          <td className="border border-[#E5E7EB] px-2.5 py-1.5 text-right align-top text-xs font-semibold tabular-nums text-[#111827]">
                            {preview.total !== null ? `${fmt3(preview.total)} KWD` : preview.price === null ? "Not priced yet" : "—"}
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

                      {/* Stock unit, conversion and the calculation preview, under the row. */}
                      {hasName && (
                        <tr>
                          <td colSpan={colCount} className="border border-[#E5E7EB] bg-[#FAFAFA] px-3 py-2">
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
                            </div>

                            <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-2">
                              {/* Reversed units: a full-width panel the user must
                                  answer (Fix automatically / Keep as entered)
                                  before this row can be submitted. */}
                              {preview.reversed && !preview.unitsConfirmed && (
                                <div
                                  role="alert"
                                  className="basis-full rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
                                >
                                  <p className="font-black">Units look reversed.</p>
                                  <div className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                                    <p>
                                      You selected: Purchase Unit <strong>{preview.purchaseUnit}</strong>, Stock Unit{" "}
                                      <strong>{preview.stockUnit}</strong>
                                    </p>
                                    <p>
                                      Usually this should be: Purchase Unit <strong>{preview.stockUnit}</strong>, Stock Unit{" "}
                                      <strong>{row.existing ? preview.stockUnit : preview.purchaseUnit}</strong>
                                    </p>
                                  </div>
                                  <p className="mt-1 text-xs">
                                    {row.existing
                                      ? `This material is stocked in ${preview.stockUnit}, so it is usually purchased in ${preview.stockUnit} too (or a pack that contains ${preview.stockUnit}).`
                                      : `Because 1 ${preview.stockUnit} contains ${preview.conversion !== null ? fmtQty(preview.conversion) : "several"} ${preview.purchaseUnit}, not the other way round.`}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() => fixUnits(slot)}
                                      className="inline-flex min-h-9 items-center rounded-md bg-[#ED1C24] px-4 py-1.5 text-sm font-bold text-white hover:bg-[#c8181e]"
                                    >
                                      Fix automatically
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => keepUnits(slot)}
                                      className="inline-flex min-h-9 items-center rounded-md border border-amber-400 bg-white px-4 py-1.5 text-sm font-bold text-amber-900 hover:bg-amber-100"
                                    >
                                      Keep as entered
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Order: Purchase Unit (set in the row above) ->
                                  Stock Unit -> Conversion Quantity, then the
                                  preview reads 1 [Purchase Unit] = N [Stock Unit]. */}
                              <div>
                                <span className={miniLabel}>1. Purchase Unit</span>
                                <span className="block text-[10px] text-[#9CA3AF]">How the supplier sells it (set in the row).</span>
                                <p className="mt-1 rounded-md border border-[#E5E7EB] bg-gray-50 px-2.5 py-1.5 text-sm font-semibold text-[#111827]">
                                  {purchaseUnitText}
                                </p>
                              </div>

                              <div>
                                <span className={miniLabel}>2. Stock Unit</span>
                                <span className="block text-[10px] text-[#9CA3AF]">How inventory counts it after receiving.</span>
                                {row.existing ? (
                                  <>
                                    <input type="hidden" name={`unit_${slot}`} value={row.existing.unit} />
                                    <p className="mt-1 rounded-md border border-[#E5E7EB] bg-gray-50 px-2.5 py-1.5 text-sm font-semibold text-[#111827]">
                                      {row.existing.unit}
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <select
                                      name={`unit_${slot}`}
                                      value={row.stockUnit}
                                      onChange={(e) => updateRow(slot, { stockUnit: e.target.value, stockUnitTouched: true })}
                                      aria-label={`Stock unit, ${itemLabel}`}
                                      className={cn(miniInput, "w-36")}
                                    >
                                      {unitOptionList().map((u) => (
                                        <option key={u} value={u}>
                                          {unitLabel(u)}
                                        </option>
                                      ))}
                                    </select>
                                    {row.stockUnit === CUSTOM_UNIT_VALUE && (
                                      <input
                                        name={`custom_unit_${slot}`}
                                        value={row.customStockUnit}
                                        onChange={(e) => updateRow(slot, { customStockUnit: e.target.value, stockUnitTouched: true })}
                                        placeholder="e.g. Bundle"
                                        aria-label={`Custom stock unit, ${itemLabel}`}
                                        className={cn(miniInput, "mt-1 w-36")}
                                      />
                                    )}
                                  </>
                                )}
                              </div>

                              <div>
                                <span className={miniLabel}>3. Conversion Quantity</span>
                                <span className="block text-[10px] text-[#9CA3AF]">
                                  {preview.blocked
                                    ? "Fix the units above first."
                                    : preview.unitsDiffer
                                      ? `How many ${stockUnitText} are inside 1 ${purchaseUnitText}.`
                                      : "Same unit — 1."}
                                </span>
                                {preview.unitsDiffer ? (
                                  <input
                                    name={`conversion_quantity_${slot}`}
                                    type="number"
                                    step="0.0001"
                                    min="0"
                                    inputMode="decimal"
                                    placeholder="e.g. 9"
                                    value={row.conversionQuantity}
                                    onChange={(e) => updateRow(slot, { conversionQuantity: e.target.value })}
                                    aria-label={`Conversion quantity, ${itemLabel}`}
                                    className={cn(miniInput, "w-28")}
                                  />
                                ) : (
                                  <p className="mt-1 w-28 rounded-md border border-[#E5E7EB] bg-gray-50 px-2.5 py-1.5 text-sm text-[#4B5563]">1</p>
                                )}
                                {preview.reversed && preview.unitsConfirmed && (
                                  <>
                                    <input type="hidden" name={`units_confirmed_${slot}`} value="1" />
                                    <p className="mt-1 text-[11px] font-semibold text-amber-700">Units confirmed manually.</p>
                                  </>
                                )}
                              </div>

                              <div>
                                <span className={miniLabel}>Calculated Stock Quantity</span>
                                <span className="block text-[10px] text-[#9CA3AF]">Requested Purchase Qty × Conversion Quantity</span>
                                <p className="mt-1 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-sm font-bold tabular-nums text-[#111827]">
                                  {preview.stockQty !== null && preview.qty > 0 ? `${fmtQty(preview.stockQty)} ${stockUnitText}` : "—"}
                                </p>
                              </div>

                              {/* Calculation preview */}
                              <div className="min-w-[220px] rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs leading-relaxed text-[#111827]">
                                <p>
                                  <span className="font-bold">{fmtQty(preview.qty)} {purchaseUnitText}</span> requested
                                </p>
                                {preview.unitsDiffer && !preview.blocked && (
                                  <p>
                                    <span className="font-bold">
                                      1 {purchaseUnitText} = {preview.conversion !== null ? fmtQty(preview.conversion) : "?"} {stockUnitText}
                                    </span>
                                  </p>
                                )}
                                <p>
                                  Expected stock after receiving:{" "}
                                  <span className="font-bold">
                                    {preview.stockQty !== null ? `${fmtQty(preview.stockQty)} ${stockUnitText}` : "—"}
                                  </span>
                                </p>
                                {canEnterPrices && preview.price !== null && (
                                  <>
                                    <p>
                                      Price:{" "}
                                      <span className="font-bold">
                                        {fmt3(preview.price)} KWD / {preview.basis === "stock_unit" ? stockUnitText : purchaseUnitText}
                                      </span>
                                    </p>
                                    <p>
                                      Estimated Total:{" "}
                                      <span className="font-bold">{preview.total !== null ? `${fmt3(preview.total)} KWD` : "—"}</span>
                                    </p>
                                  </>
                                )}
                              </div>
                            </div>
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
              Requested Purchase Qty is in the Purchase Unit (how the supplier sells it). Stock Unit is how inventory tracks it after
              receiving. Conversion is always 1 Purchase Unit = N Stock Units.
            </p>
            {canEnterPrices && (
              <p>
                Price Basis says whether the Estimated Unit Price is per Purchase Unit (total = purchase qty × price) or per Stock
                Unit (total = calculated stock qty × price).
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
