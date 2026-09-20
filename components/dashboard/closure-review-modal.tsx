"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileText, Loader2, XCircle } from "lucide-react";

import { getClosureReviewDetailAction, type ClosureReviewDetail, type ClosureReviewWorker, type ClosureReviewAttachment } from "@/app/actions/closure-requests";
import { getSessionsForAssignmentAction } from "@/app/actions/work-sessions";
import { approveJobCardClosureModalAction } from "@/app/actions/workflow";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import { SessionHistoryModal } from "@/components/work-orders/session-history-modal";
import { AttachmentPreviewModal } from "@/components/dashboard/attachment-preview-modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { dispatchActionToast } from "@/lib/action-messages";
import type { SessionRow } from "@/lib/work-orders/work-session-totals";
import { computeHoursVariance, hoursVarianceTone, deriveSimpleWorkerState, simpleWorkerStateTone } from "@/lib/work-orders/hours-variance";
import { checkWorkersReadyForClosure } from "@/lib/work-orders/closure-readiness";

// Closure Requests Review Popup Unit 10G.2.
//
// Task 1/10: opened from the Closure Requests list's "Review Closure"
// button — fetches its OWN detail on demand (getClosureReviewDetailAction,
// Pattern B), never preloaded for the whole list. Per-worker session rows
// are fetched the same way, once per worker, only after this popup opens
// (getSessionsForAssignmentAction — the same call SessionHistoryModal
// already makes for one worker at a time; no bulk session query exists in
// this codebase, so N small parallel calls for the handful of workers on
// ONE Job Card is the only mechanism available and is cheap at this scale).
//
// Task 4: "Correct Session" swaps this popup's body for the EXISTING,
// completely unmodified SessionHistoryModal (Unit 8/10C.1) — same
// swap-in-place/swap-back pattern already used by WorkerActivityDetailModal
// and by the (now-simplified) Closure Requests list modal for the same
// purpose. Zero correction logic is duplicated here — this file adds no
// session-editing code, only entry points into the existing one, plus a
// read-only session table built from data the existing action already
// returns.

function materialsBadgeTone(status: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (status === "Fully Issued") return "green";
  if (status === "Partially Issued") return "amber";
  return "red";
}
function sessionStatusTone(status: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (status === "Active") return "blue";
  if (status === "Paused") return "amber";
  if (status === "Completed") return "green";
  if (status === "Cancelled") return "red";
  return "gray";
}
function formatSessionTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// Closure Review Work and Material Cost Unit 10G.72, Task 4/6 — one tile in
// the Job Card Cost Summary grid. `value` is only ever null when the whole
// summary block itself isn't rendered (canViewCosts false), so this never
// needs its own "hidden for your role" branch — it always receives a real
// number when actually mounted.
function CostTile({ label, value, emphasize }: { label: string; value: number | null; emphasize?: boolean }) {
  return (
    <div className={`rounded-md border p-2 text-center ${emphasize ? "border-[#ED1C24] bg-red-50" : "border-[#E5E7EB] bg-white"}`}>
      <p className={`font-black ${emphasize ? "text-lg text-[#ED1C24]" : "text-base text-[#111827]"}`}>{(value ?? 0).toFixed(3)} KWD</p>
      <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-[#6B7280]">{label}</p>
    </div>
  );
}

function SessionTable({
  sessions,
  canViewCosts,
  loading,
  onCorrect,
}: {
  sessions: SessionRow[] | null;
  canViewCosts: boolean;
  loading: boolean;
  onCorrect: (sessionId: string) => void;
}) {
  // Closure Review Cleanup Unit 10G.25, Task 5: session rows bumped from
  // text-[11px]/text-[10px] to text-sm/text-xs with more padding/gap — same
  // data (time range, duration, pay, status, correction reason), just easier
  // to scan. Correct Session is still rendered under the exact same
  // `canCorrect` condition as before — not removed or re-gated.
  if (loading) return <p className="mt-2 text-sm text-[#9CA3AF]">Loading sessions…</p>;
  if (!sessions || sessions.length === 0) return <p className="mt-2 text-sm text-[#9CA3AF]">No sessions recorded.</p>;

  return (
    <div className="mt-2 space-y-1.5">
      {sessions.map((s) => {
        const canCorrect = s.status !== "Active" && s.status !== "Cancelled";
        return (
          <div key={s.id} className="rounded-md border border-[#F3F4F6] bg-white px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-[#111827]">
                {formatSessionTime(s.started_at)} → {s.stopped_at ? formatSessionTime(s.stopped_at) : s.paused_at ? formatSessionTime(s.paused_at) : "—"}
              </span>
              <div className="flex items-center gap-1.5">
                {s.correction_reason ? <StatusBadge label="Corrected" tone="amber" /> : null}
                <StatusBadge label={s.status} tone={sessionStatusTone(s.status)} />
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[#6B7280]">
              <span>
                Duration: <strong className="text-[#111827]">{formatDuration(s.duration_minutes)}</strong>
                {/* Unit 10G.3, Task 3/6 (unchanged): session-level pay,
                    matching the task's own "Duration: 1m · Pay: 0.033 KWD"
                    example — same calculated_amount SessionHistoryModal
                    already shows. */}
                {canViewCosts ? (
                  <>
                    {" "}
                    · Pay: <strong className="text-[#111827]">{s.calculated_amount.toFixed(3)} KWD</strong>
                  </>
                ) : null}
              </span>
              {canCorrect ? (
                <button
                  type="button"
                  onClick={() => onCorrect(s.id)}
                  className="inline-flex min-h-7 items-center rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
                >
                  Correct Session
                </button>
              ) : null}
            </div>
            {s.correction_reason ? (
              <p className="mt-1 text-xs text-[#B45309]">
                Reason: {s.correction_reason}
                {s.edited_by_name ? ` · Edited by: ${s.edited_by_name}` : ""}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function WorkerReviewCard({
  worker,
  canViewCosts,
  sessions,
  sessionsLoading,
  onCorrect,
}: {
  worker: ClosureReviewWorker;
  canViewCosts: boolean;
  sessions: SessionRow[] | null;
  sessionsLoading: boolean;
  onCorrect: (workerAssignmentId: string, sessionId: string) => void;
}) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Closure Review Cleanup Unit 10G.25, Task 3: worker name bumped to
            text-base/text-lg bold (was text-sm) — this and the readability
            changes below are the main fix this unit asks for; nothing in
            this card's DATA changed, only its type scale/spacing. */}
        <p className="text-base font-bold text-[#111827] sm:text-lg">
          {worker.name} <span className="font-normal text-[#4B5563]">— {worker.role}</span>
          {worker.skillCategory ? <span className="ml-1 text-sm font-normal text-[#9CA3AF]">({worker.skillCategory})</span> : null}
        </p>
        {/* Unit 10G.53, Task 9/11: same simple 4-state label as everywhere
            else — by the time a Job Card reaches this review, every worker
            here should already read "Finished" (closure is now gated on
            it), not the raw, now-inconsistent session status "Completed". */}
        <StatusBadge
          label={deriveSimpleWorkerState(worker.assignmentStatus, worker.status)}
          tone={simpleWorkerStateTone(deriveSimpleWorkerState(worker.assignmentStatus, worker.status))}
        />
      </div>
      {/* Unit 10G.21, Task 6 (data/logic unchanged this unit — Task 4 of
          10G.25 keeps this exact block): Estimated/Actual/Variance/Status —
          always shown (hours only, unconditional on canViewCosts). A worker
          with no estimate shows "Estimated: Not recorded" plus a gray "No
          Estimate" badge (via computeHoursVariance's own no_estimate
          status) rather than nothing at all. Text bumped from text-xs to
          text-sm/text-base (Task 3) — still the main place a Manager
          compares planned vs actual per worker. */}
      {(() => {
        const variance = computeHoursVariance(worker.estimatedHours, worker.hours);
        return (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#4B5563] sm:text-base">
            <span>Estimated: <strong className="text-[#111827]">{worker.estimatedHours !== null ? `${worker.estimatedHours} h` : "Not recorded"}</strong></span>
            <span>Actual: <strong className="text-[#111827]">{worker.hours.toFixed(2)} h</strong></span>
            {variance.varianceHours !== null && (
              <span>Variance: <strong className="text-[#111827]">{variance.varianceHours >= 0 ? "+" : ""}{variance.varianceHours} h</strong></span>
            )}
            <StatusBadge label={variance.label} tone={hoursVarianceTone(variance.status)} />
          </div>
        );
      })()}
      {/* Unit 10G.3, Task 2/6 (data/logic unchanged this unit): Rate -> Total
          Pay -> Sessions. Rate/Total Pay both from worker.hourlyRate/
          worker.totalPay, which getClosureReviewDetailAction already
          resolves from the frozen hourly_rate_snapshot on this Job Card's
          assignment/sessions — never today's Worker Profile rate — and both
          are null (not just hidden) whenever canViewCosts is false. Text
          bumped from text-xs to text-sm (Task 3). */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-[#4B5563] sm:grid-cols-3">
        {/* Worker Salary Breakdown and Manager Labor Cost View Unit 10G.41B,
            Task 9: this whole modal is already Manager/Super-Admin-only
            (getClosureReviewDetailAction asserts isManagerRole before
            returning anything — Data Entry can never open it), so "Rate not
            set" only needs to be gated by canViewCosts, same as the numbers
            around it. */}
        {canViewCosts && worker.hourlyRate !== null ? (
          worker.hourlyRate > 0 ? (
            <span>Hourly Rate: <strong className="text-[#111827]">{worker.hourlyRate.toFixed(3)} KWD/hr</strong></span>
          ) : (
            <span className="font-semibold text-amber-700">Rate not set</span>
          )
        ) : null}
        {/* Closure Review Work and Material Cost Unit 10G.72, Task 3 —
            Direct Labor Cost / Indirect Cost / Total Worker Cost, replacing
            the old single "Total Pay" line. indirectCost is never null
            whenever canViewCosts is true (worker_profiles.indirect_cost_per_job_card
            defaults to 0), so an unconfigured worker naturally shows
            "0.000 KWD" here rather than needing a separate dash case. */}
        {canViewCosts && worker.directLaborCost !== null ? (
          <span>Direct Labor Cost: <strong className="text-[#111827]">{worker.directLaborCost.toFixed(3)} KWD</strong></span>
        ) : null}
        {canViewCosts && worker.indirectCost !== null ? (
          <span>Indirect Cost: <strong className="text-[#111827]">{worker.indirectCost.toFixed(3)} KWD</strong></span>
        ) : null}
        {canViewCosts && worker.totalWorkerCost !== null ? (
          <span>Total Worker Cost: <strong className="text-[#111827]">{worker.totalWorkerCost.toFixed(3)} KWD</strong></span>
        ) : null}
        <span>Sessions: <strong className="text-[#111827]">{worker.sessionsCount}</strong></span>
      </div>
      {/* Task 4 — session-level breakdown, inline under the worker (not
          behind a further click) — read-only display built from data
          already fetched; correction itself always goes through
          SessionHistoryModal, never re-implemented here. */}
      <SessionTable
        sessions={sessions}
        canViewCosts={canViewCosts}
        loading={sessionsLoading}
        onCorrect={(sessionId) => onCorrect(worker.workerAssignmentId, sessionId)}
      />
    </div>
  );
}

export function ClosureReviewModal({
  workOrderId,
  onClose,
  onApproved,
  onLoaded,
}: {
  workOrderId: string;
  onClose: () => void;
  onApproved: () => void;
  // Critical Workflow Popup Review Modal Unit 10G.7, Task 6: called exactly
  // once, the first time detail load SUCCEEDS — the critical popup uses this
  // to mark its source notification read only once the review has actually
  // opened, never on click alone and never if the load fails. Reused,
  // pre-existing callers of this modal (the Closure Requests dashboard
  // section) simply don't pass it, so their behavior is unchanged.
  onLoaded?: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<ClosureReviewDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sessionsByWorker, setSessionsByWorker] = useState<Map<string, SessionRow[]>>(new Map());
  const [sessionsFor, setSessionsFor] = useState<{ workerAssignmentId: string; workerName: string; sessionId: string } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // Closure Review Cleanup and Attachment Preview Unit 10G.25, Task 7: which
  // attachment's preview modal is open, if any — stacks above this popup
  // (see AttachmentPreviewModal's own z-[60]/z-[70]) rather than swapping it
  // out, unlike sessionsFor above which replaces this popup's body entirely.
  const [previewAttachment, setPreviewAttachment] = useState<ClosureReviewAttachment | null>(null);

  const [managerNote, setManagerNote] = useState("");
  const [reviewedHours, setReviewedHours] = useState(false);
  const [reviewedAttachments, setReviewedAttachments] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const hasCalledOnLoaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // Deliberately not resetting detail/loadError to null/false here first
    // (same pattern SessionHistoryModal's own reload already uses) — on a
    // reloadToken bump after a correction, the previous detail stays on
    // screen until the fresh fetch resolves, instead of flashing "Loading…"
    // mid-review.
    getClosureReviewDetailAction(workOrderId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setLoadError(true);
          return;
        }
        setDetail(result);
        if (!hasCalledOnLoaded.current) {
          hasCalledOnLoaded.current = true;
          onLoaded?.();
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
    // onLoaded intentionally excluded — it's a one-shot callback (guarded by
    // hasCalledOnLoaded itself), not a value this effect should re-run for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId, reloadToken]);

  useEffect(() => {
    if (!detail || detail.workers.length === 0) return;
    let cancelled = false;
    Promise.all(detail.workers.map((w) => getSessionsForAssignmentAction(w.workerAssignmentId).then((rows) => [w.workerAssignmentId, rows] as const))).then((entries) => {
      if (cancelled) return;
      setSessionsByWorker(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
    // detail is replaced wholesale on every reload, and workers is derived
    // from it — depending on detail itself (not detail.workers, a new array
    // identity every time) is intentional so this refetches after a
    // correction too.
  }, [detail]);
  // Derived, not stored — avoids a synchronous setState-in-effect (matches
  // this repo's react-hooks/set-state-in-effect lint rule) and is more
  // correct anyway: "loading" is simply "we have workers we haven't heard
  // back about yet."
  const sessionsLoading = detail ? detail.workers.some((w) => !sessionsByWorker.has(w.workerAssignmentId)) : false;

  function refetch() {
    setReloadToken((n) => n + 1);
    router.refresh(); // keeps the Closure Requests list's own summary figures in sync too
  }

  async function handleApprove() {
    if (!detail) return;
    setApproveError(null);
    setIsApproving(true);
    try {
      const form = new FormData();
      form.set("work_order_id", detail.id);
      form.set("comments", managerNote.trim());
      const result = await approveJobCardClosureModalAction(null, form);
      if (!result?.ok) {
        setApproveError(result?.error ?? "Failed to approve closure.");
        return;
      }
      dispatchActionToast({ tone: "success", title: "Job Card Closed", description: `${detail.workOrderNumber ?? "Job Card"} has been closed.` });
      onApproved();
    } finally {
      setIsApproving(false);
    }
  }

  if (sessionsFor) {
    return (
      <SessionHistoryModal
        workerAssignmentId={sessionsFor.workerAssignmentId}
        workerName={sessionsFor.workerName}
        isManager
        canViewCosts={detail?.canViewCosts ?? false}
        initialEditSessionId={sessionsFor.sessionId}
        jobCardNumber={detail?.workOrderNumber ?? null}
        assetLabel={detail?.assetLabel ?? null}
        onClose={() => {
          setSessionsFor(null);
          refetch();
        }}
      />
    );
  }

  if (loadError) {
    return (
      <LargeFormModal title="Closure Review" onClose={onClose}>
        <p className="text-sm text-[#6B7280]">Could not load this Job Card. It may no longer be visible to you.</p>
      </LargeFormModal>
    );
  }
  if (!detail) {
    return (
      <LargeFormModal title="Closure Review" onClose={onClose}>
        <p className="text-sm text-[#6B7280]">Loading…</p>
      </LargeFormModal>
    );
  }

  // Worker Timer and Closure Logic Hardening Unit 10G.53, Task 9: "All
  // workers finished" instead of "No active worker session" — by
  // construction every worker here should already be Finished (closure
  // requires it), but this keeps the wording consistent with every other
  // closure surface rather than a stale, narrower check.
  const allWorkersFinished = checkWorkersReadyForClosure(
    detail.workers.map((w) => ({
      workerAssignmentId: w.workerAssignmentId,
      workerName: w.name,
      assignmentStatus: w.assignmentStatus,
      sessionStatus: w.status,
    }))
  ).ready;
  // Task 8 — guidance-only checklist: materials/workers-finished mirror the
  // real backend guards read-only; the last two are the Manager's own
  // acknowledgement, never sent to the backend or used to block the button.
  const checklist = [
    { label: "Materials completed", ok: detail.materialsFullyIssued },
    { label: "All workers finished", ok: allWorkersFinished },
    { label: "Worker hours reviewed", ok: reviewedHours, manual: true },
    { label: "Attachments reviewed", ok: reviewedAttachments, manual: true },
  ];

  return (
    <>
      <LargeFormModal title="Closure Review" subtitle="Review work, materials, attachments, and labor before approving." onClose={onClose}>
      <div className="space-y-4">
        {/* Task 2 — Job Card summary */}
        <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-black text-[#111827]">{detail.workOrderNumber ?? "Job Card"}</p>
            <StatusBadge label="Closure Requested" tone="amber" />
          </div>
          <p className="mt-1 text-xs text-[#4B5563]">{detail.assetLabel ?? "No asset linked"}</p>
          <p className="mt-0.5 text-xs text-[#374151]">{detail.issue}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[#6B7280] sm:grid-cols-3">
            <span>Created: <strong className="text-[#111827]">{detail.createdAtLabel}</strong></span>
            <span>Closure requested: <strong className="text-[#111827]">{detail.closureRequestedAtLabel ?? "—"}</strong></span>
            <span>Time taken: <strong className="text-[#111827]">{detail.daysTakenLabel ?? "—"}</strong></span>
            <span>Requested by: <strong className="text-[#111827]">{detail.requestedByName ?? "Unknown"}</strong></span>
          </div>
        </div>

        {/* Task 3/4 — worker summary + per-worker session breakdown */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Workers</p>
            <p className="text-[11px] text-[#6B7280]">
              Total workers: <strong className="text-[#111827]">{detail.workersCount}</strong>
            </p>
          </div>
          {detail.workers.length === 0 ? (
            <p className="mt-1 text-xs text-[#9CA3AF]">No workers recorded on this Job Card.</p>
          ) : (
            <div className="mt-1.5 space-y-1.5">
              {detail.workers.map((w) => (
                <WorkerReviewCard
                  key={w.workerAssignmentId}
                  worker={w}
                  canViewCosts={detail.canViewCosts}
                  sessions={sessionsByWorker.get(w.workerAssignmentId) ?? null}
                  sessionsLoading={sessionsLoading}
                  onCorrect={(workerAssignmentId, sessionId) => setSessionsFor({ workerAssignmentId, workerName: w.name, sessionId })}
                />
              ))}
            </div>
          )}
          {/* Unit 10G.21, Task 7, extended by Closure Review Work and
              Material Cost Unit 10G.72, Task 3, repositioned/footed by
              Closure Review Cost Placement Polish Unit 10G.72A, Task 1/2:
              compact worker cost table — Worker/Estimated Hours/Actual
              Hours/Direct Labor Cost/Indirect Cost/Total Worker Cost/Status
              — alongside (not instead of) each worker's own card above.
              Unit 10G.72A widens this from "only when >1 worker" to always
              shown whenever at least one worker exists, so its own totals
              footer (Task 2's own explicit requirement) is always the place
              a Manager sees the worker cost totals, not just a duplicate of
              a single worker's own card. */}
          {detail.workers.length > 0 && (
            <div className="mt-2 overflow-x-auto rounded-md border border-[#E5E7EB]">
              <table className="w-full min-w-[640px] text-left text-[11px]">
                <thead className="bg-[#F9FAFB] text-[9px] font-black uppercase tracking-wide text-[#9CA3AF]">
                  <tr>
                    <th className="px-2 py-1.5">Worker</th>
                    <th className="px-2 py-1.5">Estimated Hours</th>
                    <th className="px-2 py-1.5">Actual Hours</th>
                    {detail.canViewCosts ? (
                      <>
                        <th className="px-2 py-1.5">Direct Labor Cost</th>
                        <th className="px-2 py-1.5">Indirect Cost</th>
                        <th className="px-2 py-1.5">Total Worker Cost</th>
                      </>
                    ) : null}
                    <th className="px-2 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {detail.workers.map((w) => {
                    const variance = computeHoursVariance(w.estimatedHours, w.hours);
                    return (
                      <tr key={w.workerAssignmentId}>
                        <td className="px-2 py-1.5 font-semibold text-[#111827]">{w.name}</td>
                        <td className="px-2 py-1.5 text-[#4B5563]">{w.estimatedHours !== null ? `${w.estimatedHours} h` : "—"}</td>
                        <td className="px-2 py-1.5 text-[#4B5563]">{w.hours.toFixed(2)} h</td>
                        {detail.canViewCosts ? (
                          <>
                            <td className="px-2 py-1.5 text-[#4B5563]">{w.directLaborCost !== null ? `${w.directLaborCost.toFixed(3)} KWD` : "—"}</td>
                            {/* Task 3 — "If worker indirect cost is empty or
                                0: Show 0.000 KWD or dash, but do not break
                                layout." indirectCost is never null here
                                (defaults to 0), so this naturally reads
                                "0.000 KWD" for an unconfigured worker. */}
                            <td className="px-2 py-1.5 text-[#4B5563]">{w.indirectCost !== null ? `${w.indirectCost.toFixed(3)} KWD` : "—"}</td>
                            <td className="px-2 py-1.5 font-semibold text-[#111827]">{w.totalWorkerCost !== null ? `${w.totalWorkerCost.toFixed(3)} KWD` : "—"}</td>
                          </>
                        ) : null}
                        <td className="px-2 py-1.5">
                          <StatusBadge label={variance.label} tone={hoursVarianceTone(variance.status)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Unit 10G.72A, Task 2/7 — the worker table's own totals
                    footer: Total Actual Hours / Direct Labor Cost total /
                    Indirect Cost total / labeled "Total Labor Cost". Slightly
                    shaded background + bold values, per the task's own exact
                    styling requirement. Uses the SAME already-computed
                    directLaborCostTotal/indirectCostTotal/totalLaborCost
                    figures from getClosureReviewDetailAction — no new
                    calculation here, purely a placement change. The ENTIRE
                    row (not just its cost cells) is gated on canViewCosts —
                    this footer's own label is "Total Labor Cost", so
                    rendering it at all without the cost permission would
                    itself be a cost-summary leak, even with the cost cells
                    individually blanked out (Task 7's "do not show cost
                    totals"). Non-cost users keep exactly what the table
                    already had (no footer). */}
                {detail.canViewCosts && (
                  <tfoot>
                    <tr className="border-t-2 border-[#E5E7EB] bg-[#F3F4F6] font-bold">
                      <td className="px-2 py-1.5 text-[#111827]">Total Labor Cost</td>
                      <td className="px-2 py-1.5 text-[#4B5563]">—</td>
                      <td className="px-2 py-1.5 text-[#111827]">
                        {detail.workers.reduce((sum, w) => sum + w.hours, 0).toFixed(2)} h
                      </td>
                      <td className="px-2 py-1.5 text-[#111827]">{detail.directLaborCostTotal !== null ? `${detail.directLaborCostTotal.toFixed(3)} KWD` : "—"}</td>
                      <td className="px-2 py-1.5 text-[#111827]">{detail.indirectCostTotal !== null ? `${detail.indirectCostTotal.toFixed(3)} KWD` : "—"}</td>
                      <td className="px-2 py-1.5 text-[#111827]">{detail.totalLaborCost !== null ? `${detail.totalLaborCost.toFixed(3)} KWD` : "—"}</td>
                      <td className="px-2 py-1.5"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        {/* Task 5 — materials review */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Materials</p>
            {detail.materials.length > 0 ? (
              detail.materialsFullyIssued ? (
                <StatusBadge label="Materials Completed" tone="green" />
              ) : (
                <StatusBadge label="Materials not fully issued" tone="red" />
              )
            ) : null}
          </div>
          {detail.materials.length === 0 ? (
            <p className="mt-1 text-xs text-[#9CA3AF]">No required materials on this Job Card.</p>
          ) : detail.canViewCosts ? (
            // Closure Review Work and Material Cost Unit 10G.72, Task 5/7 —
            // cost-permitted view: adds Unit/Unit Cost/Total Cost columns.
            // "Unpriced" (never "0.000 KWD") for a material with no recorded
            // unit cost, matching Task 5's own "do not invent costs" rule.
            <div className="mt-1.5 overflow-x-auto rounded-md border border-[#E5E7EB]">
              <table className="w-full min-w-[640px] text-left text-[11px]">
                <thead className="bg-[#F9FAFB] text-[9px] font-black uppercase tracking-wide text-[#9CA3AF]">
                  <tr>
                    <th className="px-2 py-1.5">Material</th>
                    <th className="px-2 py-1.5">Required</th>
                    <th className="px-2 py-1.5">Issued</th>
                    <th className="px-2 py-1.5">Remaining</th>
                    <th className="px-2 py-1.5">Unit</th>
                    <th className="px-2 py-1.5">Unit Cost</th>
                    <th className="px-2 py-1.5">Total Cost</th>
                    <th className="px-2 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {detail.materials.map((m, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5 font-semibold text-[#111827]">{m.description}</td>
                      <td className="px-2 py-1.5 text-[#4B5563]">{m.requiredQty}</td>
                      <td className="px-2 py-1.5 text-[#4B5563]">{m.issuedQty}</td>
                      <td className="px-2 py-1.5 text-[#4B5563]">{m.remainingQty}</td>
                      <td className="px-2 py-1.5 text-[#4B5563]">{m.unit}</td>
                      <td className="px-2 py-1.5 text-[#4B5563]">
                        {m.isUnpriced ? <span className="font-semibold text-amber-700">Unpriced</span> : m.unitCost !== null ? `${m.unitCost.toFixed(3)} KWD` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-[#4B5563]">
                        {m.isUnpriced ? <span className="font-semibold text-amber-700">Unpriced</span> : m.totalCost !== null ? `${m.totalCost.toFixed(3)} KWD` : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <StatusBadge label={m.status} tone={materialsBadgeTone(m.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Unit 10G.72A, Task 4 — the material table's own Total
                    Material Cost footer row, directly under the table (not
                    only in a separate top summary). Same already-computed
                    materialCostTotal from getClosureReviewDetailAction — no
                    new calculation here. */}
                <tfoot>
                  <tr className="border-t-2 border-[#E5E7EB] bg-[#F3F4F6] font-bold">
                    <td colSpan={6} className="px-2 py-1.5 text-right text-[#111827]">Total Material Cost</td>
                    <td className="px-2 py-1.5 text-[#111827]">{detail.materialCostTotal !== null ? `${detail.materialCostTotal.toFixed(3)} KWD` : "—"}</td>
                    <td className="px-2 py-1.5"></td>
                  </tr>
                </tfoot>
              </table>
              {/* Task 4 — the exact required combined wording, shown only
                  when at least one line has no recorded unit cost. */}
              {detail.hasUnpricedMaterial ? (
                <p className="border-t border-[#E5E7EB] bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-800">
                  Some materials do not have unit cost recorded. Material total excludes unpriced lines.
                </p>
              ) : null}
            </div>
          ) : (
            // Task 7 — non-cost users keep the existing status/quantity-only
            // view, unchanged.
            <ul className="mt-1 space-y-1">
              {detail.materials.map((m, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-[#111827]">{m.description}</span>
                  <span className="flex items-center gap-1.5 text-[#6B7280]">
                    Req {m.requiredQty} · Issued {m.issuedQty} · Remaining {m.remainingQty} {m.unit}
                    <StatusBadge label={m.status} tone={materialsBadgeTone(m.status)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Closure Review Cost Placement Polish Unit 10G.72A, Task 1/5/6 —
            the FINAL Job Card cost summary, moved from the very top (before
            Task 1's own "manager should first review workers, then
            materials, then final total") to here — after Workers and
            Materials, before Attachments/Closure Note/Review Checklist.
            Deliberately only 3 tiles (not a repeat of Direct/Indirect Labor
            Cost, already shown in the worker table's own footer above):
            Total Labor Cost, Total Material Cost, Grand Total Job Cost —
            avoiding the "same totals in too many places" Task 6 warns
            against. Same already-computed totalLaborCost/materialCostTotal/
            grandTotalJobCost figures — no new calculation here. */}
        {detail.canViewCosts && detail.grandTotalJobCost !== null ? (
          <div className="rounded-md border border-[#ED1C24]/30 bg-[#F9FAFB] p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Final Job Card Cost</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <CostTile label="Total Labor Cost" value={detail.totalLaborCost} />
              <CostTile label="Total Material Cost" value={detail.materialCostTotal} />
              <CostTile label="Grand Total Job Cost" value={detail.grandTotalJobCost} emphasize />
            </div>
            {detail.hasUnpricedMaterial ? (
              <p className="mt-2 text-xs font-semibold text-amber-700">Grand total excludes unpriced material lines.</p>
            ) : null}
          </div>
        ) : null}

        {/* Closure Review Cleanup Unit 10G.25, Task 6/7/8: attachments now
            sit inside one highlighted card (was a plain text list) so the
            section reads as its own distinct block; each row keeps every
            audit field the plain list already showed (type, file name,
            uploaded by, uploaded date/time — Task 8), just laid out more
            clearly. "Open" (a plain link that navigated away) is now
            "Preview" (Task 7), which opens AttachmentPreviewModal in place
            instead — the file itself is still never fetched until that
            click. */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Attachments</p>
          <div className="mt-1.5 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
            {detail.attachments.length === 0 ? (
              <p className="text-sm text-[#9CA3AF]">No attachments uploaded.</p>
            ) : (
              <ul className="space-y-2">
                {detail.attachments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#E5E7EB] bg-white px-3 py-2.5">
                    <div className="flex min-w-0 items-start gap-2">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[#9CA3AF]" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#111827]">{a.type}</p>
                        <p className="truncate text-sm text-[#4B5563]">{a.fileName}</p>
                        <p className="mt-0.5 text-xs text-[#9CA3AF]">
                          Uploaded by {a.uploadedByName ?? "Unknown"} · {a.uploadedAtLabel}
                        </p>
                      </div>
                    </div>
                    {a.viewUrl ? (
                      <button
                        type="button"
                        onClick={() => setPreviewAttachment(a)}
                        className="inline-flex min-h-8 shrink-0 items-center rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-bold text-[#2563EB] transition hover:bg-blue-50"
                      >
                        Preview
                      </button>
                    ) : (
                      <span className="shrink-0 text-xs text-[#9CA3AF]">Access restricted</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Task 7 — closure note. Unit 10G.25, Task 9: text bumped from
            text-xs to text-sm/leading-relaxed for readability — position
            (below Attachments, near the end) and content unchanged. */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Closure Note</p>
          <p className="mt-1.5 text-sm leading-relaxed text-[#374151]">{detail.note ? detail.note : "No remarks added."}</p>
        </div>

        {/* Task 8 — review checklist + Approve Closure */}
        <div className="rounded-md border border-green-200 bg-green-50 p-3">
          <p className="text-sm font-bold text-[#111827]">Review checklist</p>
          <ul className="mt-1.5 space-y-1">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-xs">
                {item.manual ? (
                  <button type="button" onClick={() => (item.label === "Worker hours reviewed" ? setReviewedHours((v) => !v) : setReviewedAttachments((v) => !v))} className="flex items-center gap-2">
                    {item.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" aria-hidden="true" /> : <XCircle className="h-4 w-4 shrink-0 text-[#9CA3AF]" aria-hidden="true" />}
                    <span className={item.ok ? "text-[#111827]" : "text-[#6B7280]"}>{item.label} (click to confirm)</span>
                  </button>
                ) : (
                  <>
                    {item.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" aria-hidden="true" /> : <XCircle className="h-4 w-4 shrink-0 text-[#9CA3AF]" aria-hidden="true" />}
                    <span className={item.ok ? "text-[#111827]" : "text-[#6B7280]"}>{item.label}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-[#6B7280]">
            Materials/session status mirror the real closure guards; the last two are your own confirmation and do not block approval.
          </p>

          <label className="mt-3 block text-xs font-bold text-[#4B5563]">Manager approval note (optional)</label>
          <textarea
            value={managerNote}
            onChange={(e) => setManagerNote(e.target.value)}
            placeholder="Approval notes (optional)"
            rows={2}
            disabled={isApproving}
            className="mt-1 w-full resize-none rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#16A34A] disabled:bg-gray-50"
          />
          {approveError ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{approveError}</span>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleApprove}
              disabled={isApproving}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[#16A34A] px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-[#15803d] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isApproving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {isApproving ? "Approving…" : "Approve Closure"}
            </button>
            <Link
              href={detail.detailHref}
              className="inline-flex min-h-9 items-center rounded-md border border-[#E5E7EB] bg-white px-3.5 py-1.5 text-sm font-bold text-[#111827] transition hover:bg-gray-50"
            >
              Open Full Job Card
            </Link>
            <button
              type="button"
              onClick={onClose}
              disabled={isApproving}
              className="inline-flex min-h-9 items-center rounded-md border border-[#E5E7EB] bg-white px-3.5 py-1.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
            >
              Back to List
            </button>
          </div>
        </div>
      </div>
      </LargeFormModal>
      {/* Task 7 — stacks above the still-open Closure Review popup; see
          AttachmentPreviewModal's own doc comment for the z-index/stacking
          rationale. */}
      {previewAttachment ? <AttachmentPreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} /> : null}
    </>
  );
}
