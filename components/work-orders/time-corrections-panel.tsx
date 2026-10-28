"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  approveWorkTimeCorrectionAction,
  rejectWorkTimeCorrectionAction,
  type WorkTimeCorrectionActionState,
} from "@/app/actions/work-time-corrections";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { dispatchActionToast } from "@/lib/action-messages";
import { formatDurationMinutes, formatKuwaitDateTime, formatKuwaitMoment } from "@/lib/format/kuwait-time";
import type { TimeCorrectionView } from "@/lib/backend/work-orders/work-time-corrections";
import { isUnusuallyLongPeriod, LONG_PERIOD_REVIEW_MINUTES } from "@/lib/work-orders/work-time-correction-rules";

// Worker time entered or corrected by hand on one Job Card — system-recorded
// and corrected values side by side, reason, who and when. Saved entries
// ("Recorded") already count; the Manager reviews them in Closure Review.
// Approve / Reject remain only for OLDER entries still Pending from before
// single closure approval. Cost impact appears only for cost viewers.

const STATUS_LABEL: Record<TimeCorrectionView["status"], { label: string; tone: "amber" | "green" | "red" | "blue" }> = {
  Pending: { label: "Older entry — waiting for Manager decision", tone: "amber" },
  Approved: { label: "Approved", tone: "green" },
  Rejected: { label: "Rejected", tone: "red" },
  Recorded: { label: "Saved — reviewed at closure", tone: "blue" },
};

function signedDuration(minutes: number) {
  if (minutes === 0) return "no change";
  return `${minutes > 0 ? "+" : "−"}${formatDurationMinutes(Math.abs(minutes))}`;
}

function ReviewButtons({ correctionId, kind }: { correctionId: string; kind: TimeCorrectionView["kind"] }) {
  const manual = kind === "manual_entry";
  const [mode, setMode] = useState<"idle" | "reject">("idle");
  const [approveState, approveAction, approving] = useActionState<WorkTimeCorrectionActionState, FormData>(approveWorkTimeCorrectionAction, null);
  const [rejectState, rejectAction, rejecting] = useActionState<WorkTimeCorrectionActionState, FormData>(rejectWorkTimeCorrectionAction, null);
  const handled = useRef<WorkTimeCorrectionActionState[]>([]);

  useEffect(() => {
    for (const s of [approveState, rejectState]) {
      if (s?.ok && !handled.current.includes(s)) {
        handled.current.push(s);
        dispatchActionToast({
          tone: "success",
          title: s === approveState ? (manual ? "Manual time approved" : "Time correction approved") : manual ? "Manual time rejected" : "Time correction rejected",
          description: s.message,
        });
        setMode("idle");
      }
    }
  }, [approveState, rejectState, manual]);

  const error = (approveState?.ok === false && approveState.error) || (rejectState?.ok === false && rejectState.error) || null;
  const busy = approving || rejecting;

  return (
    <div className="mt-3 border-t border-[#E5E7EB] pt-3">
      {error ? (
        <p role="alert" className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      {mode === "idle" ? (
        <form action={approveAction} className="space-y-2">
          <input type="hidden" name="correction_id" value={correctionId} />
          <label htmlFor={`approve-remarks-${correctionId}`} className="block text-xs font-bold text-[#374151]">
            Remarks (optional)
          </label>
          <input id={`approve-remarks-${correctionId}`} name="remarks" maxLength={500} disabled={busy} className="focus-ring min-h-11 w-full rounded-md border border-[#D1D5DB] px-3 text-base sm:text-sm" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="min-h-11" disabled={busy}>
              {approving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {manual ? "Approve and Add Time" : "Approve Correction"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => setMode("reject")}>
              Reject
            </Button>
          </div>
        </form>
      ) : (
        <form action={rejectAction} className="space-y-2">
          <input type="hidden" name="correction_id" value={correctionId} />
          <label htmlFor={`reject-remarks-${correctionId}`} className="block text-xs font-bold text-[#374151]">
            Reason for rejecting <span className="text-[#ED1C24]">*</span>
          </label>
          <input id={`reject-remarks-${correctionId}`} name="remarks" required minLength={3} maxLength={500} disabled={busy} className="focus-ring min-h-11 w-full rounded-md border border-[#D1D5DB] px-3 text-base sm:text-sm" />
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => setMode("idle")}>
              Back
            </Button>
            <Button type="submit" variant="danger" className="min-h-11" disabled={busy}>
              {rejecting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {manual ? "Reject — Do Not Add Time" : "Reject and Keep System Time"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function TimeBlock({
  title,
  start,
  end,
  minutes,
  highlight,
  startTimeKnown = true,
  endTimeKnown = true,
}: {
  title: string;
  start: string;
  end: string;
  minutes: number;
  highlight?: boolean;
  startTimeKnown?: boolean;
  endTimeKnown?: boolean;
}) {
  return (
    <div className={`rounded-md border p-2.5 ${highlight ? "border-blue-200 bg-blue-50/60" : "border-[#E5E7EB] bg-[#F9FAFB]"}`}>
      <p className="text-[10px] font-black uppercase tracking-wide text-[#6B7280]">{title}</p>
      <p className="mt-1 text-sm text-[#111827]">Start: {formatKuwaitMoment(start, startTimeKnown)}</p>
      <p className="text-sm text-[#111827]">End: {formatKuwaitMoment(end, endTimeKnown)}</p>
      <p className="mt-0.5 text-sm font-black text-[#111827]">{formatDurationMinutes(minutes)}</p>
    </div>
  );
}

export function TimeCorrectionsPanel({ corrections, canReview }: { corrections: TimeCorrectionView[]; canReview: boolean }) {
  if (corrections.length === 0) return null;
  const pendingCount = corrections.filter((c) => c.status === "Pending").length;

  return (
    <div className="mt-5 border-t border-[#E5E7EB] pt-4" aria-labelledby="time-corrections-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="time-corrections-heading" className="text-sm font-black uppercase tracking-wide text-[#111827]">
          Manual Time and Corrections
        </h3>
        {pendingCount ? <StatusBadge label={`${pendingCount} older ${pendingCount === 1 ? "entry" : "entries"} waiting for decision`} tone="amber" /> : null}
      </div>
      <p className="mt-1 text-xs text-[#6B7280]">
        Kuwait time. Saved entries are already counted in the worker&apos;s hours; the Manager reviews them when approving the Job Card closure. An older entry still waiting for a decision is not counted until the Manager approves it.
      </p>
      <div className="mt-3 space-y-3">
        {corrections.map((c) => {
          const status = STATUS_LABEL[c.status];
          const manual = c.kind === "manual_entry";
          return (
            <article key={c.id} className="rounded-md border border-[#E5E7EB] bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-black text-[#111827]">{c.workerName}</p>
                <div className="flex flex-wrap gap-1">
                  {isUnusuallyLongPeriod(c.correctedMinutes) ? (
                    <StatusBadge label={`Unusually long (over ${LONG_PERIOD_REVIEW_MINUTES / 60} h) — check carefully`} tone="amber" />
                  ) : null}
                  <StatusBadge label={manual ? "Manually Entered" : c.directByManager ? "Corrected by Manager" : "Manually Corrected"} tone="gray" />
                  <StatusBadge label={status.label} tone={status.tone} />
                </div>
              </div>
              {manual || c.originalStart === null || c.originalEnd === null || c.originalMinutes === null ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <TimeBlock
                  title="Entered manually (dates and hours worked)"
                  start={c.correctedStart}
                  end={c.correctedEnd}
                  minutes={c.correctedMinutes}
                  startTimeKnown={c.startTimeKnown}
                  endTimeKnown={c.endTimeKnown}
                  highlight
                />
                </div>
              ) : (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <TimeBlock title={c.directByManager ? "Before this correction" : "System recorded"} start={c.originalStart} end={c.originalEnd} minutes={c.originalMinutes} />
                  <TimeBlock title="Manual correction" start={c.correctedStart} end={c.correctedEnd} minutes={c.correctedMinutes} highlight />
                </div>
              )}
              <p className="mt-2 text-sm text-[#374151]">
                {manual ? (
                  <>
                    Adds: <strong>{formatDurationMinutes(c.correctedMinutes)}</strong>
                  </>
                ) : (
                  <>
                    Difference: <strong>{signedDuration(c.correctedMinutes - (c.originalMinutes ?? 0))}</strong>
                  </>
                )}
                {c.costImpact && manual ? (
                  <span className="text-[#4B5563]">
                    {" "}· Labor cost +{c.costImpact.correctedAmount.toFixed(3)} KWD
                  </span>
                ) : c.costImpact ? (
                  <span className="text-[#4B5563]">
                    {" "}· Labor cost {c.costImpact.originalAmount.toFixed(3)} → {c.costImpact.correctedAmount.toFixed(3)} KWD (
                    {c.costImpact.difference >= 0 ? "+" : ""}
                    {c.costImpact.difference.toFixed(3)} KWD)
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-sm text-[#374151]">
                <span className="font-bold">Reason:</span> {c.reason}
              </p>
              <p className="mt-1 text-xs text-[#6B7280]">
                {manual ? "Entered by" : c.directByManager ? "Corrected directly by the Manager" : "Corrected by"} {c.requestedByName} on {formatKuwaitDateTime(c.requestedAt)}
              </p>
              {c.directByManager || c.status === "Recorded" ? null : c.status !== "Pending" ? (
                <p className="mt-1 text-xs text-[#6B7280]">
                  {c.status === "Approved" ? "Approved" : "Rejected"} by {c.reviewedByName ?? "-"} on {formatKuwaitDateTime(c.reviewedAt)}
                  {c.reviewRemarks ? ` — ${c.reviewRemarks}` : ""}
                </p>
              ) : canReview && !c.requestedByMe ? (
                <ReviewButtons correctionId={c.id} kind={c.kind} />
              ) : (
                <p className="mt-1 text-xs font-semibold text-amber-700">Older entry — waiting for the Maintenance Manager to approve or reject it.</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
