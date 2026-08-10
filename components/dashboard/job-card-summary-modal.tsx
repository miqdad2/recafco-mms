"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { getJobCardSummaryAction, type JobCardSummaryDetail, type JobCardSummaryWorkers } from "@/app/actions/job-card-summary";
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

// Unit 10G.8, Task 1 — compact "first 3 names, then +N more" per role group.
const MAX_NAMES_SHOWN = 3;
function formatNames(names: string[]): string {
  if (names.length <= MAX_NAMES_SHOWN) return names.join(", ");
  const shown = names.slice(0, MAX_NAMES_SHOWN).join(", ");
  return `${shown} +${names.length - MAX_NAMES_SHOWN} more`;
}

function WorkerGroupRow({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-[#374151]">
      <span className="font-semibold text-[#111827]">{label}:</span> {formatNames(names)}
    </p>
  );
}

// Task 1/3 — worker name + role/division only, never rate/pay/KWD. Priority
// 1 (Internal Team roster, grouped by role) beats priority 2 (legacy
// freelancer/external company/single-technician assignment) beats "no
// workers assigned" — matching getJobCardSummaryAction's own priority.
function AssignmentWorkers({ workers }: { workers: JobCardSummaryWorkers }) {
  const hasRoster = workers.supervisor.length > 0 || workers.technicians.length > 0 || workers.helpers.length > 0;
  if (hasRoster) {
    return (
      <div className="mt-1.5">
        <WorkerGroupRow label="Supervisor" names={workers.supervisor} />
        <WorkerGroupRow label="Technicians" names={workers.technicians} />
        <WorkerGroupRow label="Helpers / Labor" names={workers.helpers} />
      </div>
    );
  }
  if (workers.legacy.length > 0) {
    return (
      <div className="mt-1.5">
        <WorkerGroupRow label="Assigned" names={workers.legacy} />
      </div>
    );
  }
  return <p className="mt-1.5 text-xs text-[#9CA3AF]">No workers assigned</p>;
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
            <AssignmentWorkers workers={detail.workers} />
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
          {/* Unit 10G.8, Task 4/5/7: both links now close this modal (which,
              via the critical popup's own onClose wiring, also dismisses the
              parent popup — see components/notifications/critical-workflow-popup.tsx's
              closeReview) on click, same pattern already used elsewhere in
              the app (e.g. material-detail-modal.tsx's Receive/Issue links)
              — a bare <Link> with no onClick left this modal mounted over
              whatever page it navigated to, since the critical popup lives
              in the persistent app layout and its React state survives a
              client-side route change. "Open Daily Activity" reuses the
              same `?q=<jobCardNumber>` focus/select convention the New Job
              Card success modal's own "Open in Daily Activity" link already
              uses (Daily Activity has no `?jobCardId=` param — this is the
              existing, already-working way to land pre-filtered/selected on
              one specific Job Card); falls back to the plain board when the
              number isn't available for any reason. */}
          <Link
            href={detail.workOrderNumber ? `/maintenance/daily-activity?q=${encodeURIComponent(detail.workOrderNumber)}` : "/maintenance/daily-activity"}
            onClick={onClose}
            className="inline-flex min-h-9 items-center rounded-md bg-[#ED1C24] px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-red-700"
          >
            Open Daily Activity
          </Link>
          <Link
            href={detail.detailHref}
            onClick={onClose}
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
