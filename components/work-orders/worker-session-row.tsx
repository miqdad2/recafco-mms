"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Square } from "lucide-react";

import {
  startWorkSessionAction,
  pauseWorkSessionAction,
  stopWorkSessionAction,
  type WorkSessionState,
} from "@/app/actions/work-sessions";
import { StatusBadge } from "@/components/ui/status-badge";
import { LiveTimer } from "@/components/work-orders/live-timer";
import { ManualTimeEntryModal } from "@/components/work-orders/manual-time-entry-modal";
import { SessionHistoryModal } from "@/components/work-orders/session-history-modal";
import { dispatchActionToast } from "@/lib/action-messages";
import type { WorkerLaborRow } from "@/lib/work-orders/work-session-totals";
import { computeHoursVariance, hoursVarianceTone } from "@/lib/work-orders/hours-variance";

function statusTone(status: WorkerLaborRow["status"]): "green" | "amber" | "blue" | "gray" {
  if (status === "Active") return "green";
  if (status === "Paused") return "amber";
  if (status === "Completed") return "blue";
  return "gray";
}

// Premium Job Card Detail Page Redesign Unit 8C.2, Task 7: a left accent bar
// so a worker's current state reads at a glance from the row's left edge,
// same "status color = accent" language used elsewhere on this page (Next
// Action panel, closure readiness).
function statusAccent(status: WorkerLaborRow["status"]): string {
  if (status === "Active") return "border-l-[#16A34A]";
  if (status === "Paused") return "border-l-[#F59E0B]";
  if (status === "Completed") return "border-l-[#2563EB]";
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

// Daily Activity UI/UX Simplification Unit 9B, Task 7: Start/Resume green
// (the "go" action), Stop is the one red button in this row (ending a
// session is the deliberate, attention-worthy click), Pause is a distinct
// amber outline (not full red, not plain neutral — "pay attention but not
// urgent"), View/Manual stay neutral.
const btnStart =
  "inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[#16A34A] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-green-700 disabled:opacity-60";
const btnStop =
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
}: {
  workOrderId: string;
  worker: WorkerLaborRow;
  canManageSessions: boolean;
  isManager: boolean;
  canViewCosts: boolean;
  todayHours?: number;
}) {
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const isWorking = worker.status === "Active";

  return (
    <div className={`rounded-md border border-[#E5E7EB] border-l-4 bg-white p-2.5 ${statusAccent(worker.status)}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        {/* Left — who, role, status (Task 7) */}
        <div className="min-w-0 sm:w-40 sm:shrink-0">
          <p className="truncate text-sm font-bold text-[#111827]">{worker.worker_name}</p>
          <p className="truncate text-xs text-[#6B7280]">
            {worker.worker_role}
            {canViewCosts ? ` — ${worker.hourly_rate_snapshot.toFixed(3)} KWD/hr` : ""}
          </p>
          <div className="mt-1">
            <StatusBadge label={worker.status} tone={statusTone(worker.status)} />
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

        {/* Right — main action buttons (Task 7 button rules, by status) */}
        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
          {canManageSessions && worker.status === "Not Started" ? (
            <SessionActionForm
              action={startWorkSessionAction}
              workOrderId={workOrderId}
              workerAssignmentId={worker.worker_assignment_id}
              label="Start"
              icon={Play}
              toastTitle="Work Session Started"
              className={btnStart}
            />
          ) : null}

          {canManageSessions && worker.status === "Active" ? (
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
                action={stopWorkSessionAction}
                workOrderId={workOrderId}
                workerAssignmentId={worker.worker_assignment_id}
                label="Stop"
                icon={Square}
                toastTitle="Work Session Stopped"
                className={btnStop}
              />
            </>
          ) : null}

          {canManageSessions && worker.status === "Paused" ? (
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
              <button type="button" onClick={() => setShowHistory(true)} className={btnSecondary}>
                View Sessions
              </button>
            </>
          ) : null}

          {canManageSessions && worker.status === "Completed" ? (
            <>
              <SessionActionForm
                action={startWorkSessionAction}
                workOrderId={workOrderId}
                workerAssignmentId={worker.worker_assignment_id}
                label="Resume Work"
                icon={Play}
                toastTitle="Work Session Started"
                className={btnStart}
              />
              {/* Daily Activity Timer Reliability and Remove Data Entry
                  Manual Entry Unit 10G.24, Task 5/6: manual time entry can
                  be used to fabricate hours never actually worked, so it's
                  now Manager/Super Admin only — Data Entry's only path to
                  recorded time is the real Start/Pause/Resume/Stop flow.
                  isManager already means super_admin OR
                  maintenance_manager (see page.tsx), so this doesn't
                  narrow who could correct time versus before, only who
                  reaches it from this button. */}
              {isManager && (
                <button type="button" onClick={() => setShowManualEntry(true)} className={btnSecondary}>
                  Add Manual Entry
                </button>
              )}
              <button type="button" onClick={() => setShowHistory(true)} className={btnSecondary}>
                View Sessions
              </button>
            </>
          ) : null}

          {/* Not Started / no history yet — no View Sessions button (Task
              7: "Not Started" only lists Start), but keep it reachable once
              there IS something to look at (Working/Paused/Completed cover
              that above); this covers the read-only (canManageSessions
              false) case so history is never fully unreachable. */}
          {!canManageSessions && (
            <button type="button" onClick={() => setShowHistory(true)} className={btnSecondary}>
              View Sessions
            </button>
          )}
        </div>
      </div>

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
        />
      )}
    </div>
  );
}
