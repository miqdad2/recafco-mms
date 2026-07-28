"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import type { QuickViewData } from "@/components/work-orders/repair-order-quick-view";

// Manager Approval Success Popup and Materials Awaiting Receipt Flow Task 2:
// mirrors CorrectionRequestSentModal/JobCardClosedModal's pattern, but reuses
// the same QuickViewData shape every host page (dashboard, Job Cards list,
// Materials Requests list) already fetches for the ?preview= quick-view
// popup — approveJobCardAndMaterialsAction now redirects back to the
// originating list page with both ?success=job-card-opened and the same
// ?preview=<id> it always used, so no separate query is needed here.

// Same local copy used by the quick-view popup itself — a Job Card can only
// ever have one Materials Request in one of these statuses at a time.
const ACTIVE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];

export type JobCardOpenedModalProps = {
  data: QuickViewData;
  dismissHref: string;
};

export function JobCardOpenedModal({ data, dismissHref }: JobCardOpenedModalProps) {
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

  const activeRequest = data.all_parts_requests.find((pr) => ACTIVE_MATERIALS_REQUEST_STATUSES.includes(pr.status)) ?? null;
  const hasMaterials = activeRequest !== null;
  const issue = data.operator_complaint || data.description_of_work;
  const assetLabel = data.assets ? `${data.assets.asset_code} — ${data.assets.asset_name}` : null;

  const nextStepText = hasMaterials
    ? "Receive materials when they arrive, then close the Job Card after the work is done."
    : "Close the Job Card after the work is done.";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={dismiss} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="jc-opened-heading"
          className="relative flex w-full max-w-[560px] flex-col rounded-xl bg-white shadow-2xl max-h-[90vh]"
        >
          <button
            onClick={dismiss}
            className="absolute right-4 top-4 rounded-md p-1.5 text-[#9CA3AF] hover:bg-gray-100 hover:text-[#4B5563] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex flex-col items-center px-6 pb-2 pt-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
                <CheckCircle2 className="h-9 w-9 text-[#16A34A]" aria-hidden />
              </div>
              <h2 id="jc-opened-heading" className="mt-4 text-xl font-black text-[#111827]">
                Job Card Approved
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
                Job Card <span className="font-bold text-[#111827]">{data.work_order_number ?? "—"}</span> has been
                approved.
              </p>
              {hasMaterials && (
                <p className="mt-1 text-sm leading-relaxed text-[#4B5563]">
                  Requested materials are approved and awaiting receipt.
                </p>
              )}
            </div>

            <div className="px-6 py-4">
              <div className="space-y-1.5 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-left">
                <p className="text-[#4B5563]">
                  <span className="font-semibold text-[#111827]">Job Card:</span> {data.work_order_number ?? "—"}
                </p>
                {assetLabel && (
                  <p className="text-[#4B5563]">
                    <span className="font-semibold text-[#111827]">Asset / Equipment / Vehicle:</span> {assetLabel}
                  </p>
                )}
                {issue && (
                  <p className="text-[#4B5563]">
                    <span className="font-semibold text-[#111827]">Issue:</span> {issue}
                  </p>
                )}
                {activeRequest && (
                  <>
                    <p className="text-[#4B5563]">
                      <span className="font-semibold text-[#111827]">Materials Request:</span>{" "}
                      {activeRequest.parts_request_number ?? "—"}
                    </p>
                    <div>
                      <p className="font-semibold text-[#111827]">Requested materials:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {activeRequest.items.map((item) => (
                          <li key={item.id} className="text-[#4B5563]">
                            {item.description} <span className="text-xs">· Qty {item.quantity_requested}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Job Card status</span>
                <StatusBadge label="Open" tone="blue" />
              </div>
              {hasMaterials && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Materials status</span>
                  <StatusBadge label="Awaiting Receipt" tone="amber" />
                </div>
              )}

              <p className="mt-3 text-sm leading-relaxed text-[#111827]">
                <span className="font-bold">Next: </span>
                {nextStepText}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-[#F3F4F6] px-6 pb-6 pt-4 sm:flex-row sm:flex-wrap">
            <Link
              ref={primaryButtonRef}
              href="/dashboard"
              onClick={dismiss}
              className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md bg-[#ED1C24] px-4 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              Go to Dashboard
            </Link>
            {activeRequest && (
              <Link
                href={`/store/parts-requests/${activeRequest.id}`}
                onClick={dismiss}
                className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50"
              >
                View Materials Request
              </Link>
            )}
            <Link
              href={`/maintenance/work-orders/${data.id}`}
              onClick={dismiss}
              className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50"
            >
              View Job Card
            </Link>
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
