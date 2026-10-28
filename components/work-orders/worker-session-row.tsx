"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2, Pause, Play, PlusCircle, X } from "lucide-react";

import {
  startWorkSessionAction,
  pauseWorkSessionAction,
  finishWorkSessionAction,
  type WorkSessionState,
} from "@/app/actions/work-sessions";
import { StatusBadge } from "@/components/ui/status-badge";
import { LiveTimer } from "@/components/work-orders/live-timer";
import { ManualTimeEntryModal } from "@/components/work-orders/manual-time-entry-modal";
import { ManualWorkTimeForm } from "@/components/work-orders/manual-work-time-form";
import { formatDurationMinutes, formatKuwaitDateTime } from "@/lib/format/kuwait-time";
import { SessionHistoryModal } from "@/components/work-orders/session-history-modal";
import { dispatchActionToast } from "@/lib/action-messages";
import type { WorkerLaborRow } from "@/lib/work-orders/work-session-totals";
import {
  computeHoursVariance,
  hoursVarianceTone,
  deriveSimpleWorkerState,
  simpleWorkerStateTone,
  type SimpleWorkerState,
} from "@/lib/work-orders/hours-variance";

// Worker Timer and Closure Logic Hardening Unit 10G.53, Task 2: the badge
// (and every button below it) now reads off the plain 4-state model —
// Not Started / Working / Paused / Finished — instead of the raw session
// status (Active/Paused/Completed) and the assignment's "finished" flag
// separately. "Do not show confusing technical statuses."
function statusAccent(state: SimpleWorkerState): string {
  if (state === "Working") return "border-l-[#16A34A]";
  if (state === "Paused") return "border-l-[#F59E0B]";
  if (state === "Finished") return "border-l-[#2563EB]";
  return "border-l-[#D1D5DB]";
}

function SessionActionForm({
  action,
  workOrderId,
  workerAssignmentId,
  label,
  icon: Icon,
  toastTitle,
  className,
}: {
  action: (state: WorkSessionState, formData: FormData) => Promise<WorkSessionState>;
  workOrderId: string;
  workerAssignmentId: string;
  label: string;
  icon: typeof Play;
  // Popup and Feedback Design Standardization Unit 8D, Task 6: Start/Pause/
  // Stop/Resume Work previously gave no success feedback at all — only a
  // silent re-render (via revalidatePath) on success, and an inline red
  // error paragraph on failure. Fires the same shared toast every other
  // quick action uses, without turning this into a full modal.
  toastTitle: string;
  className: string;
}) {
  const [state, formAction, isPending] = useActionState<WorkSessionState, FormData>(action, null);
  const lastHandled = useRef<WorkSessionState>(null);

  useEffect(() => {
    if (state === lastHandled.current) return;
    lastHandled.current = state;
    if (state?.ok === true) {
      dispatchActionToast({ tone: "success", title: toastTitle });
    }
  }, [state, toastTitle]);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="work_order_id" value={workOrderId} />
      <input type="hidden" name="worker_assignment_id" value={workerAssignmentId} />
      <button type="submit" disabled={isPending} className={className}>
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Icon className="h-3.5 w-3.5" aria-hidden />}
        {label}
      </button>
      {state?.ok === false && <p className="mt-1 text-xs text-red-700">{state.error}</p>}
    </form>
  );
}

// Record Additional Work — for a worker whose time on THIS Job Card was
// already entered manually. The recorded hours are never changed: the user
// either starts the timer for NEW work (confirmed with a tick; the server
// refuses a plain Start here) or enters more hours manually (a separate new
// record, with the usual duplicate and overlap checks).
function AdditionalWorkDialog({
  workOrderId,
  workerAssignmentId,
  workerName,
  recordedMinutes,
  canEnterManually,
  onEnterManually,
  onClose,
}: {
  workOrderId: string;
  workerAssignmentId: string;
  workerName: string;
  recordedMinutes: number;
  canEnterManually: boolean;
  onEnterManually: () => void;
  onClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState<WorkSessionState, FormData>(startWorkSessionAction, null);
  const [confirmed, setConfirmed] = useState(false);
  const handled = useRef<WorkSessionState>(null);

  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state?.ok) {
      dispatchActionToast({ tone: "success", title: "Timer started for new work", description: `The ${formatDurationMinutes(recordedMinutes)} already recorded stay unchanged.` });
      onClose();
    }
  }, [state, onClose, recordedMinutes]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isPending, onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={() => !isPending && onClose()} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" role="presentation">
        <div role="dialog" aria-modal="true" aria-labelledby="additional-work-heading" className="w-full max-w-md rounded-xl bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
            <h2 id="additional-work-heading" className="text-lg font-black text-[#111827]">
              Record Additional Work
            </h2>
            <button type="button" onClick={onClose} disabled={isPending} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[#4B5563] hover:bg-gray-100">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-4 px-5 py-4 text-sm">
            <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900">
              <strong>{workerName}</strong> already has <strong>{formatDurationMinutes(recordedMinutes)}</strong> recorded manually on this Job Card. That record stays
              exactly as it is. Use this only if the worker has <strong>new</strong> work to do.
            </p>
            <form action={formAction} className="space-y-3 rounded-md border border-[#E5E7EB] p-3">
              <input type="hidden" name="work_order_id" value={workOrderId} />
              <input type="hidden" name="worker_assignment_id" value={workerAssignmentId} />
              <input type="hidden" name="additional_work" value="1" />
              <label className="flex min-h-11 cursor-pointer items-start gap-2 font-semibold text-[#111827]">
                <input
                  type="checkbox"
                  name="confirm_additional_work"
                  required
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={isPending}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[#ED1C24]"
                />
                This is new work — not the time already recorded.
              </label>
              {state?.ok === false ? (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                  {state.error}
                </p>
              ) : null}
              <button type="submit" disabled={isPending || !confirmed} className={`${btnStart} min-h-11 w-full justify-center text-sm`}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                Start Timer for New Work
              </button>
            </form>
            {canEnterManually ? (
              <button type="button" onClick={onEnterManually} disabled={isPending} className={`${btnSecondary} min-h-11 w-full justify-center text-sm`}>
                <Clock className="h-4 w-4" aria-hidden /> Enter More Hours Manually
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

// Daily Activity UI/UX Simplification Unit 9B, Task 7: Start/Resume green
// (the "go" action), Stop is the one red button in this row (ending a
// session is the deliberate, attention-worthy click), Pause is a distinct
// amber outline (not full red, not plain neutral — "pay attention but not
// urgent"), View/Manual stay neutral.
const btnStart =
  "inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[#16A34A] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-green-700 disabled:opacity-60";
// Worker Timer and Closure Logic Hardening Unit 10G.53, Task 3: "Finish
// Work" replaces the old plain "Stop" button — same red "this is the
// deliberate, attention-worthy click" treatment Stop had, since it's now the
// only way to end a worker's involvement on this Job Card for good.
const btnFinish =
  "inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-red-700 disabled:opacity-60";
const btnPause =
  "inline-flex min-h-9 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60";
const btnSecondary =
  "inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-bold text-[#4B5563] transition hover:bg-gray-50 disabled:opacity-60";

export function WorkerSessionRow({
  workOrderId,
  worker,
  canManageSessions,
  isManager,
  canViewCosts,
  // Daily Activity / Active Job Cards Work Tracking Unit 9, Task 5: optional
  // so the Job Card detail page's existing call site (which doesn't compute
  // a "today" figure) is completely unaffected — only rendered when a host
  // page passes it.
  todayHours,
  // Worker Time Correction (all optional — Daily Activity's call site is
  // unchanged): Data Entry's Correct Time inside View Sessions, and the
  // row's "Time Manually Corrected" / "Correction waiting" indicators.
  canRequestCorrection = false,
  jobCardNumber,
  corrections,
  // Manual Worker Time Entry (all optional): Data Entry's "Enter Time
  // Manually" (saved at once, reviewed in Closure Review), this worker's
  // OLDER entries still waiting for a decision, and how much of the
  // recorded time was entered manually.
  canRequestManualTime = false,
  pendingManualEntries = [],
  manualMinutes = 0,
}: {
  workOrderId: string;
  worker: WorkerLaborRow;
  canManageSessions: boolean;
  isManager: boolean;
  canViewCosts: boolean;
  todayHours?: number;
  canRequestCorrection?: boolean;
  jobCardNumber?: string | null;
  corrections?: { pending: number; approved: number };
  canRequestManualTime?: boolean;
  pendingManualEntries?: { start: string; end: string; minutes: number }[];
  manualMinutes?: number;
}) {
  const [showManualTime, setShowManualTime] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAdditionalWork, setShowAdditionalWork] = useState(false);
  // Worker Timer and Closure Logic Hardening Unit 10G.53, Task 2: the single
  // simple state everything below (badge, live timer, buttons) reads from.
  const simpleState = deriveSimpleWorkerState(worker.assignment_status, worker.status);
  const isWorking = simpleState === "Working";
  // Task 3: Manual Entry / View Sessions in the "Not Started" bucket are
  // only offered once there's actually history to correct/review — a
  // worker who never started at all gets just the Start button, matching
  // the old "Completed"-only gate for these two (see the removed status
  // === "Completed" branch this replaces).
  const hasHistory = worker.total_minutes > 0;
  // Manual Time Recorded — from the stored periods of THIS assignment (not
  // browser state): the plain Start is disabled (the server refuses it too)
  // and new work goes through Record Additional Work. The lifecycle stays
  // "Not Finished" until someone marks the work finished.
  const recordedManualMinutes = worker.manual_minutes ?? manualMinutes;
  const hasManualTime = recordedManualMinutes > 0;
  const lifecycleLabel = simpleState === "Not Started" && hasManualTime ? "Not Finished" : simpleState;

  return (
    <div className={`rounded-md border border-[#E5E7EB] border-l-4 bg-white p-2.5 ${statusAccent(simpleState)}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        {/* Left — who, role, status (Task 7) */}
        <div className="min-w-0 sm:w-40 sm:shrink-0">
          <p className="truncate text-sm font-bold text-[#111827]">{worker.worker_name}</p>
          <p className="truncate text-xs text-[#6B7280]">
            {worker.worker_role}
            {canViewCosts ? ` — ${worker.hourly_rate_snapshot.toFixed(3)} KWD/hr` : ""}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <StatusBadge label={lifecycleLabel} tone={lifecycleLabel === "Not Finished" ? "amber" : simpleWorkerStateTone(simpleState)} />
            {corrections?.approved ? <StatusBadge label="Time Manually Corrected" tone="blue" /> : null}
            {corrections?.pending ? <StatusBadge label="Correction waiting" tone="amber" /> : null}
            {hasManualTime ? <StatusBadge label="Manual Time Recorded" tone="blue" /> : null}
            {pendingManualEntries.length ? <StatusBadge label="Older manual time waiting for Manager" tone="amber" /> : null}
          </div>
        </div>

        {/* Middle — today/total time, live timer when working (Task 8 —
            timer gets its own highlighted chip so it's the first thing a
            glance lands on for an active worker). */}
        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1">
          {isWorking && worker.active_session_started_at ? (
            <div className="rounded-md bg-green-50 px-2 py-1">
              <p className="text-[9px] font-black uppercase tracking-wide text-[#16A34A]">Live</p>
              {/* Daily Activity Timer Reliability Unit 10G.24, Task 3: keyed
                  by the session's own stable id (falling back to
                  startedAt if it's ever unavailable) — guarantees a
                  genuinely new/resumed session is always a fresh,
                  correctly-ticking instance, never one that could reuse
                  stale internal state from a previous session occupying
                  the same position in the tree. */}
              <LiveTimer
                key={worker.active_session_id ?? worker.active_session_started_at}
                startedAt={worker.active_session_started_at}
                className="font-mono text-xl font-black tabular-nums text-[#16A34A]"
              />
            </div>
          ) : null}
          {todayHours !== undefined && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-wide text-[#9CA3AF]">Today</p>
              <p className="text-sm font-bold text-[#111827]">{todayHours} h</p>
            </div>
          )}
          <div>
            <p className="text-[9px] font-black uppercase tracking-wide text-[#9CA3AF]">Total</p>
            <p className="text-sm font-bold text-[#111827]">{worker.total_hours} h</p>
          </div>
          {/* Estimated Work Hours for Job Cards and Workers Unit 10G.13,
              Task 6: per-worker Estimated/Variance/Status — hours only,
              visible regardless of canViewCosts (never gated with Cost
              below). Nothing shown at all when this worker has no
              estimate, matching Task 5's "No estimate recorded" rule at the
              row level (no clutter for the common no-estimate case). */}
          {worker.estimated_hours !== null && (() => {
            const variance = computeHoursVariance(worker.estimated_hours, worker.total_hours);
            return (
              <div>
                <p className="text-[9px] font-black uppercase tracking-wide text-[#9CA3AF]">Estimated</p>
                <p className="text-sm font-bold text-[#111827]">
                  {worker.estimated_hours} h
                  {variance.varianceHours !== null && (
                    <span className="ml-1 font-normal text-[#6B7280]">
                      ({variance.varianceHours >= 0 ? "+" : ""}{variance.varianceHours} h)
                    </span>
                  )}
                </p>
                <StatusBadge label={variance.label} tone={hoursVarianceTone(variance.status)} />
              </div>
            );
          })()}
          {canViewCosts && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-wide text-[#9CA3AF]">Cost</p>
              <p className="text-sm font-bold text-[#111827]">{worker.total_amount.toFixed(3)} KWD</p>
            </div>
          )}
        </div>

        {/* Right — main action buttons (Unit 10G.53, Task 3 button rules,
            by simple state):
              Not Started -> Start (+ Manual Entry/View Sessions once there
                is prior session history to correct/review)
              Working     -> Pause, Finish Work
              Paused      -> Resume, Finish Work, View Sessions
              Finished    -> read-only, no Resume — just View Sessions */}
        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
          {canManageSessions && simpleState === "Not Started" ? (
            <>
              {hasManualTime ? (
                <>
                  <button
                    type="button"
                    disabled
                    aria-describedby={`manual-recorded-${worker.worker_assignment_id}`}
                    title="Manual time is recorded for this worker. Use Record Additional Work for new work."
                    className={`${btnStart} cursor-not-allowed`}
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden />
                    Start
                  </button>
                  <span id={`manual-recorded-${worker.worker_assignment_id}`} className="sr-only">
                    Start is turned off because manual time is recorded for this worker on this Job Card.
                  </span>
                  <button type="button" onClick={() => setShowAdditionalWork(true)} className={btnSecondary}>
                    <PlusCircle className="h-3.5 w-3.5" aria-hidden />
                    Record Additional Work
                  </button>
                </>
              ) : (
                <>
                  <SessionActionForm
                    action={startWorkSessionAction}
                    workOrderId={workOrderId}
                    workerAssignmentId={worker.worker_assignment_id}
                    label="Start"
                    icon={Play}
                    toastTitle="Work Session Started"
                    className={btnStart}
                  />
                  {canRequestManualTime && (
                    <button type="button" onClick={() => setShowManualTime(true)} className={btnSecondary}>
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                      Enter Time Manually
                    </button>
                  )}
                </>
              )}
              {/* Manual Worker Time Entry: a worker whose time was recorded
                  without the timer stays "Not Started" until someone
                  explicitly marks the work finished — saving hours never
                  finishes the worker, and no artificial timer is needed. Not
                  offered while an older entry still waits for a decision
                  (the server refuses that too). */}
              {hasHistory && pendingManualEntries.length === 0 && (
                <SessionActionForm
                  action={finishWorkSessionAction}
                  workOrderId={workOrderId}
                  workerAssignmentId={worker.worker_assignment_id}
                  label="Mark Work Finished"
                  icon={CheckCircle2}
                  toastTitle="Worker Finished"
                  className={btnFinish}
                />
              )}
              {hasHistory && (
                <>
                  {/* Daily Activity Timer Reliability and Remove Data Entry
                      Manual Entry Unit 10G.24, Task 5/6: manual time entry
                      can be used to fabricate hours never actually worked,
                      so it's Manager/Super Admin only — Data Entry's only
                      path to recorded time is the real Start/Pause/Resume/
                      Finish flow. isManager already means super_admin OR
                      maintenance_manager (see page.tsx). */}
                  {isManager && (
                    <button type="button" onClick={() => setShowManualEntry(true)} className={btnSecondary}>
                      Add Manual Entry
                    </button>
                  )}
                  <button type="button" onClick={() => setShowHistory(true)} className={btnSecondary}>
                    View Sessions
                  </button>
                </>
              )}
            </>
          ) : null}

          {canManageSessions && simpleState === "Working" ? (
            <>
              <SessionActionForm
                action={pauseWorkSessionAction}
                workOrderId={workOrderId}
                workerAssignmentId={worker.worker_assignment_id}
                label="Pause"
                icon={Pause}
                toastTitle="Work Session Paused"
                className={btnPause}
              />
              <SessionActionForm
                action={finishWorkSessionAction}
                workOrderId={workOrderId}
                workerAssignmentId={worker.worker_assignment_id}
                label="Finish Work"
                icon={CheckCircle2}
                toastTitle="Worker Finished"
                className={btnFinish}
              />
            </>
          ) : null}

          {canManageSessions && simpleState === "Paused" ? (
            <>
              <SessionActionForm
                action={startWorkSessionAction}
                workOrderId={workOrderId}
                workerAssignmentId={worker.worker_assignment_id}
                label="Resume"
                icon={Play}
                toastTitle="Work Session Started"
                className={btnStart}
              />
              <SessionActionForm
                action={finishWorkSessionAction}
                workOrderId={workOrderId}
                workerAssignmentId={worker.worker_assignment_id}
                label="Finish Work"
                icon={CheckCircle2}
                toastTitle="Worker Finished"
                className={btnFinish}
              />
              <button type="button" onClick={() => setShowHistory(true)} className={btnSecondary}>
                View Sessions
              </button>
              {canRequestManualTime && (
                <button type="button" onClick={() => setShowManualTime(true)} className={btnSecondary}>
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  Enter Time Manually
                </button>
              )}
            </>
          ) : null}

          {/* Finished — no Resume, read-only from here on (Task 3). Session
              history stays reachable so the recorded time is never hidden. */}
          {canManageSessions && simpleState === "Finished" ? (
            <button type="button" onClick={() => setShowHistory(true)} className={btnSecondary}>
              View Sessions
            </button>
          ) : null}

          {/* Read-only viewer (no work_orders.assign permission) — history
              stays reachable regardless of state. */}
          {!canManageSessions && (
            <button type="button" onClick={() => setShowHistory(true)} className={btnSecondary}>
              View Sessions
            </button>
          )}
        </div>
      </div>

      {pendingManualEntries.length ? (
        // Only entries sent before single closure approval can still wait for
        // a decision; new manual time is saved at once.
        <ul className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900" aria-label="Older manual time waiting for the Manager">
          {pendingManualEntries.map((e) => (
            <li key={e.start}>
              <span className="font-bold">Older entry waiting for the Manager:</span> {formatKuwaitDateTime(e.start)} → {formatKuwaitDateTime(e.end)} ({formatDurationMinutes(e.minutes)}) — not counted until approved
            </li>
          ))}
        </ul>
      ) : null}

      {showManualTime && (
        <ManualWorkTimeForm
          workerAssignmentId={worker.worker_assignment_id}
          workerName={worker.worker_name}
          jobCardNumber={jobCardNumber ?? null}
          hasRecordedTime={hasHistory}
          onClose={() => setShowManualTime(false)}
        />
      )}
      {showAdditionalWork && (
        <AdditionalWorkDialog
          workOrderId={workOrderId}
          workerAssignmentId={worker.worker_assignment_id}
          workerName={worker.worker_name}
          recordedMinutes={recordedManualMinutes}
          canEnterManually={canRequestManualTime}
          onEnterManually={() => {
            setShowAdditionalWork(false);
            setShowManualTime(true);
          }}
          onClose={() => setShowAdditionalWork(false)}
        />
      )}
      {hasManualTime && simpleState === "Not Started" ? (
        <p className="mt-2 text-xs text-[#4B5563]">
          {formatDurationMinutes(recordedManualMinutes)} recorded manually. Mark Work Finished when the work is done, or use Record Additional Work if there is new work.
        </p>
      ) : null}
      {showManualEntry && (
        <ManualTimeEntryModal
          workOrderId={workOrderId}
          workerAssignmentId={worker.worker_assignment_id}
          workerName={worker.worker_name}
          onClose={() => setShowManualEntry(false)}
        />
      )}
      {showHistory && (
        <SessionHistoryModal
          workerAssignmentId={worker.worker_assignment_id}
          workerName={worker.worker_name}
          isManager={isManager}
          canViewCosts={canViewCosts}
          onClose={() => setShowHistory(false)}
          canRequestCorrection={canRequestCorrection && canManageSessions}
          jobCardNumber={jobCardNumber}
        />
      )}
    </div>
  );
}
