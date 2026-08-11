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
import { computeHoursVariance, hoursVarianceTone } from "@/lib/work-orders/hours-variance";

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

function statusTone(status: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (status === "Active") return "blue";
  if (status === "Paused") return "amber";
  if (status === "Completed") return "green";
  return "gray";
}
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
        <StatusBadge label={worker.status} tone={statusTone(worker.status)} />
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
        {canViewCosts && worker.hourlyRate !== null ? <span>Hourly Rate: <strong className="text-[#111827]">{worker.hourlyRate.toFixed(3)} KWD/hr</strong></span> : null}
        {canViewCosts && worker.totalPay !== null ? <span>Total Pay: <strong className="text-[#111827]">{worker.totalPay.toFixed(3)} KWD</strong></span> : null}
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

  const noActiveSession = !detail.workers.some((w) => w.status === "Active");
  // Task 8 — guidance-only checklist: materials/no-active-session mirror the
  // real backend guards read-only; the last two are the Manager's own
  // acknowledgement, never sent to the backend or used to block the button.
  const checklist = [
    { label: "Materials completed", ok: detail.materialsFullyIssued },
    { label: "No active worker session", ok: noActiveSession },
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

        {/* Closure Review Cleanup and Attachment Preview Unit 10G.25, Task
            1/2: the old "Labor Estimate vs Actual" top section (Estimated
            Hours / Actual Hours / Difference stat tiles + an overall
            variance badge) is removed — that same estimate-vs-actual
            comparison already lives on each worker's own card below (Task
            4), and duplicating it as a Job-Card-wide rollup here was taking
            space without adding information. Only the one figure that had
            no other home, total labor cost, survives — as a small standalone
            card, completely absent (not "0.000 KWD") for a Manager who
            cannot view costs. */}
        {detail.canViewCosts && detail.totalAmount !== null ? (
          <div className="inline-flex w-fit flex-col rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3.5 py-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Labor Cost</p>
            <p className="text-lg font-black text-[#111827]">{detail.totalAmount.toFixed(3)} KWD</p>
          </div>
        ) : null}

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
          {/* Unit 10G.21, Task 7: compact worker comparison table — quick
              scan of "who worked more / who worked less / who has no
              estimate" across every worker at once, alongside (not instead
              of) each worker's own card above. Only worth showing once
              there's more than one worker to compare. */}
          {detail.workers.length > 1 && (
            <div className="mt-2 overflow-x-auto rounded-md border border-[#E5E7EB]">
              <table className="w-full min-w-[520px] text-left text-[11px]">
                <thead className="bg-[#F9FAFB] text-[9px] font-black uppercase tracking-wide text-[#9CA3AF]">
                  <tr>
                    <th className="px-2 py-1.5">Worker</th>
                    <th className="px-2 py-1.5">Estimated</th>
                    <th className="px-2 py-1.5">Actual</th>
                    <th className="px-2 py-1.5">Difference</th>
                    <th className="px-2 py-1.5">Status</th>
                    {detail.canViewCosts ? <th className="px-2 py-1.5">Pay</th> : null}
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
                        <td className="px-2 py-1.5 text-[#4B5563]">
                          {variance.varianceHours !== null ? `${variance.varianceHours >= 0 ? "+" : ""}${variance.varianceHours} h` : "—"}
                        </td>
                        <td className="px-2 py-1.5">
                          <StatusBadge label={variance.label} tone={hoursVarianceTone(variance.status)} />
                        </td>
                        {detail.canViewCosts ? (
                          <td className="px-2 py-1.5 text-[#4B5563]">{w.totalPay !== null ? `${w.totalPay.toFixed(3)} KWD` : "—"}</td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
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
          ) : (
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
