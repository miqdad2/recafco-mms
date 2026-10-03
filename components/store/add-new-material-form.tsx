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

// Inventory Add Material Simple Layout Register-First Fix.
//
// Keeps the original, compact Unit 10G.73 layout — Basic Material Details,
// Stock Setup, Cost / Purchase Unit, Location / Notes — and applies the
// register-first behavior on top of it instead of the separate "Unit Setup"
// / "Optional Opening Stock" sections an intermediate version introduced:
//
// - The default save only registers the material: balance 0 in its Stock
//   Unit. One "Add opening stock now" checkbox (off by default, in
//   Stock Setup, right under Opening Inventory Quantity) is the only way to
//   save real stock; Purchase Quantity is disabled until it is on. The
//   server (addNewMaterialAction) force-zeros the quantity whenever the
//   checkbox is off, so the zero-balance default does not depend on this
//   form disabling the field.
// - "Stock Unit" (the unit used for inventory balance and material issue;
//   posted as inventory_unit) mirrors Purchase Unit until "Purchase unit is
//   different from stock unit" is on; then it is an explicit, required
//   choice that starts blank — never pre-selected to PCS. The conversion
//   box is laid out as the equation itself, purchase unit always first:
//   1 [Purchase Unit] = [Conversion Quantity] [Stock Unit].
// - Cost fields exist only for a cost-permitted viewer, and only while
//   opening stock is on (a register-only save records no cost or value).
//
// Both unit dropdowns reuse GENERAL_INVENTORY_UNIT_OPTIONS/CUSTOM_UNIT_VALUE
// from the General Inventory Request feature.
//
// All calculation shown here is a LIVE PREVIEW only — the real, authoritative
// Opening Inventory Quantity / Stock Unit Cost / Opening Stock Value
// are recomputed server-side in addNewMaterialAction from the same raw
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
// Quantities: up to 3 decimals, no trailing zeros (0, 10, 200, 2.5).
function fmtQty(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toFixed(3))) : "0";
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

  const [purchaseUnit, setPurchaseUnit] = useState(DEFAULT_UNIT);
  const [customPurchaseUnit, setCustomPurchaseUnit] = useState("");
  const [useConversion, setUseConversion] = useState(false);
  // Starts blank on purpose: never pre-selected to PCS (or to the purchase
  // unit), so the viewer must make an explicit choice once the stock unit
  // differs from the purchase unit. Kept across toggling the checkbox.
  const [inventoryUnit, setInventoryUnit] = useState("");
  const [customInventoryUnit, setCustomInventoryUnit] = useState("");
  const [conversionQty, setConversionQty] = useState("");
  // Mirrored only to show the entered alert levels back with their unit.
  const [minimumStock, setMinimumStock] = useState("");
  const [reorderQty, setReorderQty] = useState("");

  // OFF by default: the normal save is register-only, zero balance.
  const [openingStockOn, setOpeningStockOn] = useState(false);
  const [purchaseQty, setPurchaseQty] = useState("");
  const [purchaseUnitCost, setPurchaseUnitCost] = useState("");

  const purchaseUnitName = purchaseUnit === CUSTOM_UNIT_VALUE ? customPurchaseUnit.trim() : purchaseUnit;
  // "" while a different stock unit is required but not chosen yet.
  const stockUnitName = useConversion
    ? inventoryUnit === CUSTOM_UNIT_VALUE
      ? customInventoryUnit.trim()
      : inventoryUnit
    : purchaseUnitName;
  const purchaseUnitText = purchaseUnitName || "purchase unit";
  const stockUnitText = stockUnitName || "stock unit";
  const sameUnitChosen =
    useConversion && stockUnitName !== "" && stockUnitName.toLowerCase() === purchaseUnitName.toLowerCase();

  // One formula covers both the same-unit and different-unit cases:
  // conversion factor is 1 unless a real conversion is both enabled and
  // entered. Purchase Quantity only counts while opening stock is ON, so
  // this preview never disagrees with what the server will save.
  const purchaseQtyNum = openingStockOn ? Number(purchaseQty) || 0 : 0;
  const conversionNum = useConversion ? Number(conversionQty) || 0 : 0;
  const conversionFactor = conversionNum > 0 ? conversionNum : 1;
  const openingInventoryQty = purchaseQtyNum * conversionFactor;
  const purchaseUnitCostNum = openingStockOn && purchaseUnitCost ? Number(purchaseUnitCost) : null;
  const stockUnitCost = purchaseUnitCostNum !== null ? purchaseUnitCostNum / conversionFactor : null;
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
              <label htmlFor="nm-category" className={lbl}>
                Category <span className="text-[#ED1C24]">*</span>
              </label>
              <select
                id="nm-category"
                name="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
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
                Stock Unit <span className="text-[#ED1C24]">*</span>
              </label>
              {/* Always a read-only display here: it follows Purchase Unit
                  (Section 3) unless "Purchase unit is different from stock
                  unit" is on, in which case it shows the unit chosen next
                  to that checkbox. The server treats Stock Unit = Purchase
                  Unit when the checkbox is off (see addNewMaterialAction). */}
              <p className={cn(inp, "flex items-center bg-gray-50 text-[#4B5563]")}>
                {stockUnitName ? (
                  <>
                    <span className="font-semibold text-[#111827]">{stockUnitName}</span>
                    {!useConversion && <span className="ml-1.5 text-xs text-[#9CA3AF]">same as Purchase Unit</span>}
                  </>
                ) : (
                  <span className="text-xs text-[#9CA3AF]">
                    {useConversion ? "Select stock unit below" : "Enter the purchase unit below"}
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-[#9CA3AF]">The unit used for inventory balance and material issue.</p>
            </div>
            <div>
              <label className={lbl}>Opening Inventory Quantity</label>
              {/* Always calculated, never typed, so it cannot disagree with
                  what is saved: 0 unless "Add opening stock now" is on. */}
              <p className={cn(inp, "flex items-center bg-gray-50 font-semibold text-[#111827]")}>
                {fmtQty(openingInventoryQty)} {stockUnitName}
              </p>
              <p className="mt-1 text-xs text-[#9CA3AF]">
                {!openingStockOn ? (
                  "By default, this only registers the material. Stock balance stays 0 until material is received."
                ) : !useConversion ? (
                  "Opening Inventory Quantity = Purchase Quantity"
                ) : (
                  <>
                    Opening Inventory Quantity = Purchase Quantity × Conversion Quantity
                    {conversionNum > 0 && (
                      <>
                        : {fmtQty(purchaseQtyNum)} {purchaseUnitText} × {fmtQty(conversionNum)} {stockUnitText} ={" "}
                        {fmtQty(openingInventoryQty)} {stockUnitText}
                      </>
                    )}
                  </>
                )}
              </p>
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#111827]">
            <input
              type="checkbox"
              name="add_opening_stock"
              checked={openingStockOn}
              onChange={(e) => setOpeningStockOn(e.target.checked)}
              className="h-4 w-4 accent-[#ED1C24]"
              disabled={isPending}
            />
            Add opening stock now
          </label>
          <p className="mt-0.5 text-xs text-[#9CA3AF]">Use this only if physical stock is already available in store.</p>

          <p className="mt-4 text-xs font-bold text-[#4B5563]">Optional stock alert settings</p>
          <p className="mt-0.5 text-xs text-[#9CA3AF]">Leave blank if not needed now.</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
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
                inputMode="decimal"
                placeholder="e.g. 20"
                value={minimumStock}
                onChange={(e) => setMinimumStock(e.target.value)}
                className={inp}
                disabled={isPending}
              />
              <p className="mt-1 text-xs text-[#9CA3AF]">Below this balance, the material shows as Low Stock.</p>
              {minimumStock.trim() !== "" && (
                <p className="mt-0.5 text-xs font-semibold text-[#111827]">
                  Minimum Stock Level: {fmtQty(Number(minimumStock))} {stockUnitText}
                </p>
              )}
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
                inputMode="decimal"
                placeholder="e.g. 100"
                value={reorderQty}
                onChange={(e) => setReorderQty(e.target.value)}
                className={inp}
                disabled={isPending}
              />
              <p className="mt-1 text-xs text-[#9CA3AF]">Suggested quantity to reorder when stock is low.</p>
              {reorderQty.trim() !== "" && (
                <p className="mt-0.5 text-xs font-semibold text-[#111827]">
                  Reorder Quantity: {fmtQty(Number(reorderQty))} {stockUnitText}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Section 3 — Cost / Purchase Unit */}
        <div className="border-t border-[#F3F4F6] pt-5">
          <p className="mb-3 text-[11px] font-black uppercase tracking-wide text-[#9CA3AF]">3. Cost / Purchase Unit</p>
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
                  required
                  placeholder="e.g. BARREL"
                  aria-label="Custom purchase unit"
                  className={cn(inp, "mt-1.5")}
                  disabled={isPending}
                />
              )}
              <p className="mt-1 text-xs text-[#9CA3AF]">The unit used when buying the material from supplier.</p>
            </div>
            <div>
              <label htmlFor="nm-purchase-qty" className={lbl}>
                Purchase Quantity {openingStockOn && <span className="text-[#ED1C24]">*</span>}
              </label>
              {/* Only used for opening stock. Disabled (and so not posted)
                  while "Add opening stock now" is off. */}
              <input
                id="nm-purchase-qty"
                type="number"
                name="purchase_quantity"
                min="0.001"
                step="0.001"
                inputMode="decimal"
                required={openingStockOn}
                value={openingStockOn ? purchaseQty : ""}
                onChange={(e) => setPurchaseQty(e.target.value)}
                placeholder={openingStockOn ? "e.g. 1" : "0"}
                className={cn(inp, !openingStockOn && "bg-gray-50")}
                disabled={isPending || !openingStockOn}
              />
              <p className="mt-1 text-xs text-[#9CA3AF]">
                {openingStockOn
                  ? `Quantity already in store, in ${purchaseUnitText}.`
                  : "Needed only when “Add opening stock now” is ticked."}
              </p>
            </div>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#111827]">
            <input
              type="checkbox"
              name="use_conversion"
              checked={useConversion}
              onChange={(e) => setUseConversion(e.target.checked)}
              className="h-4 w-4 accent-[#ED1C24]"
              disabled={isPending}
            />
            Purchase unit is different from stock unit
          </label>
          <p className="mt-0.5 text-xs text-[#9CA3AF]">
            Use this when the supplier sells in one unit but inventory is tracked in another unit. Example: 1 BARREL = 120 LITER.
          </p>

          {/* Conversion always reads purchase unit first, stock unit
              second: 1 [Purchase Unit] = [Conversion Quantity] [Stock Unit].
              The purchase unit shown here is the one selected above — only
              the stock unit and the quantity are chosen in this box. */}
          {useConversion && (
            <div className="mt-2 grid gap-3 rounded-md bg-gray-50 p-3 sm:grid-cols-3">
              <div>
                <span className={lbl}>Purchase Unit</span>
                <p className={cn(inp, "flex items-center bg-white font-semibold text-[#111827]")}>
                  1 {purchaseUnitText}
                </p>
                <p className="mt-1 text-xs text-[#9CA3AF]">Selected above.</p>
              </div>
              <div>
                <label htmlFor="nm-conversion-qty" className={lbl}>
                  Conversion Quantity <span className="text-[#ED1C24]">*</span>
                </label>
                <input
                  id="nm-conversion-qty"
                  type="number"
                  name="conversion_quantity"
                  min="0.0001"
                  step="0.0001"
                  inputMode="decimal"
                  required
                  placeholder="e.g. 120"
                  value={conversionQty}
                  onChange={(e) => setConversionQty(e.target.value)}
                  className={inp}
                  disabled={isPending}
                />
                <p className="mt-1 text-xs text-[#9CA3AF]">How many stock units are inside 1 purchase unit.</p>
              </div>
              <div>
                <label htmlFor="nm-inventory-unit" className={lbl}>
                  Stock Unit <span className="text-[#ED1C24]">*</span>
                </label>
                <select
                  id="nm-inventory-unit"
                  name="inventory_unit"
                  value={inventoryUnit}
                  onChange={(e) => setInventoryUnit(e.target.value)}
                  required
                  className={inp}
                  disabled={isPending}
                >
                  <option value="" disabled>Select stock unit</option>
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
                    required
                    placeholder="e.g. LITER"
                    aria-label="Custom stock unit"
                    className={cn(inp, "mt-1.5")}
                    disabled={isPending}
                  />
                )}
                <p className="mt-1 text-xs text-[#9CA3AF]">The unit used for inventory balance and material issue.</p>
              </div>
              {sameUnitChosen ? (
                <p className="text-xs font-semibold text-[#DC2626] sm:col-span-3">
                  Stock unit is the same as purchase unit. Choose a different stock unit, or untick “Purchase unit is
                  different from stock unit”.
                </p>
              ) : (
                <p className="text-sm font-bold text-[#111827] sm:col-span-3">
                  1 {purchaseUnitText} = {conversionNum > 0 ? fmtQty(conversionNum) : "?"} {stockUnitText}
                </p>
              )}
            </div>
          )}

          {/* Cost: cost-permitted viewers only, and only together with real
              opening stock — a register-only save records no cost or value. */}
          {canViewCosts && openingStockOn && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="nm-purchase-cost" className={lbl}>
                    Purchase Unit Cost (KWD) <span className="font-normal text-[#9CA3AF]">Optional</span>
                  </label>
                  <input
                    id="nm-purchase-cost"
                    type="number"
                    name="purchase_unit_cost"
                    min="0"
                    step="0.001"
                    inputMode="decimal"
                    placeholder="0.000"
                    value={purchaseUnitCost}
                    onChange={(e) => setPurchaseUnitCost(e.target.value)}
                    className={inp}
                    disabled={isPending}
                  />
                  <p className="mt-1 text-xs text-[#9CA3AF]">Price for one {purchaseUnitText}.</p>
                </div>
                <div>
                  <label className={lbl}>Stock Unit Cost (KWD)</label>
                  <p className={cn(inp, "flex items-center bg-gray-50 font-semibold text-[#111827]")}>
                    {stockUnitCost !== null ? fmt3(stockUnitCost) : "—"}
                    <span className="ml-1.5 text-xs font-normal text-[#9CA3AF]">per {stockUnitText}</span>
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <label className={lbl}>Opening Stock Value (KWD)</label>
                <p className={cn(inp, "flex items-center bg-gray-50 font-semibold text-[#111827]")}>
                  {fmt3(openingStockValue)}
                </p>
                <p className="mt-1 text-xs text-[#9CA3AF]">Purchase Quantity × Purchase Unit Cost, calculated automatically.</p>
              </div>
            </>
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
