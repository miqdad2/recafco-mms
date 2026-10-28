// Currently paused work — ONE definition (client-safe, pure) for the Data
// Entry and Manager dashboards, Daily Activity, Worker Activity and the Job
// Card page.
//
// A worker assignment is currently paused when:
//   - the assignment is still active (not Finished, not removed),
//   - its LATEST timer period (non-cancelled, not a manual entry) is Paused,
//   - and no timer period of it is running.
// i.e. deriveSimpleWorkerState(...) === "Paused" over the same timer state the
// labor summaries compute. A period left "Paused" when the worker was then
// marked Finished (Finish from a paused state completes no session) is NOT a
// current pause — that was the dashboard/Daily Activity mismatch. Manual
// entries never create a paused state. Job Card eligibility (open, not
// deleted, visible) is the caller's query scope.

import { deriveSimpleWorkerState } from "@/lib/work-orders/hours-variance";

export type TimerState = "Active" | "Paused" | "Completed" | "Not Started";

/** Timer state of one assignment from its periods (same rule as getWorkOrderLaborSummary). */
export function timerStateOf(periods: Array<{ status: string; is_manual_entry: boolean; started_at: Date | string }>): TimerState {
  const timer = periods.filter((p) => !p.is_manual_entry && p.status !== "Cancelled");
  if (timer.some((p) => p.status === "Active")) return "Active";
  if (timer.length === 0) return "Not Started";
  const latest = timer.reduce((a, b) => (new Date(b.started_at).getTime() > new Date(a.started_at).getTime() ? b : a));
  return latest.status === "Paused" ? "Paused" : "Completed";
}

export function isCurrentlyPaused(assignmentStatus: string, timerState: string): boolean {
  return deriveSimpleWorkerState(assignmentStatus, timerState) === "Paused";
}

export function isCurrentlyWorking(assignmentStatus: string, timerState: string): boolean {
  return deriveSimpleWorkerState(assignmentStatus, timerState) === "Working";
}

export type PausedWorkRow = { workOrderId: string; workerId: string; assignmentStatus: string; timerState: string };

export type PausedWorkSummary = {
  // Distinct workers paused somewhere and not running a timer anywhere in scope.
  pausedWorkers: number;
  // Distinct Job Cards with at least one currently paused worker.
  pausedJobCards: number;
  pausedWorkerIds: string[];
  pausedJobCardIds: string[];
};

export function summarizePausedWork(rows: PausedWorkRow[]): PausedWorkSummary {
  const working = new Set(rows.filter((r) => isCurrentlyWorking(r.assignmentStatus, r.timerState)).map((r) => r.workerId));
  const paused = rows.filter((r) => isCurrentlyPaused(r.assignmentStatus, r.timerState));
  const pausedWorkerIds = [...new Set(paused.map((r) => r.workerId))].filter((id) => !working.has(id));
  const pausedJobCardIds = [...new Set(paused.map((r) => r.workOrderId))];
  return { pausedWorkers: pausedWorkerIds.length, pausedJobCards: pausedJobCardIds.length, pausedWorkerIds, pausedJobCardIds };
}
