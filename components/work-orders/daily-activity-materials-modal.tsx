"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";

import { getJobCardMaterialsModalDataAction, type JobCardMaterialsModalData } from "@/app/actions/daily-activity-materials";
import { issueOfflineMaterialAction, type OfflineMovementState } from "@/app/actions/offline-inventory";
import { StoreSendMaterialsPopup } from "@/components/store/store-send-materials-popup";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import { inputCls as inp, labelCls as lbl, todayStr } from "@/components/store/offline-inventory-types";
import { dispatchActionToast } from "@/lib/action-messages";
import type { MaterialFulfillment } from "@/lib/work-orders/material-fulfillment";

// Daily Activity Inline Materials Receive/Issue Modal Unit 10D.
//
// Two modals, both Pattern B (fetch their own data client-side via
// getJobCardMaterialsModalDataAction, keyed only by workOrderId — same shape
// as WorkerActivityDetailModal from Unit 10C): IssueMaterialModal issues
// against required-materials rows using the EXISTING issueOfflineMaterialAction
// (one small form per issuable row, mirroring the per-row "Issue Material"
// button the Job Card detail page's own Required Materials table already
// has); ReceiveMaterialsModal is a thin wrapper around the EXISTING
// StoreSendMaterialsPopup (now embeddable via its onClose prop), fed by this
// Job Card's one active Materials Request. Neither modal reimplements any
// stock-deduction or receive logic — both call the exact same server actions
// every other Receive/Issue surface in the app already uses.

function ModalNotice({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
          <p className="font-black text-[#111827]">{title}</p>
          <p className="mt-2 text-sm text-[#4B5563]">{message}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}

// ── Issue Material ───────────────────────────────────────────────────────────

function IssueRowForm({
  workOrderId,
  workOrderNumber,
  row,
  onIssued,
}: {
  workOrderId: string;
  workOrderNumber: string | null;
  row: MaterialFulfillment;
  onIssued: () => void;
}) {
  const [state, formAction, isPending] = useActionState<OfflineMovementState, FormData>(issueOfflineMaterialAction, null);
  // Task 2 default — min(remaining, available); issueOfflineMaterialAction
  // requires a whole-number quantity (same constraint the full Offline
  // Inventory Issue Material form already has), so this is floored the same
  // way that form's own max already is.
  const maxQty = Math.max(1, Math.floor(Math.min(row.remaining_qty, row.available_now)));
  const [qty, setQty] = useState(maxQty);
  const [issuedTo, setIssuedTo] = useState(workOrderNumber ? `Job Card ${workOrderNumber}` : "Job Card");

  useEffect(() => {
    if (state?.ok) onIssued();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  return (
    <form action={formAction} className="space-y-2.5 rounded-md border border-[#E5E7EB] p-3">
      <input type="hidden" name="movement_date" value={todayStr()} />
      <input type="hidden" name="part_id" value={row.part_id ?? ""} />
      <input type="hidden" name="manual_material_name" value={row.part_id ? "" : row.description} />
      <input type="hidden" name="manual_part_number" value={row.part_id ? "" : row.part_number ?? ""} />
      <input type="hidden" name="category" value="" />
      <input type="hidden" name="unit" value={row.unit} />
      <input type="hidden" name="related_work_order_id" value={workOrderId} />
      <input type="hidden" name="purpose" value={`Required material for ${workOrderNumber ?? "this Job Card"}`} />

      <div>
        <p className="text-sm font-bold text-[#111827]">
          {row.description}
          {row.part_number ? <span className="font-normal text-[#9CA3AF]"> ({row.part_number})</span> : null}
        </p>
        <p className="mt-0.5 text-xs text-[#6B7280]">
          Required {row.required_qty} {row.unit} · Issued {row.issued_qty} {row.unit} · Remaining {row.remaining_qty} {row.unit} · Available{" "}
          {row.available_now} {row.unit}
        </p>
      </div>

      {state?.ok === false && (
        <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className={lbl}>Quantity to issue</label>
          <input
            type="number"
            name="quantity"
            min={1}
            max={maxQty}
            step={1}
            value={qty}
            onChange={(e) => {
              const raw = Math.round(Number(e.target.value));
              setQty(Number.isFinite(raw) ? Math.min(Math.max(raw, 1), maxQty) : 1);
            }}
            className={inp}
            disabled={isPending}
          />
        </div>
        <div>
          <label className={lbl}>Issued to</label>
          <input
            type="text"
            name="counterparty"
            value={issuedTo}
            onChange={(e) => setIssuedTo(e.target.value)}
            required
            className={inp}
            disabled={isPending}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#c8181e] disabled:opacity-60"
      >
        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {isPending ? "Issuing…" : "Issue Material"}
      </button>
    </form>
  );
}

export function IssueMaterialModal({ workOrderId, onClose }: { workOrderId: string; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<JobCardMaterialsModalData | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getJobCardMaterialsModalDataAction(workOrderId)
      .then((result) => {
        if (cancelled) return;
        if (!result) setLoadError(true);
        else setData(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workOrderId]);

  function closeAndRefresh() {
    onClose();
    router.refresh();
  }

  function handleIssued() {
    // Task 6 — close, standardized toast, Daily Activity refreshes. Every
    // required-materials row is independent (its own movement/status), so
    // closing after any one successful issue (rather than juggling partial
    // re-fetches for the rest) keeps this identical to the Receive modal's
    // own close-on-success behavior.
    dispatchActionToast({ tone: "success", title: "Material Issued", description: "Issued quantity has been recorded in Offline Inventory Control." });
    closeAndRefresh();
  }

  if (loadError) {
    return <ModalNotice title="Issue Material to Job Card" message="This material action is not ready yet." onClose={onClose} />;
  }
  if (!data) {
    return <ModalNotice title="Issue Material to Job Card" message="Loading…" onClose={onClose} />;
  }
  if (!data.canIssue) {
    return <ModalNotice title="Issue Material to Job Card" message="You do not have permission to issue materials." onClose={onClose} />;
  }

  const issuableRows = data.fulfillment.filter(
    (f) => f.remaining_qty > 1e-9 && f.available_now > 1e-9 && Math.floor(Math.min(f.remaining_qty, f.available_now)) >= 1
  );

  return (
    <LargeFormModal title="Issue Material to Job Card" subtitle={`${data.workOrderNumber ?? "Job Card"}${data.assetLabel ? ` · ${data.assetLabel}` : ""}`} onClose={onClose}>
      {issuableRows.length === 0 ? (
        <p className="text-sm text-[#6B7280]">Not enough stock available to issue.</p>
      ) : (
        <div className="space-y-3">
          {issuableRows.map((row) => (
            <IssueRowForm key={row.id} workOrderId={data.workOrderId} workOrderNumber={data.workOrderNumber} row={row} onIssued={handleIssued} />
          ))}
        </div>
      )}
    </LargeFormModal>
  );
}

// ── Receive Materials ────────────────────────────────────────────────────────

export function ReceiveMaterialsModal({ workOrderId, onClose }: { workOrderId: string; onClose: () => void }) {
  const [data, setData] = useState<JobCardMaterialsModalData | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getJobCardMaterialsModalDataAction(workOrderId)
      .then((result) => {
        if (cancelled) return;
        if (!result) setLoadError(true);
        else setData(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workOrderId]);

  if (loadError || (data && !data.activeRequest)) {
    return <ModalNotice title="Receive Materials" message="This material action is not ready yet." onClose={onClose} />;
  }
  if (!data) {
    return <ModalNotice title="Receive Materials" message="Loading…" onClose={onClose} />;
  }
  if (!data.canReceive) {
    return <ModalNotice title="Receive Materials" message="You do not have permission to receive materials." onClose={onClose} />;
  }

  // data.activeRequest is non-null here (the loadError branch above already
  // handled the null case) — reuses StoreSendMaterialsPopup exactly as the
  // dashboard's own guided popup does, just closed via callback instead of
  // navigation.
  return <StoreSendMaterialsPopup data={data.activeRequest!} onClose={onClose} />;
}
