"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { getJobCardSummaryAction, type JobCardSummaryDetail } from "@/app/actions/job-card-summary";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import { StatusBadge } from "@/components/ui/status-badge";

// Critical Workflow Popup Review Modal Unit 10G.7, Task 4/5/6/7.
//
// Opened in place of a direct navigation when a Manager clicks "View
// Summary" on the "New Active Job Card" critical popup — same "stay on the
// dashboard, open the full Job Card only if needed" goal as
// ClosureReviewModal (Task 2), but for a different event and deliberately
// lighter data (Task 7 — no worker session history, no full attachments,
// just a count): getJobCardSummaryAction (app/actions/job-card-summary.ts)
// is a purpose-built lightweight read, not a trimmed-down reuse of
// getClosureReviewDetailAction. No approval action here — starting a Job
// Card needs no Manager approval, so this is read-only plus navigation.

function materialsBadgeTone(label: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (label === "Fully Issued") return "green";
  if (label === "Partially Issued" || label === "Materials Pending") return "amber";
  if (label === "Ready to Issue") return "blue";
  return "gray";
}

export function JobCardSummaryModal({
  workOrderId,
  onClose,
  onLoaded,
}: {
  workOrderId: string;
  onClose: () => void;
  // Task 6 — the critical popup marks the source notification read only
  // once this modal's data has actually loaded, never on click alone.
  onLoaded?: () => void;
}) {
  const [detail, setDetail] = useState<JobCardSummaryDetail | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getJobCardSummaryAction(workOrderId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setLoadError(true);
          return;
        }
        setDetail(result);
        onLoaded?.();
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId]);

  if (loadError) {
    return (
      <LargeFormModal title="Job Card Summary" onClose={onClose}>
        <p className="text-sm text-[#6B7280]">Could not load this Job Card. It may no longer be visible to you.</p>
      </LargeFormModal>
    );
  }
  if (!detail) {
    return (
      <LargeFormModal title="Job Card Summary" onClose={onClose}>
        <p className="text-sm text-[#6B7280]">Loading…</p>
      </LargeFormModal>
    );
  }

  return (
    <LargeFormModal title="Job Card Summary" subtitle="Quick overview before opening the full Job Card." onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-black text-[#111827]">{detail.workOrderNumber ?? "Job Card"}</p>
            <StatusBadge label={detail.status} tone="blue" />
          </div>
          <p className="mt-1 text-xs text-[#4B5563]">{detail.assetLabel ?? "No asset linked"}</p>
          <p className="mt-0.5 text-xs text-[#374151]">{detail.issue}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[#6B7280] sm:grid-cols-3">
            <span>Created: <strong className="text-[#111827]">{detail.createdAtLabel}</strong></span>
            <span>Requested by: <strong className="text-[#111827]">{detail.requestedByName ?? "Unknown"}</strong></span>
            <span>Work team: <strong className="text-[#111827]">{detail.workTeam}</strong></span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Assignment</p>
            <p className="mt-1 text-sm font-semibold text-[#111827]">{detail.assignmentStatusLabel}</p>
            <p className="mt-0.5 text-xs text-[#6B7280]">{detail.workersCount} worker{detail.workersCount !== 1 ? "s" : ""} assigned</p>
          </div>
          <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Materials</p>
            <div className="mt-1">
              <StatusBadge label={detail.materialsStatusLabel} tone={materialsBadgeTone(detail.materialsStatusLabel)} />
            </div>
            <p className="mt-1.5 text-xs text-[#6B7280]">{detail.attachmentsCount} attachment{detail.attachmentsCount !== 1 ? "s" : ""}</p>
          </div>
        </div>

        <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-blue-700">Next Recommended Action</p>
          <p className="mt-1 text-sm font-semibold text-[#111827]">{detail.nextAction}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[#F3F4F6] pt-4">
          <Link
            href="/maintenance/daily-activity"
            className="inline-flex min-h-9 items-center rounded-md bg-[#ED1C24] px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-red-700"
          >
            Open Daily Activity
          </Link>
          <Link
            href={detail.detailHref}
            className="inline-flex min-h-9 items-center rounded-md border border-[#E5E7EB] bg-white px-3.5 py-1.5 text-sm font-bold text-[#111827] transition hover:bg-gray-50"
          >
            Open Full Job Card
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-9 items-center rounded-md border border-[#E5E7EB] bg-white px-3.5 py-1.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
          >
            Dismiss
          </button>
        </div>
      </div>
    </LargeFormModal>
  );
}
