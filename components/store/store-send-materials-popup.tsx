"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X, CheckCircle2, ArrowRight } from "lucide-react";

import { storeIssueModalAction, type StoreIssueModalState } from "@/app/actions/phase4";
import { dispatchActionToast } from "@/lib/action-messages";

// Simplified Workflow Correction Unit: Data Entry or Supervisor/Manager
// records materials received against a Materials Request from one guided
// popup, instead of navigating to the full Materials Request detail page.
// Reuses storeIssueModalAction/issueMaterials exactly as-is (only the
// movement_type it records and this component's wording changed) — this
// component only adds the guided UI around it.
//
// Daily Activity Inline Materials Receive/Issue Modal Unit 10D: the optional
// `onClose` prop below lets an already-client parent (Daily Activity's
// board) embed this exact component instead of the URL-param-driven
// `closeHref` flow every other caller (dashboard, parts-requests pages,
// issue-materials page) still uses unchanged. When `onClose` is provided,
// this also skips the inline SuccessPanel in favor of an immediate
// close + standardized toast, matching Daily Activity's own "close modal,
// show toast, refresh" convention instead of navigation.

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
  // Unit 10G.14, Task 6 — default to the actual shortage (remaining minus
  // what's already available in Offline Inventory), not the full remaining
  // requirement, when a current balance is known. Falls back to the old
  // full-remaining default when `balance` is undefined (callers that don't
  // supply it, e.g. the standalone Materials Request page) — unchanged
  // behavior there. Still fully editable up to `remaining` either way.
  const shortage = item.balance !== undefined ? Math.max(remaining - Math.max(item.balance, 0), 0) : remaining;
  const [qtyReceivedNow, setQtyReceivedNow] = useState(shortage);
  const newTotal = item.issued_quantity + qtyReceivedNow;

  return (
    <div className="rounded-md border border-[#E5E7EB] p-3">
      <p className="text-base font-bold text-[#111827]">{item.description}</p>
      <p className="mt-1 text-xs text-[#6B7280]">
        Requested quantity: <span className="font-semibold text-[#111827]">{item.quantity_requested}</span>
        {" · "}Already received: <span className="font-semibold text-[#111827]">{item.issued_quantity}</span>
        {" · "}Remaining: <span className="font-semibold text-[#111827]">{remaining}</span>
      </p>
      <div className="mt-2">
        <label className="mb-1 block text-xs font-semibold text-[#4B5563]">Quantity received now</label>
        <input
          className="focus-ring w-full max-w-[160px] rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
          type="number"
          min="0"
          max={remaining}
          step="0.01"
          value={qtyReceivedNow}
          onChange={(e) => {
            const raw = Number(e.target.value);
            const clamped = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), remaining) : 0;
            setQtyReceivedNow(clamped);
          }}
        />
        <input type="hidden" name={`issued_${item.id}`} value={newTotal} />
      </div>
    </div>
  );
}

function SuccessPanel({ state, onClose }: { state: StoreIssueModalState; onClose: () => void }) {
  if (!state || !state.ok) return null;
  const displayStatus = state.status === "Issued" ? "Received" : state.status === "Partially Issued" ? "Requested (partially received)" : state.status ?? "-";
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border border-green-200 bg-green-50 p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" aria-hidden />
        <div>
          <p className="text-sm font-black text-green-900">Materials received successfully</p>
          <p className="mt-1 text-sm text-green-800">These materials were recorded in Offline Inventory Control, linked to this Job Card.</p>
        </div>
      </div>
      <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-sm">
        <p>Materials Request: <span className="font-semibold text-[#111827]">{state.partsRequestNumber ?? "Materials Request"}</span></p>
        <p className="mt-1">Job Card: <span className="font-semibold text-[#111827]">{state.workOrderNumber ?? "-"}</span></p>
        <p className="mt-1">Materials Request status: <span className="font-semibold text-[#111827]">{displayStatus}</span></p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/store/offline-inventory/movements"
          className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
        >
          Open Offline Inventory Control <ArrowRight className="h-4 w-4" aria-hidden />
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
  closeHref = "/dashboard",
  onClose,
}: {
  data: StoreSendMaterialsData;
  closeHref?: string;
  // See the file-header comment above — provide exactly one of
  // onClose/closeHref, same convention as LargeFormModal.
  onClose?: () => void;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<StoreIssueModalState, FormData>(storeIssueModalAction, null);

  function close() {
    if (onClose) onClose();
    else router.push(closeHref);
  }

  function closeAndRefresh() {
    if (onClose) onClose();
    else router.push(closeHref);
    router.refresh();
  }

  const succeeded = state?.ok === true;

  // Embedded (Daily Activity) mode: no inline SuccessPanel — close
  // immediately and show the standardized toast instead, per Unit 10D
  // Task 6 ("close modal, show standardized success popup/toast").
  useEffect(() => {
    if (succeeded && onClose) {
      dispatchActionToast({ tone: "success", title: "Material Received", description: "Received quantity has been recorded in Offline Inventory Control." });
      closeAndRefresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [succeeded]);

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
              <p id="send-materials-heading" className="text-sm font-black text-[#111827]">Receive Materials</p>
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
            {succeeded && !onClose ? (
              <SuccessPanel state={state} onClose={closeAndRefresh} />
            ) : succeeded ? null : (
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
                      {isPending ? "Receiving…" : "Receive Materials"}
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
