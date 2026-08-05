"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2, Package } from "lucide-react";

import { issueOfflineMaterialAction, type OfflineMovementState } from "@/app/actions/offline-inventory";
import {
  inputCls as inp,
  labelCls as lbl,
  todayStr,
  type BalanceItem,
  type WorkOrderOption,
} from "@/components/store/offline-inventory-types";
import { useLargeFormModal } from "@/components/ui/large-form-modal";
import { cn } from "@/lib/utils";

export interface IssueMaterialFormProps {
  availableItems: BalanceItem[];
  workOrders: WorkOrderOption[];
  // Large Popup Conversion — see the matching prop in ReceiveMaterialForm.
  modalMode?: boolean;
  presetMaterialKey?: string | null;
  // Required Materials Issue and Shortage Tracking Unit 6: pre-selects the
  // "Related Job Card" dropdown when arriving from a Job Card's Materials
  // section "Issue" link (`?workOrder=<id>` outside a modal,
  // `presetWorkOrderId` prop inside one) — so an issue made from that link
  // is correctly attributed to the Job Card's fulfillment calculation
  // without the Store Keeper having to find it again in the list.
  presetWorkOrderId?: string | null;
}

export function IssueMaterialForm({
  availableItems,
  workOrders,
  modalMode = false,
  presetMaterialKey = null,
  presetWorkOrderId = null,
}: IssueMaterialFormProps) {
  const router = useRouter();
  const modal = useLargeFormModal();
  const searchParams = useSearchParams();
  const preselectedKey = modalMode ? presetMaterialKey : searchParams.get("material");
  const preselectedWorkOrderId = modalMode ? presetWorkOrderId : searchParams.get("workOrder");

  const [state, formAction, isPending] = useActionState<OfflineMovementState, FormData>(
    issueOfflineMaterialAction,
    null
  );
  const [selectedKey, setSelectedKey] = useState(preselectedKey ?? "");
  const [relatedWoId, setRelatedWoId] = useState(preselectedWorkOrderId ?? "");

  useEffect(() => {
    if (state?.ok) {
      router.push("/store/offline-inventory?success=material-issued");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  const selectedItem = availableItems.find((b) => b.key === selectedKey) ?? null;

  // No available balance — show informational state instead of a form
  if (availableItems.length === 0) {
    const emptyState = (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <Package className="h-10 w-10 text-[#9CA3AF]" aria-hidden />
        <div>
          <p className="font-bold text-[#111827]">No materials available to issue</p>
          <p className="mt-1 text-sm text-[#4B5563]">
            Add initial stock or receive materials first before issuing.
          </p>
        </div>
        {modalMode ? (
          <button
            type="button"
            onClick={() => modal?.requestClose()}
            className="rounded-md border border-[#E5E7EB] bg-white px-5 py-2 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
          >
            Close
          </button>
        ) : (
          <Link
            href="/store/offline-inventory"
            className="rounded-md border border-[#E5E7EB] bg-white px-5 py-2 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
          >
            Back to Offline Inventory Control
          </Link>
        )}
      </div>
    );
    if (modalMode) return emptyState;
    return (
      <div className="mx-auto w-full max-w-2xl rounded-md border border-[#E5E7EB] bg-white p-6 shadow-sm">
        {emptyState}
      </div>
    );
  }

  const formEl = (
      <form action={formAction} className="space-y-4">
        {state?.ok === false && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{state.error}</span>
          </div>
        )}

        {/* Hidden identity fields — auto-set from the selected balance item */}
        <input type="hidden" name="part_id"              value={selectedItem?.part_id ?? ""} />
        <input type="hidden" name="manual_material_name" value={selectedItem?.manual_material_name ?? ""} />
        <input type="hidden" name="manual_part_number"   value={selectedItem?.part_number ?? ""} />
        <input type="hidden" name="ss_rec_code"          value={selectedItem?.ss_rec_code ?? ""} />
        <input type="hidden" name="category"             value={selectedItem?.category ?? "Other"} />
        <input type="hidden" name="unit"                 value={selectedItem?.unit ?? "PCS"} />

        {/* Date */}
        <div>
          <label htmlFor="i-date" className={lbl}>
            Issued Date <span className="text-[#ED1C24]">*</span>
          </label>
          <input
            id="i-date"
            type="date"
            name="movement_date"
            required
            defaultValue={todayStr()}
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Available material selector */}
        <div>
          <label htmlFor="i-material" className={lbl}>
            Available Material <span className="text-[#ED1C24]">*</span>
          </label>
          <select
            id="i-material"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            className={inp}
            disabled={isPending}
          >
            <option value="">Select available material…</option>
            {availableItems.map((item) => (
              <option key={item.key} value={item.key}>
                {item.display_name}
                {item.part_number ? ` (${item.part_number})` : ""}{" "}
                — Available:{" "}
                {item.balance.toLocaleString("en-US", { maximumFractionDigits: 3 })} {item.unit}
              </option>
            ))}
          </select>
          {selectedItem && (
            <p className="mt-1.5 text-xs font-semibold text-[#16A34A]">
              Current Balance:{" "}
              {selectedItem.balance.toLocaleString("en-US", { maximumFractionDigits: 3 })}{" "}
              {selectedItem.unit}
            </p>
          )}
        </div>

        {/* Category — display-only, follows the selected material */}
        <div>
          <label htmlFor="i-category" className={lbl}>Category</label>
          <input
            id="i-category"
            type="text"
            value={selectedItem?.category ?? ""}
            readOnly
            placeholder="—"
            className={cn(inp, "bg-gray-50 text-[#6B7280] cursor-default")}
            disabled={isPending}
          />
        </div>

        {/* Qty + Unit (unit is read-only from the selected item) */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="i-qty" className={lbl}>
              Quantity Issued <span className="text-[#ED1C24]">*</span>
            </label>
            <input
              id="i-qty"
              type="number"
              name="quantity"
              min="1"
              step="1"
              inputMode="numeric"
              max={selectedItem ? Math.floor(selectedItem.balance) : undefined}
              required
              placeholder="0"
              className={inp}
              disabled={isPending || !selectedItem}
            />
          </div>
          <div>
            <label htmlFor="i-unit" className={lbl}>Unit</label>
            <input
              id="i-unit"
              type="text"
              value={selectedItem?.unit ?? ""}
              readOnly
              placeholder="—"
              className={cn(inp, "bg-gray-50 text-[#6B7280] cursor-default")}
              disabled={isPending}
            />
          </div>
        </div>

        {/* Issued to */}
        <div>
          <label htmlFor="i-to" className={lbl}>
            Used by / Sent to <span className="text-[#ED1C24]">*</span>
          </label>
          <input
            id="i-to"
            type="text"
            name="counterparty"
            required
            placeholder="Technician, location, or department"
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Purpose */}
        <div>
          <label htmlFor="i-purpose" className={lbl}>Purpose</label>
          <input
            id="i-purpose"
            type="text"
            name="purpose"
            placeholder="e.g. Equipment repair, PM work"
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Related job card */}
        <div>
          <label htmlFor="i-wo" className={lbl}>Related Job Card</label>
          <select
            id="i-wo"
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
          {relatedWoId && !workOrders.some((wo) => wo.id === relatedWoId) && (
            <p className="mt-1 text-xs text-[#9CA3AF]">
              Job Card not in the recent list — issuing will still link to it correctly.
            </p>
          )}
        </div>

        {/* Receiver name */}
        <div>
          <label htmlFor="i-receiver" className={lbl}>Receiver name</label>
          <input
            id="i-receiver"
            type="text"
            name="receiver_name"
            placeholder="Name of person receiving"
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Reference number */}
        <div>
          <label htmlFor="i-ref" className={lbl}>Reference Number</label>
          <input
            id="i-ref"
            type="text"
            name="reference_number"
            placeholder="Optional"
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Remarks */}
        <div>
          <label htmlFor="i-remarks" className={lbl}>Remarks</label>
          <textarea
            id="i-remarks"
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
            disabled={isPending || !selectedItem}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#111827] py-2.5 text-sm font-bold text-white transition hover:bg-gray-700 disabled:opacity-60 sm:flex-none sm:px-8"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? "Saving…" : "Issue Material"}
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
