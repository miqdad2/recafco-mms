"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, PackageCheck, PackageSearch } from "lucide-react";

import { getJobCardMaterialsModalDataAction, processJobCardMaterialsAction, type JobCardMaterialsModalData } from "@/app/actions/daily-activity-materials";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import { dispatchActionToast } from "@/lib/action-messages";
import type { MaterialFulfillment } from "@/lib/work-orders/material-fulfillment";

// Unified Material Processing Flow Unit 10G.23.
//
// Replaces the old two-modal Issue Material / Receive Materials pair (which
// forced Data Entry to click Issue Available, then Receive Materials, then
// Issue Available again for a mixed Job Card) with one modal + one
// confirmation: review every required material grouped by what it needs,
// then Confirm & Process Materials receives whatever shortage exists and
// issues everything remaining in a single server action
// (processJobCardMaterialsAction -> lib/backend/work-orders/material-processing.ts).
// Still fetches its own data client-side (Pattern B, same shape the old
// modals and WorkerActivityDetailModal already use) via the same, unchanged
// getJobCardMaterialsModalDataAction this file always used.

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

// Task 9 — the same simple per-line vocabulary Unit 10G.14 already
// established (Fully Issued / Ready to Issue / Partially Available / Needs
// Receiving), reused verbatim rather than inventing new wording.
function statusLabel(status: MaterialFulfillment["status"]): string {
  if (status === "fulfilled") return "Fully Issued";
  if (status === "ready_to_issue") return "Ready to Issue";
  if (status === "partial_available") return "Partially Available";
  return "Needs Receiving";
}

function actionNeededLabel(status: MaterialFulfillment["status"]): string {
  if (status === "fulfilled") return "Completed";
  if (status === "ready_to_issue") return "Issue from inventory";
  return "Receive then issue";
}

// Task 2/3 — one row per required material line, grouped by section below.
// Quantity to receive = the line's own shortage_qty (0/omitted when none is
// needed); Quantity to issue = its remaining_qty (0/omitted once fulfilled)
// — both numbers already computed by getMaterialFulfillmentForWorkOrder, not
// recalculated here.
function MaterialRow({ row }: { row: MaterialFulfillment }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-[#111827]">
          {row.description}
          {row.part_number ? <span className="font-normal text-[#9CA3AF]"> ({row.part_number})</span> : null}
        </p>
        <span className="inline-flex items-center rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-2 py-0.5 text-[10px] font-bold text-[#4B5563]">
          {statusLabel(row.status)}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-[#6B7280] sm:grid-cols-4">
        <span>Required: <strong className="text-[#111827]">{row.required_qty} {row.unit}</strong></span>
        <span>Available: <strong className="text-[#111827]">{row.available_now} {row.unit}</strong></span>
        <span>Issued: <strong className="text-[#111827]">{row.issued_qty} {row.unit}</strong></span>
        <span>Remaining: <strong className="text-[#111827]">{row.remaining_qty} {row.unit}</strong></span>
      </div>
      <p className="mt-1.5 text-xs text-[#4B5563]">
        Action: <strong className="text-[#111827]">{actionNeededLabel(row.status)}</strong>
        {row.shortage_qty > 1e-9 ? (
          <>
            {" · "}Receive qty: <strong className="text-[#111827]">{row.shortage_qty} {row.unit}</strong>
          </>
        ) : null}
        {row.remaining_qty > 1e-9 ? (
          <>
            {" · "}Issue qty: <strong className="text-[#111827]">{row.remaining_qty} {row.unit}</strong>
          </>
        ) : null}
      </p>
    </div>
  );
}

function MaterialGroup({
  title,
  icon: Icon,
  tone,
  rows,
}: {
  title: string;
  icon: typeof PackageSearch;
  tone: "blue" | "amber" | "green";
  rows: MaterialFulfillment[];
}) {
  if (rows.length === 0) return null;
  const toneClass = tone === "blue" ? "text-blue-700" : tone === "amber" ? "text-amber-700" : "text-green-700";
  return (
    <div>
      <p className={`mb-1.5 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide ${toneClass}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {title} ({rows.length})
      </p>
      <div className="space-y-2">
        {rows.map((row) => (
          <MaterialRow key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}

export function ProcessMaterialsModal({ workOrderId, onClose }: { workOrderId: string; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<JobCardMaterialsModalData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Task 6 — disabled while processing, and the button's disabled state
  // itself (rather than a timer/debounce) is what prevents a double-click
  // from firing this twice; the server action re-derives remaining/available
  // at execution time regardless, so even a bypassed double-click can never
  // double-issue (see lib/backend/work-orders/material-processing.ts).
  async function handleConfirm() {
    setIsProcessing(true);
    setError(null);
    try {
      const state = await processJobCardMaterialsAction(workOrderId);
      if (!state) return;
      if (!state.ok) {
        setError(state.error);
        return;
      }
      dispatchActionToast({ tone: "success", title: "Materials Processed", description: state.result.message });
      onClose();
      router.refresh();
    } finally {
      setIsProcessing(false);
    }
  }

  if (loadError) {
    return <ModalNotice title="Process Materials" message="This material action is not ready yet." onClose={onClose} />;
  }
  if (!data) {
    return <ModalNotice title="Process Materials" message="Loading…" onClose={onClose} />;
  }
  if (!data.canIssue || !data.canReceive) {
    return <ModalNotice title="Process Materials" message="You do not have permission to process materials for this Job Card." onClose={onClose} />;
  }

  // Task 3 — three simple groups: already-stocked lines, lines that still
  // need some receiving (covers both "nothing available yet" and "partial
  // stock" — either way the next step for that line is the same: receive
  // the shortage, then issue), and lines already fully issued.
  const readyToIssue = data.fulfillment.filter((f) => f.status === "ready_to_issue");
  const needReceiving = data.fulfillment.filter((f) => f.status === "needs_receiving" || f.status === "partial_available");
  const completed = data.fulfillment.filter((f) => f.status === "fulfilled");
  const hasWorkToDo = readyToIssue.length + needReceiving.length > 0;

  return (
    <LargeFormModal
      title="Process Materials"
      subtitle="Review required materials, receive missing items if needed, then issue materials for this Job Card."
      onClose={onClose}
    >
      <div className="space-y-4">
        {data.fulfillment.length === 0 ? (
          <p className="text-sm text-[#6B7280]">No required materials on this Job Card.</p>
        ) : (
          <div className="space-y-4">
            <MaterialGroup title="Ready to Issue" icon={PackageCheck} tone="blue" rows={readyToIssue} />
            <MaterialGroup title="Need Receiving" icon={PackageSearch} tone="amber" rows={needReceiving} />
            <MaterialGroup title="Already Completed" icon={CheckCircle2} tone="green" rows={completed} />
          </div>
        )}

        {!hasWorkToDo && data.fulfillment.length > 0 ? (
          <p className="text-sm font-semibold text-green-700">No remaining materials to process.</p>
        ) : null}

        {error ? (
          <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex items-center gap-2 border-t border-[#F3F4F6] pt-4">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing || !hasWorkToDo}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[#ED1C24] px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-[#c8181e] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isProcessing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isProcessing ? "Processing…" : "Confirm & Process Materials"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="inline-flex min-h-9 items-center rounded-md border border-[#E5E7EB] bg-white px-3.5 py-1.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </LargeFormModal>
  );
}
