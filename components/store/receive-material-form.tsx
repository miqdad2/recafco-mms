"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";

import { receiveOfflineMaterialAction, type OfflineMovementState } from "@/app/actions/offline-inventory";
import {
  MATERIAL_CATEGORIES,
  UNITS,
  inputCls as inp,
  labelCls as lbl,
  todayStr,
  type BalanceItem,
  type WorkOrderOption,
} from "@/components/store/offline-inventory-types";
import { useLargeFormModal } from "@/components/ui/large-form-modal";
import { cn } from "@/lib/utils";

export interface ReceiveMaterialFormProps {
  knownMaterials: BalanceItem[];
  workOrders: WorkOrderOption[];
  // Large Popup Conversion: when rendered inside <LargeFormModal> from the
  // Offline Inventory Control page, the parent resolves its own
  // ?receiveMaterial= query param into this prop instead of the form reading
  // ?material= off its own standalone-page URL — the two entry points never
  // conflict since presetMaterialKey only applies when modalMode is true.
  modalMode?: boolean;
  presetMaterialKey?: string | null;
}

export function ReceiveMaterialForm({
  knownMaterials,
  workOrders,
  modalMode = false,
  presetMaterialKey = null,
}: ReceiveMaterialFormProps) {
  const router = useRouter();
  const modal = useLargeFormModal();
  const searchParams = useSearchParams();
  const preselectedKey = modalMode ? presetMaterialKey : searchParams.get("material");

  const [state, formAction, isPending] = useActionState<OfflineMovementState, FormData>(
    receiveOfflineMaterialAction,
    null
  );
  // Row-action pre-select (Simplification Task 6) — if the key matches a
  // known material, seed identity fields the same way onMaterialChange() would.
  const preselectedMaterial = preselectedKey
    ? knownMaterials.find((m) => m.key === preselectedKey) ?? null
    : null;
  const [selectedKey, setSelectedKey]     = useState(preselectedMaterial ? preselectedKey! : "");
  const [unit, setUnit]                   = useState(preselectedMaterial?.unit ?? "PCS");
  const [manualPartNum, setManualPartNum] = useState(preselectedMaterial?.part_number ?? "");
  const [manualSsCode, setManualSsCode]   = useState(preselectedMaterial?.ss_rec_code ?? "");
  const [manualCategory, setManualCategory] = useState("");
  const [relatedWoId, setRelatedWoId]     = useState("");

  useEffect(() => {
    if (state?.ok) {
      router.push("/store/offline-inventory?success=material-received");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  const isManual      = selectedKey === "";
  const selectedKnown = isManual ? null : (knownMaterials.find((m) => m.key === selectedKey) ?? null);
  const unitInList    = (UNITS as readonly string[]).includes(unit);

  function onMaterialChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const key = e.target.value;
    setSelectedKey(key);
    if (!key) {
      setUnit("PCS");
      setManualPartNum("");
      setManualSsCode("");
    } else {
      const known = knownMaterials.find((m) => m.key === key);
      if (known) {
        setUnit(known.unit);
        setManualPartNum(known.part_number ?? "");
        setManualSsCode(known.ss_rec_code ?? "");
      }
    }
  }

  const formEl = (
      <form action={formAction} className="space-y-4">
        {state?.ok === false && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{state.error}</span>
          </div>
        )}

        {/* Hidden identity fields when a known material is selected */}
        {!isManual && selectedKnown && (
          <>
            <input type="hidden" name="part_id"              value={selectedKnown.part_id ?? ""} />
            <input type="hidden" name="manual_material_name" value={selectedKnown.manual_material_name ?? ""} />
          </>
        )}

        {/* Date */}
        <div>
          <label htmlFor="r-date" className={lbl}>
            Received Date <span className="text-[#ED1C24]">*</span>
          </label>
          <input
            id="r-date"
            type="date"
            name="movement_date"
            required
            defaultValue={todayStr()}
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Material selector — previously received materials or manual entry */}
        <div>
          <label htmlFor="r-material" className={lbl}>
            Material <span className="text-[#ED1C24]">*</span>
          </label>
          <select
            id="r-material"
            value={selectedKey}
            onChange={onMaterialChange}
            className={inp}
            disabled={isPending}
          >
            <option value="">Select existing material or enter manually</option>
            {knownMaterials.map((m) => (
              <option key={m.key} value={m.key}>
                {m.display_name}
                {m.part_number ? ` (${m.part_number})` : ""} — {m.unit}
              </option>
            ))}
          </select>
          {!isManual && selectedKnown && (
            <p className="mt-1.5 text-xs font-semibold text-[#4B5563]">
              Current Balance:{" "}
              <span className="font-black text-[#111827]">
                {selectedKnown.balance.toLocaleString("en-US", { maximumFractionDigits: 3 })} {selectedKnown.unit}
              </span>
            </p>
          )}
        </div>

        {/* Manual name — shown when no known material is selected */}
        {isManual && (
          <div>
            <label htmlFor="r-manual-name" className={lbl}>
              Material Name <span className="text-[#ED1C24]">*</span>
            </label>
            <input
              id="r-manual-name"
              type="text"
              name="manual_material_name"
              required
              placeholder="e.g. Hydraulic Hose 12 mm"
              className={inp}
              disabled={isPending}
            />
          </div>
        )}

        {/* Category */}
        <div>
          <label htmlFor="r-category" className={lbl}>
            Category <span className="text-[#ED1C24]">*</span>
            {!isManual && <span className="ml-1 font-normal text-[#9CA3AF]">(auto-filled)</span>}
          </label>
          {isManual ? (
            <select
              id="r-category"
              name="category"
              value={manualCategory}
              onChange={(e) => setManualCategory(e.target.value)}
              required
              className={inp}
              disabled={isPending}
            >
              <option value="" disabled>Select a category</option>
              {MATERIAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          ) : (
            <>
              <input
                type="text"
                value={selectedKnown?.category ?? "Other"}
                readOnly
                className={cn(inp, "bg-gray-50 text-[#6B7280] cursor-default")}
                disabled={isPending}
              />
              <input type="hidden" name="category" value={selectedKnown?.category ?? "Other"} />
            </>
          )}
        </div>

        {/* Part number */}
        <div>
          <label htmlFor="r-partnum" className={lbl}>
            Part Number
            {!isManual && <span className="ml-1 font-normal text-[#9CA3AF]">(auto-filled)</span>}
          </label>
          <input
            id="r-partnum"
            type="text"
            name="manual_part_number"
            value={isManual ? manualPartNum : (selectedKnown?.part_number ?? "")}
            onChange={isManual ? (e) => setManualPartNum(e.target.value) : undefined}
            readOnly={!isManual}
            placeholder="Optional"
            className={cn(inp, !isManual && "bg-gray-50 text-[#6B7280] cursor-default")}
            disabled={isPending}
          />
        </div>

        {/* SS Rec. Code */}
        <div>
          <label htmlFor="r-sscode" className={lbl}>
            SS Rec. Code
            {!isManual && <span className="ml-1 font-normal text-[#9CA3AF]">(auto-filled)</span>}
          </label>
          <input
            id="r-sscode"
            type="text"
            name="ss_rec_code"
            value={isManual ? manualSsCode : (selectedKnown?.ss_rec_code ?? "")}
            onChange={isManual ? (e) => setManualSsCode(e.target.value) : undefined}
            readOnly={!isManual}
            placeholder="Optional"
            className={cn(inp, !isManual && "bg-gray-50 text-[#6B7280] cursor-default")}
            disabled={isPending}
          />
          <p className="mt-1 text-xs text-[#9CA3AF]">Reserved for SAP material/reference mapping.</p>
        </div>

        {/* Qty + Unit */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="r-qty" className={lbl}>
              Quantity Received <span className="text-[#ED1C24]">*</span>
            </label>
            <input
              id="r-qty"
              type="number"
              name="quantity"
              min="1"
              step="1"
              inputMode="numeric"
              required
              placeholder="0"
              className={inp}
              disabled={isPending}
            />
          </div>
          <div>
            <label htmlFor="r-unit" className={lbl}>
              Unit <span className="text-[#ED1C24]">*</span>
            </label>
            <select
              id="r-unit"
              name="unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              required
              className={inp}
              disabled={isPending}
            >
              {!unitInList && <option value={unit}>{unit}</option>}
              {UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Received from */}
        <div>
          <label htmlFor="r-from" className={lbl}>Received From</label>
          <input
            id="r-from"
            type="text"
            name="counterparty"
            placeholder="Supplier / sender name"
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Reference number */}
        <div>
          <label htmlFor="r-ref" className={lbl}>Reference Number</label>
          <input
            id="r-ref"
            type="text"
            name="reference_number"
            placeholder="e.g. LPO-2026-001, DO-123"
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Related job card */}
        <div>
          <label htmlFor="r-wo" className={lbl}>Related Job Card</label>
          <select
            id="r-wo"
            name="related_work_order_id"
            value={relatedWoId}
            onChange={(e) => setRelatedWoId(e.target.value)}
            className={inp}
            disabled={isPending}
          >
            <option value="">No job card</option>
            {workOrders.map((wo) => (
              <option key={wo.id} value={wo.id}>
                {wo.work_order_number ?? `Job Card ${wo.id.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Attachment — optional, requires a Related Job Card to link the file to */}
        <div className="w-full max-w-full overflow-x-hidden rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
          <label className={lbl}>
            Attachment / Photo <span className="font-normal text-[#9CA3AF]">— Optional</span>
          </label>
          {relatedWoId ? (
            <>
              <div className="mb-3 min-w-0 w-full">
                <select
                  name="attachment_type"
                  defaultValue="Received Material Photo"
                  className={cn(inp, "w-full min-w-0")}
                  disabled={isPending}
                >
                  {["Received Material Photo", "Delivery Note", "Invoice", "Supplier Document", "Other Document"].map(
                    (c) => (
                      <option key={c} value={c}>{c}</option>
                    )
                  )}
                </select>
              </div>
              <div className="grid w-full max-w-full grid-cols-1 gap-3 md:grid-cols-2">
                <div className="min-w-0 w-full">
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Upload File</label>
                  <div className="w-full max-w-full overflow-hidden rounded-md border border-[#E5E7EB] bg-white p-2">
                    <input
                      type="file"
                      name="attachment_file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx"
                      className="focus-ring block w-full max-w-full min-w-0 truncate text-sm file:mr-2 file:rounded file:border-0 file:bg-[#111827] file:px-2 file:py-1 file:text-xs file:font-bold file:text-white"
                      disabled={isPending}
                    />
                  </div>
                </div>
                <div className="min-w-0 w-full">
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Take Photo</label>
                  <div className="w-full max-w-full overflow-hidden rounded-md border border-[#E5E7EB] bg-white p-2">
                    <input
                      type="file"
                      name="attachment_file"
                      accept="image/*"
                      capture="environment"
                      aria-label="Take photo with camera"
                      className="focus-ring block w-full max-w-full min-w-0 truncate text-sm file:mr-2 file:rounded file:border-0 file:bg-[#4B5563] file:px-2 file:py-1 file:text-xs file:font-bold file:text-white"
                      disabled={isPending}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-[#9CA3AF]">Use camera to capture received material photo.</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-[#9CA3AF]">
                Upload a delivery note, invoice, supporting file, or take a photo of the received material.
                <br />
                Accepted: PDF, JPG, JPEG, PNG, WEBP, XLS, XLSX, DOC, DOCX
              </p>
            </>
          ) : (
            <p className="text-xs text-[#9CA3AF]">
              Select a Related Job Card above to attach a delivery note, invoice, or photo with this receipt.
            </p>
          )}
        </div>

        {/* Remarks */}
        <div>
          <label htmlFor="r-remarks" className={lbl}>Remarks</label>
          <textarea
            id="r-remarks"
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
            {isPending ? "Saving…" : "Receive Material"}
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
