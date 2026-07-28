"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";

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

// Simplified Workflow UI Consistency Cleanup Task 7: mirrors the five
// plain, user-facing statuses (lib/work-orders/simplified-status.ts) —
// Draft → Submitted → Open → Closed. "Correction Requested" isn't part of
// this bar since a just-created Job Card can't have a pending correction yet.
const WORKFLOW_STAGES = ["Draft", "Submitted", "Open", "Closed"] as const;

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
  const primaryButtonRef = useRef<HTMLAnchorElement>(null);

  function dismiss() {
    router.replace(dismissHref, { scroll: false });
  }

  useEffect(() => {
    primaryButtonRef.current?.focus();
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

  const nextStepText = isDraft
    ? "Continue editing or submit it when you're ready for review."
    : "Supervisor / Manager will review the Job Card.";

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
              Job Card Created
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
              Job Card <span className="font-bold text-[#111827]">{jobCardNumber ?? "—"}</span> has been
              created successfully.
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
              <StatusBadge label={isDraft ? "Draft" : "Submitted"} tone={isDraft ? "gray" : "amber"} />
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

          <div className="mt-5 flex flex-col gap-3 border-t border-[#F3F4F6] px-6 pb-6 pt-4 sm:flex-row">
            <Link
              ref={primaryButtonRef}
              href="/maintenance/work-orders"
              onClick={dismiss}
              className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md bg-[#ED1C24] px-4 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              Go to Job Cards
            </Link>
            <Link
              href="/maintenance/work-orders/new"
              className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50"
            >
              Create Another
            </Link>
            {canViewFull && (
              <Link
                href={`/maintenance/work-orders/${jobCardId}`}
                className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50"
              >
                View Job Card
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
