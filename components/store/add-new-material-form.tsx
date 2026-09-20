"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";

import { addNewMaterialAction, type OfflineMovementState } from "@/app/actions/offline-inventory";
import {
  MATERIAL_CATEGORIES,
  ADD_NEW_CATEGORY_VALUE,
  inputCls as inp,
  labelCls as lbl,
} from "@/components/store/offline-inventory-types";
import { GENERAL_INVENTORY_UNIT_OPTIONS, CUSTOM_UNIT_VALUE, DEFAULT_UNIT } from "@/components/store/general-inventory-units";
import { useLargeFormModal } from "@/components/ui/large-form-modal";
import { cn } from "@/lib/utils";

// Inventory Add New Material Cost and Unit Conversion UI Unit 10G.73.
//
// Reorganizes this form into 4 clear sections (Task 1): Basic Material
// Details, Stock Setup, Cost / Purchase Unit, Location / Notes. The core
// new idea (Task 4) is separating "how it was bought" (Purchase Unit/
// Purchase Quantity/Purchase Unit Cost) from "how it is tracked and issued"
// (Inventory Unit/Opening Inventory Quantity/Inventory Unit Cost) — a
// material bought as 1 BARREL but stored/issued as 200 LITER. When the
// "Use different inventory unit" toggle is off (the default, and the only
// state the ORIGINAL single-unit form ever had), Inventory Unit simply
// mirrors Purchase Unit and the conversion factor is 1 — Task 3's "normal
// item" case falls out of the exact same formulas as Task 4's bulk case,
// with no separate code path (see addNewMaterialAction's own comment).
//
// Both unit dropdowns reuse GENERAL_INVENTORY_UNIT_OPTIONS/CUSTOM_UNIT_VALUE
// from the General Inventory Request feature (Task 2's own explicit
// instruction to reuse, not duplicate, that list) — that file is a plain,
// non-"use client" module with no side effects, so importing it here does
// not touch the General Inventory Request flow itself in any way.
//
// All calculation shown here is a LIVE PREVIEW only — the real, authoritative
// Opening Inventory Quantity / Inventory Unit Cost / Opening Stock Value are
// recomputed server-side in addNewMaterialAction from the same raw
// Purchase Quantity / Purchase Unit Cost / Conversion Quantity inputs,
// never trusted from the client.

function unitOptionList() {
  return [...GENERAL_INVENTORY_UNIT_OPTIONS, CUSTOM_UNIT_VALUE];
}
function unitLabel(value: string) {
  return value === CUSTOM_UNIT_VALUE ? "OTHER / CUSTOM" : value;
}
function fmt3(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "0.000";
}

export function AddNewMaterialForm({
  modalMode = false,
  canViewCosts = false,
}: { modalMode?: boolean; canViewCosts?: boolean } = {}) {
  const router = useRouter();
  const modal = useLargeFormModal();
  const [state, formAction, isPending] = useActionState<OfflineMovementState, FormData>(
    addNewMaterialAction,
    null
  );
  const [category, setCategory] = useState("Other");
  const [newCategoryName, setNewCategoryName] = useState("");
  const isAddingCategory = category === ADD_NEW_CATEGORY_VALUE;

  // Task 2 — defaults: Purchase Unit = PCS, Inventory Unit = PCS (the two
  // start identical; Inventory Unit only becomes independently editable
  // once "Use different inventory unit" is switched on).
  const [purchaseUnit, setPurchaseUnit] = useState(DEFAULT_UNIT);
  const [customPurchaseUnit, setCustomPurchaseUnit] = useState("");
  const [purchaseQty, setPurchaseQty] = useState("");
  const [purchaseUnitCost, setPurchaseUnitCost] = useState("");
  const [useConversion, setUseConversion] = useState(false);
  const [inventoryUnit, setInventoryUnit] = useState(DEFAULT_UNIT);
  const [customInventoryUnit, setCustomInventoryUnit] = useState("");
  const [conversionQty, setConversionQty] = useState("");

  const resolvedPurchaseUnit = purchaseUnit === CUSTOM_UNIT_VALUE ? (customPurchaseUnit.trim() || "purchase unit") : purchaseUnit;
  const resolvedInventoryUnit = useConversion
    ? inventoryUnit === CUSTOM_UNIT_VALUE
      ? (customInventoryUnit.trim() || "inventory unit")
      : inventoryUnit
    : resolvedPurchaseUnit;

  // Task 3/4 — one formula covers both the normal (same-unit) and bulk
  // (converted) cases: conversion factor is 1 unless a real conversion is
  // both enabled and entered.
  const purchaseQtyNum = Number(purchaseQty) || 0;
  const conversionFactor = useConversion && Number(conversionQty) > 0 ? Number(conversionQty) : 1;
  const openingInventoryQty = purchaseQtyNum * conversionFactor;
  const purchaseUnitCostNum = purchaseUnitCost ? Number(purchaseUnitCost) : null;
  const inventoryUnitCost = purchaseUnitCostNum !== null ? purchaseUnitCostNum / conversionFactor : null;
  const openingStockValue = purchaseUnitCostNum !== null ? purchaseQtyNum * purchaseUnitCostNum : 0;

  useEffect(() => {
    if (state?.ok) {
      const params = new URLSearchParams({ success: "material-added" });
      if (state.category) params.set("category", state.category);
      router.push(`/store/offline-inventory?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  const formEl = (
      <form action={formAction} className="space-y-6">
        {state?.ok === false && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <span>{state.error}</span>
              {state.existingMaterialKey && (
                // Inventory Control Page Simplification Unit 10G.16, Task
                // 2/4: the "Receive More" recovery link here was a direct
                // manual receive entry point on the Inventory Control
                // surface — removed for the same reason as the page's own
                // Receive Material card/row actions. Receive still happens
                // through Daily Activity for correct Job Card tracking.
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    href="/store/offline-inventory"
                    className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
                  >
                    View Existing
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section 1 — Basic Material Details */}
        <div>
          <p className="mb-3 text-[11px] font-black uppercase tracking-wide text-[#9CA3AF]">1. Basic Material Details</p>
          <div className="space-y-4">
            <div>
              <label htmlFor="nm-name" className={lbl}>
                Material Name <span className="text-[#ED1C24]">*</span>
              </label>
              <input
                id="nm-name"
                type="text"
                name="manual_material_name"
                required
                placeholder="e.g. Hydraulic Hose 12 mm"
                className={inp}
                disabled={isPending}
              />
            </div>

            <div>
              <label htmlFor="nm-category" className={lbl}>Category</label>
              <select
                id="nm-category"
                name="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inp}
                disabled={isPending}
              >
                {MATERIAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option value={ADD_NEW_CATEGORY_VALUE}>+ Add New Category</option>
              </select>
              {isAddingCategory && (
                <div className="mt-2">
                  <label htmlFor="nm-new-category" className={lbl}>
                    New Category Name <span className="text-[#ED1C24]">*</span>
                  </label>
                  <input
                    id="nm-new-category"
                    type="text"
                    name="new_category_name"
                    required
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="e.g. Hydraulic Materials"
                    className={inp}
                    disabled={isPending}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="nm-partnum" className={lbl}>Part Number</label>
                <input
                  id="nm-partnum"
                  type="text"
                  name="manual_part_number"
                  placeholder="Optional"
                  className={inp}
                  disabled={isPending}
                />
              </div>
              <div>
                <label htmlFor="nm-sscode" className={lbl}>SS Rec. Code</label>
                <input
                  id="nm-sscode"
                  type="text"
                  name="ss_rec_code"
                  placeholder="Optional"
                  className={inp}
                  disabled={isPending}
                />
              </div>
            </div>
            <p className="text-xs text-[#9CA3AF]">SS Rec. Code is reserved for SAP material/reference mapping.</p>
          </div>
        </div>

        {/* Section 2 — Stock Setup */}
        <div className="border-t border-[#F3F4F6] pt-5">
          <p className="mb-3 text-[11px] font-black uppercase tracking-wide text-[#9CA3AF]">2. Stock Setup</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>
                Inventory Unit <span className="text-[#ED1C24]">*</span>
              </label>
              {/* Task 3/4 — Inventory Unit mirrors Purchase Unit (Section 3)
                  until "Use different inventory unit" is switched on there;
                  becomes an independent, live dropdown only then. No hidden
                  duplicate field posted while mirroring — the server simply
                  treats Inventory Unit = Purchase Unit when the toggle is
                  off (see addNewMaterialAction). */}
              {useConversion ? (
                <>
                  <select
                    id="nm-inventory-unit"
                    name="inventory_unit"
                    value={inventoryUnit}
                    onChange={(e) => setInventoryUnit(e.target.value)}
                    className={inp}
                    disabled={isPending}
                  >
                    {unitOptionList().map((u) => (
                      <option key={u} value={u}>{unitLabel(u)}</option>
                    ))}
                  </select>
                  {inventoryUnit === CUSTOM_UNIT_VALUE && (
                    <input
                      type="text"
                      name="custom_inventory_unit"
                      value={customInventoryUnit}
                      onChange={(e) => setCustomInventoryUnit(e.target.value)}
                      placeholder="e.g. LITER"
                      className={cn(inp, "mt-1.5")}
                      disabled={isPending}
                    />
                  )}
                </>
              ) : (
                <p className={cn(inp, "flex items-center bg-gray-50 text-[#4B5563]")}>
                  {resolvedPurchaseUnit} <span className="ml-1.5 text-xs text-[#9CA3AF]">(same as Purchase Unit)</span>
                </p>
              )}
            </div>
            <div>
              <label className={lbl}>Opening Inventory Quantity</label>
              {/* Task 4 — always the calculated result (Purchase Quantity ×
                  Conversion), never a separately-typed value, so it can
                  never silently disagree with what actually gets saved. */}
              <p className={cn(inp, "flex items-center bg-gray-50 font-semibold text-[#111827]")}>
                {fmt3(openingInventoryQty)} {resolvedInventoryUnit}
              </p>
              <p className="mt-1 text-xs text-[#9CA3AF]">
                Calculated from Purchase Quantity below. Leave Purchase Quantity as 0 to register this material now and receive stock later.
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="nm-min-stock" className={lbl}>
                Minimum Stock Level <span className="font-normal text-[#9CA3AF]">Optional</span>
              </label>
              <input
                id="nm-min-stock"
                type="number"
                name="minimum_stock_quantity"
                min="0"
                step="0.001"
                placeholder="e.g. 50"
                className={inp}
                disabled={isPending}
              />
              <p className="mt-1 text-xs text-[#9CA3AF]">
                Below this balance, the material shows as Low Stock in Inventory Control.
              </p>
            </div>
            <div>
              <label htmlFor="nm-reorder-qty" className={lbl}>
                Reorder Quantity <span className="font-normal text-[#9CA3AF]">Optional</span>
              </label>
              <input
                id="nm-reorder-qty"
                type="number"
                name="reorder_quantity"
                min="0.001"
                step="0.001"
                placeholder="e.g. 200"
                className={inp}
                disabled={isPending}
              />
              <p className="mt-1 text-xs text-[#9CA3AF]">How much to reorder when stock is low.</p>
            </div>
          </div>
        </div>

        {/* Section 3 — Cost / Purchase Unit */}
        <div className="border-t border-[#F3F4F6] pt-5">
          <p className="mb-3 text-[11px] font-black uppercase tracking-wide text-[#9CA3AF]">3. Cost / Purchase Unit</p>
          <p className="mb-3 text-xs text-[#6B7280]">
            Use Purchase Unit when buying material in bulk, for example 1 BARREL. Use Inventory Unit for the unit used in stock and Job Card issue, for example LITER.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="nm-purchase-unit" className={lbl}>
                Purchase Unit <span className="text-[#ED1C24]">*</span>
              </label>
              <select
                id="nm-purchase-unit"
                name="purchase_unit"
                value={purchaseUnit}
                onChange={(e) => setPurchaseUnit(e.target.value)}
                required
                className={inp}
                disabled={isPending}
              >
                {unitOptionList().map((u) => (
                  <option key={u} value={u}>{unitLabel(u)}</option>
                ))}
              </select>
              {purchaseUnit === CUSTOM_UNIT_VALUE && (
                <input
                  type="text"
                  name="custom_purchase_unit"
                  value={customPurchaseUnit}
                  onChange={(e) => setCustomPurchaseUnit(e.target.value)}
                  placeholder="e.g. BARREL"
                  className={cn(inp, "mt-1.5")}
                  disabled={isPending}
                />
              )}
            </div>
            <div>
              <label htmlFor="nm-purchase-qty" className={lbl}>Purchase Quantity</label>
              <input
                id="nm-purchase-qty"
                type="number"
                name="purchase_quantity"
                min="0"
                step="0.001"
                inputMode="decimal"
                value={purchaseQty}
                onChange={(e) => setPurchaseQty(e.target.value)}
                placeholder="0"
                className={inp}
                disabled={isPending}
              />
              <p className="mt-1 text-xs text-[#9CA3AF]">Quantity bought in Purchase Unit, e.g. 1 BARREL.</p>
            </div>
          </div>

          {canViewCosts && (
            <div className="mt-3">
              <label htmlFor="nm-purchase-cost" className={lbl}>
                Purchase Unit Cost (KWD) <span className="font-normal text-[#9CA3AF]">Optional</span>
              </label>
              <input
                id="nm-purchase-cost"
                type="number"
                name="purchase_unit_cost"
                min="0"
                step="0.001"
                placeholder="0.000"
                value={purchaseUnitCost}
                onChange={(e) => setPurchaseUnitCost(e.target.value)}
                className={inp}
                disabled={isPending}
              />
              <p className="mt-1 text-xs text-[#9CA3AF]">
                Price for one {resolvedPurchaseUnit}. Can still be saved even if Purchase Quantity is 0, as the latest cost for this material.
              </p>
            </div>
          )}

          <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#111827]">
            <input
              type="checkbox"
              name="use_conversion"
              checked={useConversion}
              onChange={(e) => setUseConversion(e.target.checked)}
              className="h-4 w-4 accent-[#ED1C24]"
              disabled={isPending}
            />
            Use different inventory unit
          </label>
          <p className="mt-0.5 text-xs text-[#9CA3AF]">
            Turn this on when the item is purchased in one unit but stored or issued in another. Example: 1 BARREL = 200 LITER.
          </p>

          {useConversion && (
            <div className="mt-2 grid gap-3 rounded-md bg-gray-50 p-3 sm:grid-cols-2">
              <div>
                <label htmlFor="nm-conversion-qty" className={lbl}>
                  Conversion — 1 {resolvedPurchaseUnit} = ? {resolvedInventoryUnit}
                </label>
                <input
                  id="nm-conversion-qty"
                  type="number"
                  name="conversion_quantity"
                  min="0"
                  step="0.0001"
                  placeholder="e.g. 200"
                  value={conversionQty}
                  onChange={(e) => setConversionQty(e.target.value)}
                  className={inp}
                  disabled={isPending}
                />
              </div>
              <div className="rounded-md border border-[#E5E7EB] bg-white p-2.5 text-xs text-[#111827] sm:col-span-2">
                <p>
                  Opening Inventory Quantity ={" "}
                  <span className="font-bold">{fmt3(openingInventoryQty)} {resolvedInventoryUnit}</span>
                </p>
                {canViewCosts && (
                  <p className="mt-0.5">
                    Inventory Unit Cost ={" "}
                    <span className="font-bold">
                      {inventoryUnitCost !== null ? fmt3(inventoryUnitCost) : "—"} per {resolvedInventoryUnit}
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}

          {canViewCosts && (
            <div className="mt-3">
              <label className={lbl}>Opening Stock Value (KWD)</label>
              <p className={cn(inp, "flex items-center bg-gray-50 font-semibold text-[#111827]")}>
                {openingStockValue.toFixed(3)}
              </p>
              <p className="mt-1 text-xs text-[#9CA3AF]">Purchase Quantity × Purchase Unit Cost, calculated automatically.</p>
            </div>
          )}
        </div>

        {/* Section 4 — Location / Notes */}
        <div className="border-t border-[#F3F4F6] pt-5">
          <p className="mb-3 text-[11px] font-black uppercase tracking-wide text-[#9CA3AF]">4. Location / Notes</p>
          <div className="space-y-4">
            <div>
              <label htmlFor="nm-location" className={lbl}>Location / Bin</label>
              <input
                id="nm-location"
                type="text"
                name="location"
                placeholder="Optional — e.g. Shelf A3, Store Room 2"
                className={inp}
                disabled={isPending}
              />
            </div>
            <div>
              <label htmlFor="nm-remarks" className={lbl}>Remarks</label>
              <textarea
                id="nm-remarks"
                name="remarks"
                rows={2}
                placeholder="Optional notes"
                className={cn(inp, "resize-none")}
                disabled={isPending}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-[#F3F4F6] pt-4">
          <button
            type="submit"
            disabled={isPending}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-60 sm:flex-none sm:px-8"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? "Saving…" : "Add Material"}
          </button>
          {modalMode ? (
            <button
              type="button"
              onClick={() => modal?.requestClose()}
              className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
            >
              Cancel
            </button>
          ) : (
            <Link
              href="/store/offline-inventory"
              className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
            >
              Cancel
            </Link>
          )}
        </div>
      </form>
  );

  if (modalMode) return formEl;

  return (
    <div className="mx-auto w-full max-w-2xl rounded-md border border-[#E5E7EB] bg-white p-6 shadow-sm">
      {formEl}
    </div>
  );
}
