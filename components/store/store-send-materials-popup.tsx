"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X, CheckCircle2, ArrowRight } from "lucide-react";

import { storeIssueModalAction, type StoreIssueModalState } from "@/app/actions/phase4";

// Store Guided Send Materials Popup Workflow Unit: Store completes a
// Materials Request send from one guided popup instead of navigating to the
// full Materials Request detail page. Reuses storeIssueModalAction, which
// itself reuses issueMaterials exactly as-is (Task 3) — this component only
// adds the guided UI around it.

export type StoreSendMaterialsData = {
  id: string;
  parts_request_number: string | null;
  status: string;
  work_order_id: string | null;
  work_order_number: string | null;
  work_order_status: string | null;
  problem_summary: string | null;
  asset_name: string | null;
  plate_number: string | null;
  items: {
    id: string;
    description: string;
    quantity_requested: number;
    issued_quantity: number;
    balance: number | undefined;
  }[];
};

function SendItemRow({ item }: { item: StoreSendMaterialsData["items"][number] }) {
  const remaining = Math.max(item.quantity_requested - item.issued_quantity, 0);
  const [qtyToSendNow, setQtyToSendNow] = useState(remaining);
  const newTotal = item.issued_quantity + qtyToSendNow;
  // Task 8: no "Offline Inventory"/"stock balance" wording — short, calm note only.
  const showNoBalanceNote = (item.balance ?? 0) <= 0;

  return (
    <div className="rounded-md border border-[#E5E7EB] p-3">
      <p className="text-base font-bold text-[#111827]">{item.description}</p>
      <p className="mt-1 text-xs text-[#6B7280]">
        Requested quantity: <span className="font-semibold text-[#111827]">{item.quantity_requested}</span>
        {" · "}Already sent: <span className="font-semibold text-[#111827]">{item.issued_quantity}</span>
        {" · "}Remaining: <span className="font-semibold text-[#111827]">{remaining}</span>
      </p>
      {showNoBalanceNote && (
        <p className="mt-1.5 text-xs text-amber-700">Store send will be recorded for Maintenance tracking.</p>
      )}
      <div className="mt-2">
        <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Quantity to send now</label>
        <input
          className="focus-ring w-full max-w-[160px] rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
          type="number"
          min="0"
          max={remaining}
          step="0.01"
          value={qtyToSendNow}
          onChange={(e) => {
            const raw = Number(e.target.value);
            const clamped = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), remaining) : 0;
            setQtyToSendNow(clamped);
          }}
        />
        <input type="hidden" name={`issued_${item.id}`} value={newTotal} />
      </div>
    </div>
  );
}

function SuccessPanel({ state, onClose }: { state: StoreIssueModalState; onClose: () => void }) {
  if (!state || !state.ok) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border border-green-200 bg-green-50 p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" aria-hidden />
        <div>
          <p className="text-sm font-black text-green-900">Materials sent successfully</p>
          <p className="mt-1 text-sm text-green-800">These materials were recorded for the Job Card.</p>
        </div>
      </div>
      <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-sm">
        <p>Materials sent: <span className="font-semibold text-[#111827]">{state.partsRequestNumber ?? "Materials Request"}</span></p>
        <p className="mt-1">Job Card: <span className="font-semibold text-[#111827]">{state.workOrderNumber ?? "-"}</span></p>
        <p className="mt-1">Materials Request status: <span className="font-semibold text-[#111827]">{state.status ?? "-"}</span></p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/store/offline-inventory/movements"
          className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
        >
          Open Sent Materials <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        {state.workOrderId && (
          <Link
            href={`/maintenance/work-orders/${state.workOrderId}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
          >
            Open Job Card <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export function StoreSendMaterialsPopup({
  data,
  closeHref = "/dashboard"
}: {
  data: StoreSendMaterialsData;
  closeHref?: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<StoreIssueModalState, FormData>(storeIssueModalAction, null);

  function close() {
    router.push(closeHref);
  }

  function closeAndRefresh() {
    router.push(closeHref);
    router.refresh();
  }

  const succeeded = state?.ok === true;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" aria-hidden="true" onClick={succeeded ? closeAndRefresh : close} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-materials-heading"
          className="relative flex w-full max-w-[600px] flex-col rounded-xl bg-white shadow-2xl max-h-[90vh]"
        >
          <div className="shrink-0 flex items-start justify-between gap-3 rounded-t-xl border-b border-[#E5E7EB] bg-[#F5F6F8] px-5 py-4">
            <div className="min-w-0">
              <p id="send-materials-heading" className="text-sm font-black text-[#111827]">Send Materials</p>
              <p className="mt-0.5 text-xs text-[#4B5563]">
                {data.parts_request_number ?? "Materials Request"}
                {data.work_order_number && <> · {data.work_order_number}</>}
              </p>
            </div>
            <button
              onClick={succeeded ? closeAndRefresh : close}
              className="mt-0.5 shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-200 hover:text-[#111827] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
            {succeeded ? (
              <SuccessPanel state={state} onClose={closeAndRefresh} />
            ) : (
              <form action={formAction} className="space-y-5">
                <input type="hidden" name="parts_request_id" value={data.id} />

                {/* Section 1 — Job Card */}
                <section className="rounded-md border border-[#E5E7EB] bg-[#F5F6F8] p-3">
                  <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Job Card</p>
                  <p className="mt-1 text-sm font-bold text-[#111827]">{data.work_order_number ?? "-"}</p>
                  {(data.asset_name || data.plate_number) && (
                    <p className="mt-0.5 text-xs text-[#4B5563]">
                      {data.asset_name ?? "-"}{data.plate_number ? ` - Plate ${data.plate_number}` : ""}
                    </p>
                  )}
                  {data.problem_summary && <p className="mt-0.5 text-xs text-[#4B5563]">{data.problem_summary}</p>}
                  {data.work_order_status && (
                    <p className="mt-1 text-xs font-semibold text-[#4B5563]">Job Card status: {data.work_order_status}</p>
                  )}
                </section>

                {/* Section 2 — Requested Materials */}
                <section>
                  <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Requested Materials</p>
                  <div className="space-y-2.5">
                    {data.items.map((item) => <SendItemRow key={item.id} item={item} />)}
                  </div>
                </section>

                {/* Section 3 — Confirmation */}
                <section className="space-y-2">
                  {state && !state.ok && state.error && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                      {state.error}
                    </div>
                  )}
                  <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Note (optional)</label>
                  <textarea
                    name="store_issue_comments"
                    placeholder="Remarks (optional)"
                    className="focus-ring min-h-16 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={isPending}
                      className="flex-1 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e] disabled:opacity-60"
                    >
                      {isPending ? "Sending…" : "Send Materials"}
                    </button>
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-md border border-[#E5E7EB] px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                  <Link
                    href={`/store/parts-requests/${data.id}`}
                    className="mt-1 inline-block text-xs font-bold text-[#4B5563] hover:text-[#111827] hover:underline"
                  >
                    Open Full Materials Request
                  </Link>
                </section>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
