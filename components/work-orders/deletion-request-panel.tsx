"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";

import {
  approveJobCardDeletionAction,
  rejectJobCardDeletionAction,
  type JobCardDeletionActionState,
} from "@/app/actions/job-card-deletion";
import { Button } from "@/components/ui/button";
import { dispatchActionToast } from "@/lib/action-messages";
import { formatDurationMinutes, formatKuwaitDateTime } from "@/lib/format/kuwait-time";

// Job Card Deletion — the pending request as shown on the Job Card page.
// Everyone who can open the request sees what was asked and why; the
// Maintenance Manager (never the requester) also gets Approve / Reject.
// The server re-checks eligibility on Approve, so `blockedReasons` here is
// only a preview of what the server will say.

export type DeletionRequestPanelProps = {
  request: {
    id: string;
    reason: string;
    requestedByName: string;
    requestedAt: string;
    statusAtRequest: string;
  };
  jobCardNumber: string | null;
  assetLabel: string | null;
  currentStatusLabel: string;
  activity: {
    workersAssigned: string[];
    workSessionCount: number;
    recordedMinutes: number;
    materialsRequestNumbers: string[];
    requiredMaterialsCount: number;
    stockMovementCount: number;
    attachmentsCount: number;
  };
  blockedReasons: string[];
  canReview: boolean;
};

// Exported (Final Integration Review) so the Manager's Pending Deletion
// Requests list on the Job Cards page reuses the exact same Approve / Reject
// flow; ids come from useId so several rows can be on one page.
export function DeletionReviewForm({ requestId, blocked }: { requestId: string; blocked: boolean }) {
  const router = useRouter();
  const uid = useId();
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  // Success is handled inside the action callback, not an effect: the same
  // response refreshes this page, which is now "not found", so this panel
  // unmounts before an effect could run.
  const [approveState, approveAction, approving] = useActionState<JobCardDeletionActionState, FormData>(async (prev, formData) => {
    const result = await approveJobCardDeletionAction(prev, formData);
    if (result?.ok) {
      dispatchActionToast({ tone: "success", title: "Job Card deleted", description: result.message });
      router.push("/maintenance/work-orders");
    }
    return result;
  }, null);
  const [rejectState, rejectAction, rejecting] = useActionState<JobCardDeletionActionState, FormData>(rejectJobCardDeletionAction, null);
  const handled = useRef<JobCardDeletionActionState[]>([]);

  useEffect(() => {
    if (rejectState?.ok && !handled.current.includes(rejectState)) {
      handled.current.push(rejectState);
      dispatchActionToast({ tone: "info", title: "Delete request rejected", description: rejectState.message });
      setMode("idle");
    }
  }, [rejectState]);

  const error = (approveState?.ok === false && approveState.error) || (rejectState?.ok === false && rejectState.error) || null;
  const busy = approving || rejecting;

  return (
    <div className="mt-4 border-t border-red-200 pt-4">
      {error ? (
        <p role="alert" className="mb-3 rounded-md border border-red-300 bg-white p-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      {mode === "idle" ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="danger" className="min-h-11" disabled={blocked} onClick={() => setMode("approve")}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Approve Deletion
          </Button>
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => setMode("reject")}>
            Reject Request
          </Button>
        </div>
      ) : null}

      {mode === "approve" ? (
        <form action={approveAction} className="space-y-3">
          <input type="hidden" name="request_id" value={requestId} />
          <p className="text-sm font-bold text-[#111827]">
            Delete this Job Card? It will be hidden from all lists. Its number and history are kept and the number is never reused.
          </p>
          <label htmlFor={`${uid}-approve-remarks`} className="block text-sm font-bold text-[#374151]">
            Remarks (optional)
          </label>
          <textarea id={`${uid}-approve-remarks`} name="remarks" rows={2} maxLength={500} disabled={busy} className="focus-ring w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-base" />
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => setMode("idle")}>
              Back
            </Button>
            <Button type="submit" variant="danger" className="min-h-11" disabled={busy}>
              {approving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              Yes, Delete Job Card
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "reject" ? (
        <form action={rejectAction} className="space-y-3">
          <input type="hidden" name="request_id" value={requestId} />
          <label htmlFor={`${uid}-reject-remarks`} className="block text-sm font-bold text-[#374151]">
            Reason for rejecting <span className="text-[#ED1C24]">*</span>
          </label>
          <textarea id={`${uid}-reject-remarks`} name="remarks" rows={2} required minLength={3} maxLength={500} disabled={busy} className="focus-ring w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-base" />
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => setMode("idle")}>
              Back
            </Button>
            <Button type="submit" className="min-h-11" disabled={busy}>
              {rejecting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              Reject and Keep Job Card
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function DeletionRequestPanel({ request, jobCardNumber, assetLabel, currentStatusLabel, activity, blockedReasons, canReview }: DeletionRequestPanelProps) {
  const facts: Array<[string, string]> = [
    ["Job Card", jobCardNumber ?? "-"],
    ["Asset", assetLabel ?? "No asset linked"],
    ["Requested by", request.requestedByName],
    ["Requested on", formatKuwaitDateTime(request.requestedAt)],
    ["Current status", currentStatusLabel],
  ];
  const activityLines = [
    activity.workersAssigned.length ? `Workers assigned: ${activity.workersAssigned.join(", ")}` : "No workers assigned",
    activity.workSessionCount
      ? `Work time recorded: ${activity.workSessionCount} period${activity.workSessionCount === 1 ? "" : "s"}, ${formatDurationMinutes(activity.recordedMinutes)}`
      : "No work time recorded",
    activity.materialsRequestNumbers.length ? `Materials Requests: ${activity.materialsRequestNumbers.join(", ")}` : "No Materials Requests",
    activity.stockMovementCount ? `Store movements: ${activity.stockMovementCount}` : "No store stock issued or received",
    `Required materials listed: ${activity.requiredMaterialsCount}`,
    `Attachments: ${activity.attachmentsCount}`,
  ];

  return (
    <section className="rounded-md border border-red-300 bg-red-50 p-4" aria-labelledby="deletion-request-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="deletion-request-heading" className="flex items-center gap-1.5 font-black text-red-800">
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Request to Delete Job Card
        </h2>
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-red-700">
          Waiting for Manager
        </span>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">{label}</dt>
            <dd className="break-words font-semibold text-[#111827]">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">Reason</p>
        <p className="mt-0.5 rounded-md border border-red-200 bg-white p-2 text-sm text-[#111827]">{request.reason}</p>
      </div>
      <div className="mt-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">Work and material activity</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[#374151]">
          {activityLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      {blockedReasons.length ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-black text-amber-800">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> This Job Card can no longer be deleted
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[#374151]">
            {blockedReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {canReview ? <p className="mt-1 text-sm text-[#4B5563]">Please reject this request.</p> : null}
        </div>
      ) : null}
      {canReview ? (
        <DeletionReviewForm requestId={request.id} blocked={blockedReasons.length > 0} />
      ) : (
        <p className="mt-3 text-sm text-[#4B5563]">The Maintenance Manager will approve or reject this request.</p>
      )}
    </section>
  );
}
