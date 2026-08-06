"use client";

import { useEffect, useActionState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";

import { addManualTimeEntryAction, type WorkSessionState } from "@/app/actions/work-sessions";
import { dispatchActionToast } from "@/lib/action-messages";

const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]";
const lbl = "mb-1 block text-xs font-bold text-[#4B5563]";

export function ManualTimeEntryModal({
  workOrderId,
  workerAssignmentId,
  workerName,
  onClose,
}: {
  workOrderId: string;
  workerAssignmentId: string;
  workerName: string;
  onClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState<WorkSessionState, FormData>(addManualTimeEntryAction, null);

  useEffect(() => {
    if (state?.ok) {
      dispatchActionToast({ tone: "success", title: "Manual Time Entry Saved" });
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div role="dialog" aria-modal="true" aria-labelledby="manual-entry-heading" className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="manual-entry-heading" className="text-lg font-bold text-[#111827]">
              Add Manual Time Entry — {workerName}
            </h2>
            <button type="button" onClick={onClose} className="rounded-md p-1.5 text-[#9CA3AF] hover:bg-gray-100 hover:text-[#4B5563]" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          {state?.ok === false && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{state.error}</span>
            </div>
          )}

          <form action={formAction} className="space-y-3">
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <input type="hidden" name="worker_assignment_id" value={workerAssignmentId} />

            <div>
              <label htmlFor="mte-start" className={lbl}>Start date/time <span className="text-[#ED1C24]">*</span></label>
              <input id="mte-start" name="started_at" type="datetime-local" required className={inp} disabled={isPending} />
            </div>
            <div>
              <label htmlFor="mte-stop" className={lbl}>Stop date/time <span className="text-[#ED1C24]">*</span></label>
              <input id="mte-stop" name="stopped_at" type="datetime-local" required className={inp} disabled={isPending} />
            </div>
            <div>
              <label htmlFor="mte-notes" className={lbl}>Notes</label>
              <textarea id="mte-notes" name="notes" rows={2} placeholder="Optional — e.g. reported by supervisor" className={`${inp} resize-none`} disabled={isPending} />
            </div>

            <div className="flex items-center gap-2 border-t border-[#F3F4F6] pt-4">
              <button type="submit" disabled={isPending} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-60">
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? "Saving…" : "Add Entry"}
              </button>
              <button type="button" onClick={onClose} disabled={isPending} className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
