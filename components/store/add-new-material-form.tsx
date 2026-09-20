"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";

import { addNewMaterialAction, type OfflineMovementState } from "@/app/actions/offline-inventory";
import {
  MATERIAL_CATEGORIES,
  ADD_NEW_CATEGORY_VALUE,
  UNITS,
  inputCls as inp,
  labelCls as lbl,
} from "@/components/store/offline-inventory-types";
import { useLargeFormModal } from "@/components/ui/large-form-modal";
import { cn } from "@/lib/utils";

// Large Popup Conversion: `modalMode` is set when this form is rendered
// inside <LargeFormModal> from the Offline Inventory Control page instead of
// its own standalone /store/offline-inventory/add-material page — drops the
// outer page-level card wrapper (the modal shell already provides that) and
// routes Cancel through the modal's dirty-aware close instead of a plain
// link. Success handling is unchanged either way: the server action still
// redirects to /store/offline-inventory, which naturally drops the
// ?addMaterial= query param and closes the modal on success.
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
  const [unit, setUnit] = useState("PCS");
  const [category, setCategory] = useState("Other");
  const [newCategoryName, setNewCategoryName] = useState("");
  const isAddingCategory = category === ADD_NEW_CATEGORY_VALUE;
  // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 3 — both
  // optional and only rendered at all when canViewCosts (mirrors
  // components/store/new-part-wizard.tsx's own established Unit Price
  // pattern). Opening Stock Value is a live, client-side preview only —
  // the real, authoritative total is computed server-side in
  // addNewMaterialAction from these same two raw values.
  const [openingQty, setOpeningQty] = useState("0");
  const [openingUnitCost, setOpeningUnitCost] = useState("");
  const openingStockValue = openingUnitCost ? (Number(openingQty) || 0) * Number(openingUnitCost) : 0;

  useEffect(() => {
    if (state?.ok) {
      const params = new URLSearchParams({ success: "material-added" });
      if (state.category) params.set("category", state.category);
      router.push(`/store/offline-inventory?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  const formEl = (
      <form action={formAction} className="space-y-4">
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

        {/* Material Name */}
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

        {/* Category */}
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

        {/* Part Number */}
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

        {/* SS Rec. Code */}
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
          <p className="mt-1 text-xs text-[#9CA3AF]">Reserved for SAP material/reference mapping.</p>
        </div>

        {/* Unit + Initial Quantity */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="nm-unit" className={lbl}>
              Unit <span className="text-[#ED1C24]">*</span>
            </label>
            <select
              id="nm-unit"
              name="unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              required
              className={inp}
              disabled={isPending}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="nm-balance" className={lbl}>Initial Quantity</label>
            <input
              id="nm-balance"
              type="number"
              name="opening_balance"
              min="0"
              step="1"
              inputMode="numeric"
              value={openingQty}
              onChange={(e) => setOpeningQty(e.target.value)}
              placeholder="0"
              className={inp}
              disabled={isPending}
            />
            <p className="mt-1 text-xs text-[#9CA3AF]">
              Enter quantity already available when adding this material. Leave as 0 to register the material now and receive quantity later.
            </p>
          </div>
        </div>

        {/* Inventory Clarity, Low Stock, and Bulk Unit Balance Unit 10G.62,
            Task 3 — visible to every role (quantity/planning fields, not
            cost), unlike the Opening Unit Cost section below. Both optional. */}
        <div className="grid grid-cols-2 gap-3">
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

        {/* Inventory Cost and Stock Value Foundation Unit 10G.61, Task 3 —
            cost fields only shown to a viewer with cost permission. */}
        {canViewCosts && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="nm-unit-cost" className={lbl}>
                Opening Unit Cost (KWD) <span className="font-normal text-[#9CA3AF]">Optional</span>
              </label>
              <input
                id="nm-unit-cost"
                type="number"
                name="opening_unit_cost"
                min="0"
                step="0.001"
                placeholder="0.000"
                value={openingUnitCost}
                onChange={(e) => setOpeningUnitCost(e.target.value)}
                className={inp}
                disabled={isPending}
              />
              <p className="mt-1 text-xs text-[#9CA3AF]">
                Price for one {unit}. Can still be saved even if Initial Quantity is 0, as the latest cost for this material.
              </p>
            </div>
            <div>
              <label className={lbl}>Opening Stock Value (KWD)</label>
              <p className={cn(inp, "flex items-center bg-gray-50 font-semibold text-[#111827]")}>
                {openingStockValue.toFixed(3)}
              </p>
              <p className="mt-1 text-xs text-[#9CA3AF]">Initial Quantity × Opening Unit Cost, calculated automatically.</p>
            </div>
          </div>
        )}

        {/* Location / Bin */}
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

        {/* Remarks */}
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
