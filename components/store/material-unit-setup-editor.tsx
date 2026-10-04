"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { updateMaterialUnitSetupAction, type MaterialUnitSetupState } from "@/app/actions/offline-inventory";
import { GENERAL_INVENTORY_UNIT_OPTIONS, CUSTOM_UNIT_VALUE } from "@/components/store/general-inventory-units";
import type { BalanceItem } from "@/components/store/offline-inventory-types";
import { unitPairKey, unitsLookReversed } from "@/lib/materials/request-pricing";

// Inventory-First Material Request Workflow — the material's Unit Setup as
// shown in its Inventory detail view, and the place to set or correct it
// ("Edit units in Inventory" from a Materials Request lands here). Stock
// Unit is the material's own unit and is never changed; only how it is
// bought. Editing is shown only to users who can manage Offline Inventory
// (the action enforces the same gate).

const unitOptions = [...GENERAL_INVENTORY_UNIT_OPTIONS, CUSTOM_UNIT_VALUE];
const fmtQty = (n: number) => String(Number(n.toFixed(4)));

export function MaterialUnitSetupEditor({ item, canEdit }: { item: BalanceItem; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  // Closes the editor and refreshes the inventory data right after a
  // successful save, inside the action itself (no effect needed).
  const [state, formAction, isPending] = useActionState<MaterialUnitSetupState, FormData>(async (prev, formData) => {
    const result = await updateMaterialUnitSetupAction(prev, formData);
    if (result?.ok) {
      setEditing(false);
      router.refresh();
    }
    return result;
  }, null);

  const saved = item.purchase_unit !== null && item.conversion_quantity !== null;
  const startPurchase = saved ? item.purchase_unit! : "BOX";
  const inList = (u: string) => (GENERAL_INVENTORY_UNIT_OPTIONS as readonly string[]).includes(u);
  const [useConversion, setUseConversion] = useState(saved);
  const [purchaseUnit, setPurchaseUnit] = useState(inList(startPurchase) ? startPurchase : CUSTOM_UNIT_VALUE);
  const [customPurchaseUnit, setCustomPurchaseUnit] = useState(inList(startPurchase) ? "" : startPurchase);
  const [conversion, setConversion] = useState(saved ? String(item.conversion_quantity) : "");
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);

  const purchaseName = purchaseUnit === CUSTOM_UNIT_VALUE ? customPurchaseUnit.trim() : purchaseUnit;
  const reversed = useConversion && unitsLookReversed(purchaseName, item.unit);
  const confirmed = reversed && confirmedKey === unitPairKey(purchaseName, item.unit);
  const blocked = reversed && !confirmed;
  const conversionNum = Number(conversion);

  const summary = saved
    ? `Purchase Unit ${item.purchase_unit} · 1 ${item.purchase_unit} = ${fmtQty(item.conversion_quantity!)} ${item.unit}`
    : `Bought in ${item.unit} (same as stock unit)`;

  return (
    <div className="mt-3 rounded-md border border-[#E5E7EB] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#9CA3AF]">Unit Setup</p>
          <p className="mt-0.5 text-sm font-semibold text-[#111827]">{summary}</p>
          <p className="text-[11px] text-[#9CA3AF]">Stock Unit: {item.unit}. Materials Requests use this setup.</p>
        </div>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-bold text-[#111827] hover:bg-gray-50"
          >
            Edit units
          </button>
        )}
      </div>

      {editing && (
        <form action={formAction} className="mt-3 space-y-2 border-t border-[#F3F4F6] pt-3">
          <input type="hidden" name="material_key" value={item.key} />
          <label className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
            <input
              type="checkbox"
              name="use_conversion"
              checked={useConversion}
              onChange={(e) => setUseConversion(e.target.checked)}
              className="h-4 w-4 accent-[#ED1C24]"
            />
            Purchase unit is different from stock unit ({item.unit})
          </label>
          {useConversion && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-xs font-semibold text-[#111827]">
                Purchase Unit
                <select
                  name="purchase_unit"
                  value={purchaseUnit}
                  onChange={(e) => setPurchaseUnit(e.target.value)}
                  className="mt-1 block w-36 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-sm"
                >
                  {unitOptions.map((u) => (
                    <option key={u} value={u}>
                      {u === CUSTOM_UNIT_VALUE ? "OTHER / CUSTOM" : u}
                    </option>
                  ))}
                </select>
                {purchaseUnit === CUSTOM_UNIT_VALUE && (
                  <input
                    name="custom_purchase_unit"
                    value={customPurchaseUnit}
                    onChange={(e) => setCustomPurchaseUnit(e.target.value)}
                    placeholder="e.g. PALLET"
                    aria-label="Custom purchase unit"
                    className="mt-1 block w-36 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-sm"
                  />
                )}
              </label>
              <label className="block text-xs font-semibold text-[#111827]">
                Conversion Quantity
                <input
                  name="conversion_quantity"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={conversion}
                  onChange={(e) => setConversion(e.target.value)}
                  placeholder="e.g. 9"
                  className="mt-1 block w-28 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-sm"
                />
              </label>
              {!blocked && (
                <p className="pb-1.5 text-sm font-black text-[#111827]">
                  1 {purchaseName || "purchase unit"} = {conversionNum > 0 ? fmtQty(conversionNum) : "?"} {item.unit}
                </p>
              )}
            </div>
          )}
          {blocked && (
            <div role="alert" className="rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-black">Units look reversed.</p>
              <p className="text-xs">
                {item.unit} is a pack unit and {purchaseName} a piece/measure unit. This material is counted in {item.unit}, so it
                is usually bought in {item.unit} too (untick the option), or in a bigger pack.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setUseConversion(false)}
                  className="rounded-md bg-[#ED1C24] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#c8181e]"
                >
                  Fix automatically
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmedKey(unitPairKey(purchaseName, item.unit))}
                  className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
                >
                  Keep as entered
                </button>
              </div>
            </div>
          )}
          {confirmed && (
            <>
              <input type="hidden" name="units_confirmed" value="1" />
              <p className="text-xs font-semibold text-amber-700">Units confirmed manually.</p>
            </>
          )}
          {state?.ok === false && <p className="text-xs font-semibold text-[#DC2626]">{state.error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending || blocked}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#c8181e] disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Save unit setup
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-[#E5E7EB] bg-white px-4 py-1.5 text-xs font-bold text-[#4B5563] hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-[#9CA3AF]">Affects new Materials Requests only. Saved requests keep their conversion.</p>
        </form>
      )}
    </div>
  );
}
