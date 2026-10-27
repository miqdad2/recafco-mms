"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";

import { requestJobCardDeletionAction, type JobCardDeletionActionState } from "@/app/actions/job-card-deletion";
import { Button } from "@/components/ui/button";
import { dispatchActionToast } from "@/lib/action-messages";
import { DELETION_REASON_MAX_LENGTH, DELETION_REASON_MIN_LENGTH } from "@/lib/work-orders/job-card-deletion-rules";

// Job Card Deletion — the Data Entry "Request Deletion" action in the Job
// Card header. It never deletes anything: it sends a request to the
// Maintenance Manager. When the Job Card cannot be deleted, the same dialog
// explains why in plain words instead of offering the request.

export function RequestDeletionButton({
  workOrderId,
  jobCardNumber,
  assetLabel,
  eligible,
  reasons,
  pending,
}: {
  workOrderId: string;
  jobCardNumber: string | null;
  assetLabel: string | null;
  eligible: boolean;
  reasons: string[];
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<JobCardDeletionActionState, FormData>(async (prev, formData) => {
    const result = await requestJobCardDeletionAction(prev, formData);
    if (result?.ok) {
      dispatchActionToast({ tone: "success", title: "Delete request sent", description: result.message });
      setOpen(false);
    }
    return result;
  }, null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, isPending]);

  if (pending) {
    return (
      <Button type="button" variant="secondary" disabled className="opacity-70">
        <Trash2 className="h-4 w-4" aria-hidden="true" /> Deletion Requested
      </Button>
    );
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4" aria-hidden="true" /> Request Deletion
      </Button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={() => !isPending && setOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="request-deletion-heading"
              className="relative w-full max-w-md rounded-xl bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3 border-b border-[#F3F4F6] px-5 py-4">
                <h2 id="request-deletion-heading" className="text-lg font-black text-[#111827]">
                  Request to Delete Job Card
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[#6B7280] hover:bg-gray-100"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="space-y-4 px-5 py-4">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-sm">
                  <dt className="font-bold text-[#6B7280]">Job Card</dt>
                  <dd className="break-words font-black text-[#111827]">{jobCardNumber ?? "-"}</dd>
                  <dt className="font-bold text-[#6B7280]">Asset</dt>
                  <dd className="break-words text-[#111827]">{assetLabel ?? "No asset linked"}</dd>
                </dl>

                {eligible ? (
                  <form action={formAction} className="space-y-4">
                    <input type="hidden" name="work_order_id" value={workOrderId} />
                    <p className="text-base text-[#374151]">This request will be sent to the Maintenance Manager.</p>
                    <div>
                      <label htmlFor="deletion-reason" className="block text-sm font-bold text-[#111827]">
                        Reason for deletion <span className="text-[#ED1C24]">*</span>
                      </label>
                      <textarea
                        id="deletion-reason"
                        name="reason"
                        required
                        minLength={DELETION_REASON_MIN_LENGTH}
                        maxLength={DELETION_REASON_MAX_LENGTH}
                        rows={3}
                        disabled={isPending}
                        placeholder="Example: Created twice by mistake"
                        aria-describedby={state?.ok === false ? "deletion-error" : undefined}
                        className="focus-ring mt-1 w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-base"
                      />
                    </div>
                    {state?.ok === false ? (
                      <p id="deletion-error" role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                        {state.error}
                      </p>
                    ) : null}
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={isPending} className="min-h-11">
                        Cancel
                      </Button>
                      <Button type="submit" disabled={isPending} className="min-h-11">
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                        {isPending ? "Sending..." : "Send Request"}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                      <p className="flex items-center gap-1.5 text-sm font-black text-amber-800">
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" /> This Job Card cannot be deleted
                      </p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#374151]">
                        {reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                      <p className="mt-2 text-sm text-[#4B5563]">Please speak to the Maintenance Manager if this Job Card is wrong.</p>
                    </div>
                    <div className="flex justify-end">
                      <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="min-h-11">
                        Close
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
