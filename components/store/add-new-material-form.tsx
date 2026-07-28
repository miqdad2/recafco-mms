"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";

import { addNewMaterialAction, type OfflineMovementState } from "@/app/actions/offline-inventory";
import { MATERIAL_CATEGORIES, UNITS, inputCls as inp, labelCls as lbl } from "@/components/store/offline-inventory-types";
import { cn } from "@/lib/utils";

export function AddNewMaterialForm() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<OfflineMovementState, FormData>(
    addNewMaterialAction,
    null
  );
  const [unit, setUnit] = useState("PCS");
  const [category, setCategory] = useState("Other");

  useEffect(() => {
    if (state?.ok) {
      router.push("/store/offline-inventory?success=material-added");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  return (
    <div className="mx-auto w-full max-w-2xl rounded-md border border-[#E5E7EB] bg-white p-6 shadow-sm">
      <form action={formAction} className="space-y-4">
        {state?.ok === false && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{state.error}</span>
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
          </select>
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

        {/* Unit + Opening Balance */}
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
            <label htmlFor="nm-balance" className={lbl}>Opening Balance</label>
            <input
              id="nm-balance"
              type="number"
              name="opening_balance"
              min="0"
              step="1"
              inputMode="numeric"
              defaultValue="0"
              placeholder="0"
              className={inp}
              disabled={isPending}
            />
            <p className="mt-1 text-xs text-[#9CA3AF]">Leave as 0 to register the material now and receive quantity later.</p>
          </div>
        </div>

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
          <Link
            href="/store/offline-inventory"
            className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
