"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";

import { LargeFormModal, useLargeFormModal } from "@/components/ui/large-form-modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { ClosureReviewModal } from "@/components/dashboard/closure-review-modal";
import { computeHoursVariance } from "@/lib/work-orders/hours-variance";

// Manager Dashboard Closure Requests Modal Unit 10G, restructured by Closure
// Requests Review Popup Unit 10G.2.
//
// Task 1/10: the LIST here stays compact and cheap — only the summary
// fields a row needs (still server-computed props, Pattern A, same overlay
// convention as VehicleExpiryModal/ActiveJobCardsModal). Clicking "Review
// Closure" swaps this modal's body for ClosureReviewModal, which fetches
// its own full worker/materials/attachments/note detail on demand
// (Pattern B) for exactly the one Job Card the Manager clicked into — never
// for the whole list at once. The former inline "View Summary" expansion
// and the row-level "Approve Closure" button are both gone (Task 1/8);
// approval now only happens inside the review popup.

export type ClosureRequestRow = {
  id: string;
  workOrderNumber: string | null;
  assetLabel: string | null;
  issue: string;
  requestedByName: string | null;
  requestedAtLabel: string;
  workersCount: number;
  totalHours: number;
  totalAmount: number | null;
  // Manager Closure Review Estimated vs Actual Labor Transparency Unit
  // 10G.21, Task 3 — Job-Card-level estimate (work_orders.estimated_labor_hours),
  // hours-only and unconditional on canViewCosts, matching the estimate
  // visibility rule used by every other Estimated/Actual surface.
  estimatedHours: number | null;
  materialsLabel: string;
  attachmentsCount: number;
  detailHref: string;
};

function materialsTone(label: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (label === "Materials Completed") return "green";
  if (label === "Ready to Issue") return "blue";
  if (label === "Partially Available") return "amber";
  if (label === "Materials Pending") return "red";
  return "gray";
}

function ClosureRequestListRow({ row, onReview }: { row: ClosureRequestRow; onReview: () => void }) {
  return (
    <div className="border-b border-[#EEF2F6] py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-bold text-[#111827]">
              {row.workOrderNumber ?? "Job Card"}
              {row.assetLabel ? <span className="font-normal text-[#6B7280]"> — {row.assetLabel}</span> : null}
            </p>
            <StatusBadge label="Closure Requested" tone="amber" />
          </div>
          <p className="mt-0.5 truncate text-xs text-[#374151]">{row.issue}</p>
          <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
            Requested by {row.requestedByName ?? "Unknown"} · {row.requestedAtLabel}
          </p>
        </div>
        <StatusBadge label={row.materialsLabel} tone={materialsTone(row.materialsLabel)} />
      </div>

      {/* Task 1 — compact summary line only; no inline expansion.
          Unit 10G.21, Task 3: "Labor hours" relabeled "Actual" and paired
          with "Estimated"/"Variance" so the row reads as a comparison, not
          just a raw total — same plain-text-spans layout as before (no
          badge/color added here) to keep the list from getting crowded;
          the full color-coded status lives one click away in Review
          Closure. */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#6B7280]">
        <span>Workers: <strong className="text-[#111827]">{row.workersCount}</strong></span>
        <span>Estimated: <strong className="text-[#111827]">{row.estimatedHours !== null ? `${row.estimatedHours} h` : "Not recorded"}</strong></span>
        <span>Actual: <strong className="text-[#111827]">{row.totalHours} h</strong></span>
        {row.estimatedHours !== null ? (() => {
          const variance = computeHoursVariance(row.estimatedHours, row.totalHours);
          return variance.varianceHours !== null ? (
            <span>
              Variance:{" "}
              <strong className="text-[#111827]">
                {variance.varianceHours >= 0 ? "+" : ""}
                {variance.varianceHours} h
              </strong>
            </span>
          ) : null;
        })() : null}
        {row.totalAmount !== null ? <span>Labor cost: <strong className="text-[#111827]">{row.totalAmount.toFixed(3)} KWD</strong></span> : null}
        <span className="inline-flex items-center gap-1">
          <FileText className="h-3 w-3" aria-hidden="true" /> {row.attachmentsCount} attachment{row.attachmentsCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onReview}
          className="inline-flex min-h-8 items-center rounded-md bg-[#2563EB] px-2.5 py-1 text-xs font-bold text-white transition hover:bg-blue-700"
        >
          Review Closure
        </button>
        <Link
          href={row.detailHref}
          className="inline-flex min-h-8 items-center rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
        >
          Open Full Job Card
        </Link>
      </div>
    </div>
  );
}

function ModalFooter() {
  const modal = useLargeFormModal();
  return (
    <div className="mt-4 flex flex-col-reverse gap-2 border-t border-[#EEF2F6] pt-4 sm:flex-row sm:justify-end">
      <button
        type="button"
        onClick={() => modal?.requestClose()}
        className="inline-flex min-h-10 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
      >
        Close
      </button>
      <Link
        href="/maintenance/work-orders?status=ClosureRequested"
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white transition hover:bg-[#c8181e]"
      >
        Open Job Cards Closure List
      </Link>
    </div>
  );
}

export function ClosureRequestsModal({
  jobCards,
  totalCount,
  closeHref,
}: {
  jobCards: ClosureRequestRow[];
  totalCount: number;
  closeHref: string;
}) {
  const router = useRouter();
  // Task 9 — after an in-popup approve, the row should disappear without
  // waiting for the next full page load; router.refresh() (called once the
  // review popup reports success) re-runs the server component with fresh
  // data (KPI count included), but this local hide keeps the removal
  // feeling instant rather than waiting on the network round trip.
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  // Task 1/10 — which Job Card's Closure Review popup is open, if any.
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const visibleCards = jobCards.filter((r) => !approvedIds.has(r.id));

  if (reviewingId) {
    return (
      <ClosureReviewModal
        workOrderId={reviewingId}
        onClose={() => setReviewingId(null)}
        onApproved={() => {
          // Task 9 — close the review popup, return to the list, remove the
          // approved row, and refresh so the KPI count and every remaining
          // row's own summary figures are accurate.
          setApprovedIds((prev) => new Set(prev).add(reviewingId));
          setReviewingId(null);
          router.refresh();
        }}
      />
    );
  }

  return (
    <LargeFormModal title="Closure Requests" subtitle="Review completed Job Cards waiting for Manager approval." closeHref={closeHref}>
      <p className="mb-3 text-sm font-semibold text-[#111827]">Pending closure requests: {totalCount}</p>
      {visibleCards.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-10 text-center">
          <p className="text-sm font-semibold text-[#111827]">No closure requests pending.</p>
          <p className="text-xs text-[#6B7280]">Job Cards waiting for closure approval will appear here.</p>
        </div>
      ) : (
        <>
          <div>
            {visibleCards.map((row) => (
              <ClosureRequestListRow key={row.id} row={row} onReview={() => setReviewingId(row.id)} />
            ))}
          </div>
          {totalCount > jobCards.length ? (
            <p className="mt-3 text-center text-xs text-[#9CA3AF]">
              Showing the oldest {jobCards.length} of {totalCount} closure requests. Open Job Cards Closure List to see the rest.
            </p>
          ) : null}
        </>
      )}
      <ModalFooter />
    </LargeFormModal>
  );
}
