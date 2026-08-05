"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { submitWorkOrderAction } from "@/app/actions/workflow";

export type JobCardCreatedModalProps = {
  jobCardId: string | null;
  jobCardNumber: string | null;
  isDraft: boolean;
  assetName: string | null;
  issue: string | null;
  attachmentWarning: boolean;
  materialsRequestWarning?: boolean;
  dismissHref: string;
};

// Approval Workflow Unit 4 — Closure Approval Only: mirrors the current
// plain, user-facing statuses (lib/work-orders/simplified-status.ts) —
// Draft → Active → Closure Requested → Closed. No Manager approval before
// starting a Job Card any more, so "Submitted"/"Approved" are no longer
// separate stages here. "Correction Requested" isn't part of this bar since
// a just-created Job Card can't have a pending correction yet.
const WORKFLOW_STAGES = ["Draft", "Active", "Closure Requested", "Closed"] as const;

export function JobCardCreatedModal({
  jobCardId,
  jobCardNumber,
  isDraft,
  assetName,
  issue,
  attachmentWarning,
  materialsRequestWarning = false,
  dismissHref,
}: JobCardCreatedModalProps) {
  const router = useRouter();
  // Two element types share the "primary action" focus target — a real
  // <button> (Submit for Review) when isDraft, otherwise the "Go to Job
  // Cards" <Link> — so each gets its own typed ref rather than forcing one
  // ref onto two different element types.
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const primaryLinkRef = useRef<HTMLAnchorElement>(null);

  function dismiss() {
    router.replace(dismissHref, { scroll: false });
  }

  useEffect(() => {
    if (isDraft) primaryButtonRef.current?.focus();
    else primaryLinkRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissHref]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const currentStageIndex = isDraft ? 0 : 1;
  const canViewFull = !!jobCardId;

  // Save Draft Success Popup Submit Option Cleanup Task 2/3/6: this same
  // modal renders for both outcomes of the create wizard — saved as Draft
  // (isDraft, driven by the just-created record's real status === "Created")
  // or started directly (status === "Approved", displayed as "Active") —
  // never confused, since isDraft is derived from the actual DB status, not
  // from user intent guessed some other way.
  const modalTitle = isDraft ? "Job Card Draft Saved" : "Job Card Started";
  const modalMessage = isDraft
    ? "has been saved as draft."
    : "is now Active. Work can begin.";
  const nextStepText = isDraft
    ? "Start this Job Card when ready."
    : "Assign work, update details, or request closure once work is done.";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={dismiss} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="jc-created-heading"
          className="relative flex w-full max-w-[560px] flex-col rounded-xl bg-white shadow-2xl"
        >
          <button
            onClick={dismiss}
            className="absolute right-4 top-4 rounded-md p-1.5 text-[#9CA3AF] hover:bg-gray-100 hover:text-[#4B5563] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex flex-col items-center px-6 pb-2 pt-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
              <CheckCircle2 className="h-9 w-9 text-[#16A34A]" aria-hidden />
            </div>
            <h2 id="jc-created-heading" className="mt-4 text-xl font-black text-[#111827]">
              {modalTitle}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
              Job Card <span className="font-bold text-[#111827]">{jobCardNumber ?? "—"}</span> {modalMessage}
            </p>

            {attachmentWarning && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-semibold text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>Job Card created, but some attachments failed to upload.</span>
              </div>
            )}

            {materialsRequestWarning && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-semibold text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>Job Card created, but the Materials Request could not be created automatically. Use &quot;Request Materials&quot; from the Job Card to add it.</span>
              </div>
            )}
          </div>

          <div className="px-6 py-4">
            {(assetName || issue) && (
              <div className="mb-4 space-y-1 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm">
                {assetName && (
                  <p className="text-[#4B5563]">
                    <span className="font-semibold text-[#111827]">Asset:</span> {assetName}
                  </p>
                )}
                {issue && (
                  <p className="text-[#4B5563]">
                    <span className="font-semibold text-[#111827]">Issue:</span> {issue}
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Current status</span>
              <StatusBadge label={isDraft ? "Draft" : "Active"} tone={isDraft ? "gray" : "blue"} />
            </div>

            <p className="mt-3 text-sm leading-relaxed text-[#111827]">
              <span className="font-bold">Next: </span>
              {nextStepText}
            </p>

            {/* Simple workflow line */}
            <div className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-2 rounded-md bg-[#F5F6F8] px-3 py-2.5">
              {WORKFLOW_STAGES.map((stage, idx) => (
                <div key={stage} className="flex shrink-0 items-center">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      idx === currentStageIndex
                        ? "bg-[#ED1C24] text-white"
                        : idx < currentStageIndex
                        ? "bg-green-100 text-[#16A34A]"
                        : "bg-white text-[#9CA3AF]"
                    }`}
                  >
                    {stage}
                  </span>
                  {idx < WORKFLOW_STAGES.length - 1 && (
                    <ArrowRight className="mx-1 h-3 w-3 shrink-0 text-[#9CA3AF]" aria-hidden />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-[#F3F4F6] px-6 pb-6 pt-4 sm:flex-row sm:flex-wrap">
            {/* Save Draft Success Popup Submit Option Cleanup Task 4/5:
                primary action on the Draft-saved state — submits directly
                from this popup instead of forcing the user to open the Job
                Card first. Carries return_to/return_to_param (reusing
                dismissHref, the same clean base URL Close/X already use)
                so submitWorkOrderAction redirects back to this same page
                with ?success=job-card-submitted, which the host page already
                renders as JobCardSubmittedModal — no new "submitted" UI
                needed here. */}
            {isDraft && canViewFull && (
              <form action={submitWorkOrderAction} className="contents">
                <input type="hidden" name="work_order_id" value={jobCardId!} />
                <input type="hidden" name="return_to" value={dismissHref} />
                <input type="hidden" name="return_to_param" value="preview" />
                <button
                  ref={primaryButtonRef}
                  type="submit"
                  className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md bg-[#ED1C24] px-4 text-sm font-semibold text-white transition hover:bg-red-700"
                >
                  Start Job Card
                </button>
              </form>
            )}
            <Link
              ref={isDraft ? undefined : primaryLinkRef}
              href="/maintenance/work-orders"
              onClick={dismiss}
              className={
                isDraft
                  ? "flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50"
                  : "flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md bg-[#ED1C24] px-4 text-sm font-semibold text-white transition hover:bg-red-700"
              }
            >
              Go to Job Cards
            </Link>
            <Link
              href="/maintenance/work-orders/new"
              onClick={dismiss}
              className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50"
            >
              Create Another
            </Link>
            {canViewFull && (
              <Link
                href={`/maintenance/work-orders/${jobCardId}`}
                onClick={dismiss}
                className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50"
              >
                View Job Card
              </Link>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
